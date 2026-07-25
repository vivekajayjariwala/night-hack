#!/usr/bin/env python3
"""
Standalone local CLI for the RefAI detection pipeline. No S3, no AWS calls —
reads a local video file and writes the results JSON to a local path, running
the exact same detection logic as lambda/detect.py (both import
lambda/pipeline.py; there is exactly one implementation).

Usage:
    python3 scripts/run_local.py <path-to-video> --out <path-to-json>

This script doubles as:
  (a) the offline tool that generates the precomputed demo-clip cache JSON
      files (PLAN.md E1) — point it at a curated clip, commit the output JSON.
  (b) the hour-one tool for validating ball-detection quality (YOLO vs the
      HSV/frame-diff fallback) against a real tennis clip, once one exists.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

# lambda/pipeline.py is not a package (deliberately — kept as a flat module
# shared by the Lambda handler and this script). Add lambda/ to sys.path so
# both `detect.py` (inside lambda/, imports "pipeline" directly) and this
# script (outside lambda/) resolve the SAME file.
_LAMBDA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lambda")
sys.path.insert(0, _LAMBDA_DIR)

try:
    from pipeline import VideoOpenError, process_video  # noqa: E402
except ImportError as e:  # pragma: no cover - dependency/setup error, not a bug
    print(
        "ERROR: could not import the detection pipeline from lambda/pipeline.py.\n"
        f"  ({e})\n"
        "Make sure dependencies are installed, e.g.:\n"
        "  pip install ultralytics opencv-python-headless\n"
        "  pip install torch --index-url https://download.pytorch.org/whl/cpu",
        file=sys.stderr,
    )
    sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run the RefAI detection pipeline locally on a video file (no S3/AWS)."
    )
    parser.add_argument("video", help="Path to the input video file (mp4/webm/etc).")
    parser.add_argument("--out", required=True, help="Path to write the results JSON.")
    args = parser.parse_args()

    if not os.path.exists(args.video):
        print(f"ERROR: input video not found: {args.video}", file=sys.stderr)
        sys.exit(1)

    def progress_cb(stage: str, frames_done: int, total_frames: int) -> None:
        total_str = str(total_frames) if total_frames else "?"
        print(f"  [{stage}] {frames_done}/{total_str} frames", flush=True)

    print(f"Running RefAI detection pipeline on: {args.video}")
    t_start = time.time()
    try:
        results, info = process_video(args.video, progress_cb=progress_cb)
    except VideoOpenError as e:
        print(f"ERROR: could not process video: {e}", file=sys.stderr)
        sys.exit(1)
    elapsed = time.time() - t_start

    out_path = os.path.abspath(args.out)
    out_dir = os.path.dirname(out_path)
    if out_dir and not os.path.exists(out_dir):
        os.makedirs(out_dir, exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(results, f)

    print()
    print("=== RefAI local pipeline summary ===")
    print(f"  video:               {args.video}")
    print(f"  output:              {out_path}")
    print(f"  frames processed:    {info['frameCount']}")
    print(f"  ball path used:      {info['ballPath']}  (yolo | hsv_fallback)")
    print(f"  ball detection rate: {info['detectionRate'] * 100:.1f}%")
    print(f"  low-detection flag:  {info['lowDetection']}")
    print(f"  model time:          {info['modelMs']} ms")
    print(f"  total wall time:     {elapsed:.1f}s")


if __name__ == "__main__":
    main()
