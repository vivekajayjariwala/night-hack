"""
RefAI detection pipeline — shared by lambda/detect.py (AWS Lambda handler) and
scripts/run_local.py (local CLI / demo-cache generator). There is exactly ONE
implementation of the detection logic; both entry points import this module.

Output shape matches lib/types.ts (ResultsSchema) byte-for-byte:

    {
      "fps": 30,
      "meta": { "detectionRate": 0.62, "imgsz": 960, "modelMs": 41000, "lowDetection": false },
      "frames": [ { "t": 0.0, "boxes": [ {x,y,w,h,cls:"person",conf} ], "ball": {x,y,conf} | null } ]
    }

Design notes (see PLAN.md Phase 3 / detect.py contract for the full spec):
  - `t` is ALWAYS derived from cv2.CAP_PROP_POS_MSEC, never frame_idx/fps — phone
    video is variable-frame-rate and index math drifts by seconds over a clip.
  - Person boxes are detected every PERSON_FRAME_STRIDE-th frame only; frames in
    between get `boxes: []` and the frontend interpolates. Ball detection is
    attempted on every frame (small, fast-moving, most valuable to track densely).
  - YOLOv8n's COCO "sports ball" class frequently misses the small, motion-blurred
    tennis ball. After a first YOLO pass, if the ball detection rate is below
    LOW_DETECTION_THRESHOLD (20%), the whole clip is re-run through an HSV +
    frame-differencing blob tracker (hsv_frame_diff_ball_track) and those ball
    detections replace YOLO's for every frame. Person boxes always come from YOLO.
  - `ball` is `None` (-> JSON `null`) on frames with no detection; the key is
    always present, never omitted.
"""

from __future__ import annotations

import logging
import os
import time

import cv2
import numpy as np

logger = logging.getLogger("refai.pipeline")

# --- Tunable constants (spec defaults; overridable via env vars for quick
#     tuning at the AWS console without rebuilding the image) -----------------
IMG_SIZE = int(os.environ.get("REFAI_IMGSZ", "960"))
CONF_THRESH = float(os.environ.get("REFAI_CONF_THRESH", "0.25"))
PERSON_FRAME_STRIDE = int(os.environ.get("REFAI_PERSON_STRIDE", "3"))
LOW_DETECTION_THRESHOLD = float(os.environ.get("REFAI_LOW_DETECTION_THRESHOLD", "0.20"))

# Weights are baked into the Lambda image at build time (see lambda/Dockerfile),
# saved to $LAMBDA_TASK_ROOT/yolov8n.pt during `RUN python3 -c "YOLO('yolov8n.pt')"`.
# Locally (no LAMBDA_TASK_ROOT), this resolves to ./yolov8n.pt and ultralytics will
# auto-download it on first use (needs network the first time only).
_DEFAULT_WEIGHTS_DIR = os.environ.get("LAMBDA_TASK_ROOT", ".")
MODEL_PATH = os.environ.get("YOLO_WEIGHTS", os.path.join(_DEFAULT_WEIGHTS_DIR, "yolov8n.pt"))

# Progress heartbeat: write at least every N frames OR every N seconds of wall time,
# whichever comes first — keeps the frontend poll fed without spamming S3 PUTs.
PROGRESS_FRAME_INTERVAL = 50
PROGRESS_TIME_INTERVAL_SEC = 3.0


class VideoOpenError(Exception):
    """Raised when a video file can't be opened or has no readable frames."""


_model_cache: dict = {}


def get_model():
    """Lazily load (and cache) the YOLOv8n model. Loaded once per warm container."""
    if "model" not in _model_cache:
        # Imported here (not at module top) so that `import pipeline` alone —
        # e.g. from a warm ping that never calls get_model() — never pays the
        # ultralytics model-construction cost, only the (cheap) library import.
        from ultralytics import YOLO

        logger.info("loading YOLO model from %s", MODEL_PATH)
        _model_cache["model"] = YOLO(MODEL_PATH)
    return _model_cache["model"]


def _resolve_class_ids(model) -> tuple[int, int]:
    """Look up COCO class ids for 'person' and 'sports ball' by name (robust to
    any class-index reordering) rather than hardcoding 0/32."""
    name_to_id = {name: idx for idx, name in model.names.items()}
    person_id = name_to_id.get("person")
    ball_id = name_to_id.get("sports ball")
    if person_id is None or ball_id is None:
        raise RuntimeError(
            "YOLO model is missing expected COCO classes 'person'/'sports ball' "
            f"(available: {sorted(name_to_id.keys())})"
        )
    return person_id, ball_id


def open_and_validate(path: str):
    """Open a video file and confirm at least one frame is readable.

    Returns (cap, fps, total_frames) with a FRESH VideoCapture positioned at
    frame 0 (we validate on a throwaway capture, then reopen, since seeking
    back to 0 via CAP_PROP_POS_FRAMES is unreliable for some codecs/containers).
    """
    if not os.path.exists(path):
        raise VideoOpenError(f"Video file not found: {path}")

    probe = cv2.VideoCapture(path)
    if not probe.isOpened():
        probe.release()
        raise VideoOpenError(f"OpenCV could not open video file: {path}")
    ok, frame = probe.read()
    probe.release()
    if not ok or frame is None:
        raise VideoOpenError(f"No frames could be read from video file: {path}")

    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise VideoOpenError(f"OpenCV could not reopen video file: {path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
    return cap, fps, total_frames


def _maybe_report_progress(progress_cb, stage, frame_idx, total_frames, last_report_time):
    """Fire progress_cb at most once per PROGRESS_FRAME_INTERVAL frames or
    PROGRESS_TIME_INTERVAL_SEC seconds, whichever comes first. Returns the
    (possibly updated) last_report_time."""
    if progress_cb is None:
        return last_report_time
    now = time.time()
    if frame_idx % PROGRESS_FRAME_INTERVAL == 0 or (now - last_report_time) >= PROGRESS_TIME_INTERVAL_SEC:
        try:
            progress_cb(stage, frame_idx, total_frames or frame_idx)
        except Exception:
            logger.exception("progress_cb raised (non-fatal, continuing)")
        return now
    return last_report_time


def run_yolo_detection(cap, total_frames: int, progress_cb=None):
    """First-pass detection: person boxes (every Nth frame) + ball (every frame)
    via YOLOv8n. Returns (frames, ball_detection_rate, model_ms, frame_count)."""
    model = get_model()
    person_id, ball_id = _resolve_class_ids(model)

    frames = []
    frame_idx = 0
    ball_hits = 0
    t_start = time.time()
    last_report_time = t_start

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
        do_person = frame_idx % PERSON_FRAME_STRIDE == 0

        result = model.predict(
            frame,
            imgsz=IMG_SIZE,
            conf=CONF_THRESH,
            classes=[person_id, ball_id],
            verbose=False,
        )[0]

        boxes_out = []
        ball_out = None
        best_ball_conf = -1.0

        for box in result.boxes:
            cls_id = int(box.cls[0])
            conf = float(box.conf[0])
            x1, y1, x2, y2 = [float(v) for v in box.xyxy[0].tolist()]

            if cls_id == person_id and do_person:
                boxes_out.append(
                    {"x": x1, "y": y1, "w": x2 - x1, "h": y2 - y1, "cls": "person", "conf": conf}
                )
            elif cls_id == ball_id and conf > best_ball_conf:
                best_ball_conf = conf
                ball_out = {"x": (x1 + x2) / 2.0, "y": (y1 + y2) / 2.0, "conf": conf}

        if ball_out is not None:
            ball_hits += 1

        frames.append({"t": t, "boxes": boxes_out, "ball": ball_out})
        frame_idx += 1
        last_report_time = _maybe_report_progress(progress_cb, "detecting", frame_idx, total_frames, last_report_time)

    model_ms = int((time.time() - t_start) * 1000)
    detection_rate = (ball_hits / frame_idx) if frame_idx else 0.0
    return frames, detection_rate, model_ms, frame_idx


def hsv_frame_diff_ball_track(video_path: str, total_frames: int, progress_cb=None):
    """Fallback ball tracker used when YOLO's ball detection rate is too low.

    Combines an HSV color threshold (bright yellow/green "optic yellow" tennis
    ball, with generous bounds to also catch white balls under stadium lights)
    with frame-differencing motion masking (rejects static bright objects like
    court lines, ad boards, sponsor logos). Candidate blobs are scored by area
    and circularity; the best-scoring blob per frame is reported as the ball.

    Returns (frames, ball_detection_rate, frame_count) where each frame dict is
    `{"t": float, "ball": {"x","y","conf"} | None}` (no `boxes` key — the caller
    merges this into the YOLO-pass frames, which already carry person boxes).
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise VideoOpenError(f"OpenCV could not open video file for ball fallback: {video_path}")

    # Optic-yellow tennis ball in HSV. Wide saturation/value bounds to tolerate
    # motion blur (desaturates color) and variable lighting.
    lower_yellow = np.array([25, 35, 90])
    upper_yellow = np.array([50, 255, 255])

    frames = []
    prev_gray = None
    frame_idx = 0
    ball_hits = 0
    last_report_time = time.time()

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (5, 5), 0)
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        color_mask = cv2.inRange(hsv, lower_yellow, upper_yellow)

        ball = None
        if prev_gray is not None:
            diff = cv2.absdiff(gray, prev_gray)
            _, motion_mask = cv2.threshold(diff, 15, 255, cv2.THRESH_BINARY)
            motion_mask = cv2.dilate(motion_mask, None, iterations=2)
            combined = cv2.bitwise_and(color_mask, motion_mask)

            contours, _ = cv2.findContours(combined, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            best_contour = None
            best_score = 0.0
            for c in contours:
                area = cv2.contourArea(c)
                if area < 4 or area > 2500:  # tennis ball is small; reject huge blobs
                    continue
                perimeter = cv2.arcLength(c, True)
                if perimeter <= 0:
                    continue
                circularity = 4 * np.pi * area / (perimeter * perimeter)
                if circularity < 0.35:  # reject non-circular blobs (lines, edges)
                    continue
                score = area * circularity
                if score > best_score:
                    best_score = score
                    best_contour = c

            if best_contour is not None:
                (cx, cy), _radius = cv2.minEnclosingCircle(best_contour)
                # Heuristic confidence: scales with blob score, capped at 0.9 since
                # this is a classical-CV fallback, never as certain as a learned detector.
                conf = float(min(0.9, 0.3 + 0.6 * min(1.0, best_score / 150.0)))
                ball = {"x": float(cx), "y": float(cy), "conf": conf}

        if ball is not None:
            ball_hits += 1

        frames.append({"t": t, "ball": ball})
        prev_gray = gray
        frame_idx += 1
        last_report_time = _maybe_report_progress(
            progress_cb, "ball-fallback", frame_idx, total_frames, last_report_time
        )

    cap.release()
    detection_rate = (ball_hits / frame_idx) if frame_idx else 0.0
    return frames, detection_rate, frame_idx


def process_video(video_path: str, progress_cb=None):
    """Run the full RefAI detection pipeline on a local video file.

    `progress_cb`, if given, is called as `progress_cb(stage: str, framesDone: int,
    totalFrames: int)` periodically during processing. Has no knowledge of S3 —
    callers (detect.py / run_local.py) decide what to do with progress/results.

    Returns (results, info):
      results — dict matching lib/types.ts ResultsSchema exactly.
      info    — extra diagnostics for callers to log/print:
                {"ballPath": "yolo"|"hsv_fallback", "detectionRate": float,
                 "modelMs": int, "frameCount": int, "lowDetection": bool}
    """
    cap, fps, total_frames = open_and_validate(video_path)

    if progress_cb:
        try:
            progress_cb("detecting", 0, total_frames)
        except Exception:
            logger.exception("progress_cb raised on initial call (non-fatal)")

    frames, yolo_ball_rate, model_ms, frame_count = run_yolo_detection(cap, total_frames, progress_cb)
    cap.release()

    ball_path_used = "yolo"
    detection_rate = yolo_ball_rate
    logger.info(
        "YOLO pass complete: %d frames, ball detection rate %.1f%%, model time %dms",
        frame_count,
        yolo_ball_rate * 100,
        model_ms,
    )

    if yolo_ball_rate < LOW_DETECTION_THRESHOLD:
        logger.info(
            "YOLO ball detection rate %.1f%% is below the %.0f%% threshold — "
            "re-running ball-only detection with the HSV/frame-diff fallback tracker.",
            yolo_ball_rate * 100,
            LOW_DETECTION_THRESHOLD * 100,
        )
        fallback_frames, fallback_rate, fallback_count = hsv_frame_diff_ball_track(
            video_path, frame_count, progress_cb
        )
        ball_path_used = "hsv_fallback"
        detection_rate = fallback_rate

        # Merge: replace `ball` frame-by-frame with the fallback tracker's result;
        # `boxes` (person detections) always come from the YOLO pass.
        n = min(len(frames), len(fallback_frames))
        if len(frames) != len(fallback_frames):
            logger.warning(
                "frame count mismatch between YOLO pass (%d) and fallback pass (%d); "
                "merging the first %d frames only",
                len(frames),
                len(fallback_frames),
                n,
            )
        for i in range(n):
            frames[i]["ball"] = fallback_frames[i]["ball"]

        logger.info("HSV/frame-diff fallback complete: ball detection rate %.1f%%", fallback_rate * 100)

    low_detection = detection_rate < LOW_DETECTION_THRESHOLD
    if low_detection:
        logger.warning(
            "Ball detection rate %.1f%% is still below %.0f%% after fallback — "
            "writing results with meta.lowDetection=true (not a hard failure).",
            detection_rate * 100,
            LOW_DETECTION_THRESHOLD * 100,
        )

    logger.info("ball tracking path used: %s", ball_path_used)

    results = {
        "fps": fps,
        "meta": {
            "detectionRate": round(detection_rate, 4),
            "imgsz": IMG_SIZE,
            "modelMs": model_ms,
            "lowDetection": low_detection,
        },
        "frames": frames,
    }
    info = {
        "ballPath": ball_path_used,
        "detectionRate": detection_rate,
        "modelMs": model_ms,
        "frameCount": frame_count,
        "lowDetection": low_detection,
    }
    return results, info
