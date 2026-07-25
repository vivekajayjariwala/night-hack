# RefAI detection Lambda image.
#
# BUILD TARGET: x86_64 only. This is built on AWS CloudShell (an x86_64 host) and
# run on an x86_64 Lambda — do NOT build this on/for arm64 (e.g. a local Apple
# Silicon Docker install), it will not match the Lambda runtime architecture.
# There is no local Docker on the dev machine; this file is never built locally.
#
# Build (on AWS CloudShell):
#   docker build --platform linux/amd64 -t refai-detect .
#   (then tag + push to ECR — see integration notes for exact commands)

FROM public.ecr.aws/lambda/python:3.12

# ultralytics writes a config dir (settings.yaml etc.) on import; Lambda's
# filesystem is read-only outside of /tmp, so without this it crashes on the
# very first invocation.
ENV YOLO_CONFIG_DIR=/tmp

WORKDIR ${LAMBDA_TASK_ROOT}

COPY requirements.txt .

# CPU-only torch + torchvision FIRST, TOGETHER, from the same CPU wheel index,
# so ultralytics' dependency on both is already satisfied and pip never pulls
# either from the default index.
#
# IMPORTANT (found via a live Lambda test invocation — the local venv test
# didn't catch this because pip happened to resolve a compatible pair there):
# torch and torchvision are ABI-coupled — torchvision ships compiled ops (like
# nms) that must be built against the exact torch version/flavor installed.
# Installing only `torch` from the CPU index here, then letting
# `pip install -r requirements.txt` pull in ultralytics' torchvision dependency
# from the DEFAULT index, resolves a torchvision build that doesn't match this
# torch build — fails at runtime with "operator torchvision::nms does not
# exist", not at install time. Fix: install torch AND torchvision together,
# both from the CPU index, in the SAME pip command, before requirements.txt is
# installed — resolving them together lets pip pick a compatible pair from
# that index, rather than resolving torchvision separately (and later) against
# the default index. A build-time smoke test below actually calls
# torchvision.ops.nms so a future mismatch fails the build, not a live invoke.
#
# IMPORTANT (verified locally): ultralytics declares a transitive dependency on
# the GUI `opencv-python` build regardless of what's in requirements.txt, so a
# plain `pip install -r requirements.txt` ends up with BOTH opencv-python AND
# opencv-python-headless installed side by side, sharing the same cv2/ package
# directory on disk (undefined which wheel's files "win"). The GUI build also
# breaks in Lambda (missing libGL etc.) even when it doesn't win that race. Fix:
# after normal resolution, explicitly uninstall opencv-python and force-reinstall
# opencv-python-headless so only the headless build's files are on disk.
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r requirements.txt \
 && pip uninstall -y opencv-python \
 && pip install --no-cache-dir --force-reinstall --no-deps opencv-python-headless \
 && python3 -c "import torch, torchvision; from torchvision.ops import nms; import torch as t; nms(t.zeros((1,4)), t.zeros(1), 0.5); print('torch', torch.__version__, 'torchvision', torchvision.__version__, 'nms OK')"

# Bake the YOLOv8n weights into the image at build time (avoids a network fetch
# adding to cold start). ultralytics saves 'yolov8n.pt' to the current working
# directory (${LAMBDA_TASK_ROOT}) when given a bare filename, which is exactly
# where pipeline.py's MODEL_PATH looks for it at runtime (via $LAMBDA_TASK_ROOT).
RUN python3 -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"

COPY pipeline.py detect.py ${LAMBDA_TASK_ROOT}/

CMD ["detect.handler"]
