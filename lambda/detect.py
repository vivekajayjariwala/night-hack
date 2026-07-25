"""
AWS Lambda handler for RefAI detection.

Event shape: {"jobId": "<uuid>", "warm": bool (optional)}.

  - warm=True        -> return {"warmed": True} immediately. No S3, no video/model
                         work. Coordinated with the frontend's pre-demo warm-ping.
  - jobId present     -> download uploads/{jobId}.mp4 from S3, run the detection
                         pipeline (lambda/pipeline.py), write progress.json during
                         the run, and results.json (or error.json on any failure)
                         when done.

The ENTIRE handler body runs inside one try/except: any crash, anywhere, writes
error.json instead of dying silently — the frontend polls for that file as the
terminal failure signal, and a silently-dead Lambda means the UI polls forever.
"""

from __future__ import annotations

import json
import logging
import os

import boto3

from pipeline import VideoOpenError, process_video

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("refai.detect")

S3_BUCKET = os.environ.get("S3_BUCKET", "refai-vaj-2026")

# Constructed at module scope (not per-invocation) so a warm container reuses it.
_s3 = boto3.client("s3")


def _put_json(key: str, obj: dict) -> None:
    _s3.put_object(
        Bucket=S3_BUCKET,
        Key=key,
        Body=json.dumps(obj).encode("utf-8"),
        ContentType="application/json",
    )


def handler(event, context):
    job_id = None
    local_path = None

    try:
        if not isinstance(event, dict):
            event = {}

        # --- Warm ping: zero S3, zero video/model work. Just prove the container
        #     is up (module import of cv2/ultralytics/torch already happened by
        #     the time this line runs, which is most of the cold-start cost). ---
        if event.get("warm"):
            return {"warmed": True}

        job_id = event.get("jobId")
        if not job_id:
            raise ValueError("event is missing required field 'jobId'")

        video_key = f"uploads/{job_id}.mp4"
        local_path = f"/tmp/{job_id}.mp4"
        results_key = f"results/{job_id}/results.json"
        progress_key = f"results/{job_id}/progress.json"
        error_key = f"results/{job_id}/error.json"

        def progress_cb(stage: str, frames_done: int, total_frames: int) -> None:
            _put_json(progress_key, {"stage": stage, "framesDone": frames_done, "totalFrames": total_frames})

        progress_cb("downloading", 0, 0)
        try:
            _s3.download_file(S3_BUCKET, video_key, local_path)
        except Exception as download_err:
            logger.exception("failed to download s3://%s/%s", S3_BUCKET, video_key)
            _put_json(error_key, {"message": f"Could not download video from S3: {download_err}"})
            return {"ok": False, "jobId": job_id}

        try:
            results, info = process_video(local_path, progress_cb=progress_cb)
        except VideoOpenError as video_err:
            # Covers: cap not opened, zero readable frames, corrupt/empty file.
            logger.warning("video open/validate failed for jobId=%s: %s", job_id, video_err)
            _put_json(error_key, {"message": str(video_err)})
            return {"ok": False, "jobId": job_id}

        logger.info(
            "jobId=%s detection complete: ballPath=%s detectionRate=%.3f frames=%d modelMs=%d lowDetection=%s",
            job_id,
            info["ballPath"],
            info["detectionRate"],
            info["frameCount"],
            info["modelMs"],
            info["lowDetection"],
        )

        _put_json(results_key, results)
        return {"ok": True, "jobId": job_id}

    except Exception as unhandled:
        logger.exception("unhandled error in handler (jobId=%s)", job_id)
        if job_id:
            try:
                _put_json(f"results/{job_id}/error.json", {"message": f"Unhandled error: {unhandled}"})
            except Exception:
                logger.exception("also failed to write error.json after unhandled exception")
        return {"ok": False, "jobId": job_id}

    finally:
        if local_path and os.path.exists(local_path):
            try:
                os.remove(local_path)
            except OSError:
                logger.exception("failed to clean up %s (non-fatal)", local_path)
