# Overruled

**A virtual line judge for tennis, built for courts that will never afford Hawk-Eye.**

Upload a short clip (or try a demo clip), click the four corners of the court once, and Overruled tracks the players and the ball, detects every bounce, and calls it **IN**, **OUT**, or **TOO CLOSE** — with the margin down to the centimeter. Live at **[night-hack-beta.vercel.app](https://night-hack-beta.vercel.app)**.

<!--
  Screenshots: drop image files into docs/screenshots/ using the filenames
  referenced below and these will render automatically on GitHub.
-->

## Screenshots

| Upload | Calibrate | Review |
| --- | --- | --- |
| ![Upload step](docs/screenshots/upload.png) | ![Calibrate step](docs/screenshots/calibrate.png) | ![Review step](docs/screenshots/review.png) |

| Dark mode | Light mode |
| --- | --- |
| ![Dark mode](docs/screenshots/dark-mode.png) | ![Light mode](docs/screenshots/light-mode.png) |

## Why we built it

Hawk-Eye and systems like it cost six figures to install per court. High school and college matches never see that kind of officiating — line calls come down to whichever player or umpire has the best angle, which is to say, often nobody has a good angle at all. Overruled asks a simpler question: what can a single fixed camera and off-the-shelf computer vision do with a normal video clip? The answer turned out to be a real, working line-call system, built and shipped in one night.

## Features

- **Two ways in**: pick a demo clip for instant results, or upload your own footage (MP4/H.264 or WebM, up to 30s / 60MB)
- **One-click calibration**: click the four outer court corners once; everything else — homography, court geometry, line calls — is computed from that
- **Calibrate while it analyzes**: inference kicks off the moment upload finishes, so the ~1-2 minute detection pass happens in the background while you calibrate, not after
- **Automatic ball-tracking fallback**: when a trained object detector can't reliably see the ball (small, fast, motion-blurred), a classical computer-vision tracker takes over automatically, frame range by frame range
- **Live progress**: the analysis screen polls real detection progress, not a fake spinner
- **Synced canvas overlay**: player boxes and a fading ball trail drawn frame-accurately over the video as it plays
- **Interactive call timeline**: every detected bounce, color-coded IN/OUT, click to seek and trigger a slow-motion replay
- **Top-down mini-court replay**: each call shown to scale on a real court diagram, with the exact margin in centimeters
- **Dark mode by default, with a light mode toggle**
- **Step navigation**: move back and forth between Upload / Calibrate / Analyze / Review at any point, not a one-way flow
- **A real deployed backend**, not a local demo — direct-to-S3 uploads, a Lambda-based detection service, all live on AWS

## Tech stack

**Frontend**
- [Next.js 16](https://nextjs.org) (App Router) + React 19 + TypeScript
- Tailwind CSS v4, [shadcn/ui](https://ui.shadcn.com) components
- [next-themes](https://github.com/pacocoursey/next-themes) for the light/dark toggle
- [zod](https://zod.dev) for runtime-validated API contracts
- [Vitest](https://vitest.dev) for unit tests

**Backend / infrastructure (AWS)**
- **S3** — video storage, direct browser-to-S3 uploads via presigned URLs
- **Lambda** (container image, Python 3.12, x86_64) — runs the detection pipeline
- **ECR** — hosts the Lambda's container image
- **IAM** — a scoped execution role and a scoped deploy user (least-privilege, resource-name-restricted)

**Computer vision / ML**
- [Ultralytics YOLOv8n](https://github.com/ultralytics/ultralytics) — person and ball detection
- OpenCV (`opencv-python-headless`) — video decoding, frame processing
- A custom HSV color-threshold + frame-differencing tracker — the automatic fallback for ball positions when the trained model's confidence drops too low
- PyTorch (CPU-only build) — inference runtime for YOLO

**Referee math (pure client-side TypeScript, `lib/referee.ts`)**
- 4-point homography (Direct Linear Transform) — maps clicked court corners to real-world court coordinates in meters
- Trajectory interpolation + median smoothing on the ball path
- Bounce detection via a velocity sign-flip with a minimum-magnitude gate, guarded against phantom (fully-interpolated) apexes
- Point-in-rectangle margin geometry against real ITF court dimensions, producing signed distance in centimeters

**Deployment**
- Frontend + API routes: [Vercel](https://vercel.com)
- Lambda image built and pushed via **AWS CloudShell** (no local Docker required or used)

## How it works

1. **Upload** — the client requests a presigned S3 URL from a Next.js API route and uploads the video directly to S3. Inference is triggered immediately afterward with an async Lambda invoke.
2. **Calibrate** — while inference runs in the background, the user scrubs to a frame that shows the full court and clicks the four outer doubles corners, in order. This happens entirely client-side against the locally-selected video file.
3. **Detect** — the Lambda function downloads the video from S3, runs YOLOv8n over every frame (players every 3rd frame, the ball every frame), and writes live progress back to S3. If the ball's detection rate in a stretch of frames falls below a threshold, the fallback HSV/frame-differencing tracker takes over ball tracking for that stretch. Final per-frame detections are written to S3 as JSON.
4. **Review** — once both the calibration and the detection results are ready, all referee logic runs in the browser: the four corners become a homography, the ball's trajectory is smoothed and scanned for bounces, and each bounce is projected into real court coordinates and classified IN, OUT, or TOO CLOSE against actual tennis court dimensions. The video, canvas overlay, timeline, and mini-court are all synced and rendered client-side.

## Challenges we ran into

- **The ball is genuinely hard to see.** A stock YOLOv8n model, run on real match footage, detected the tennis ball in a fraction of a percent of frames — it's small, fast, and motion-blurred, and "sports ball" in COCO wasn't trained for this. The fix was building an automatic fallback: when detection confidence drops, an HSV color threshold combined with frame-differencing takes over, and it recovered the vast majority of frames on the same footage that broke the trained model.
- **No local Docker.** The Lambda container image had to be built and pushed entirely through AWS CloudShell instead of a local machine — including chasing down a torch/torchvision version mismatch that only appeared on a live Lambda invocation (it built fine, but crashed at inference time), since local dependency resolution happened to land on a compatible pair that the fresh CloudShell build didn't.
- **A brand-new AWS account has sharp edges.** A default Lambda memory quota capped below what we'd planned for, a broken default KMS key reference blocking function creation outright, and an account-wide concurrency ceiling low enough that reserved concurrency wasn't even usable — each needed to be diagnosed and worked around live, mid-build.
- **Getting the bounce math actually correct.** An early version looked for a local *minimum* of the ball's screen-y position — wrong, because screen-space y increases downward, so a bounce is a local *maximum*. Once that was fixed, median-smoothing the trajectory turned out to quietly flatten the true single-frame peak into a multi-frame plateau, which broke a strict monotonic-velocity check entirely; it needed a non-strict comparison plus collapsing adjacent candidate frames into one event.
- **Tuning sensitivity.** The classical fallback tracker is noisier than a trained model, so bounce detection needed a minimum-movement threshold — otherwise ordinary tracking jitter was enough to fire a false bounce call.

## What's next

- **More sports.** The core architecture — calibrate court geometry once, detect the relevant object, classify against real-world geometry — generalizes beyond tennis. Pickleball, badminton, and volleyball are natural next targets; each just needs its own court dimensions and possibly a different detection target.
- **Better computer vision tuning.** A detector fine-tuned specifically on tennis-ball footage (rather than a generic COCO model), automatic court-line detection instead of manual corner-clicking, and adaptive detection thresholds instead of fixed constants.
- **Multi-camera triangulation**, closer to how real Hawk-Eye systems work, for higher-confidence 3D ball tracking instead of a single-camera homography.
- **Doubles court support** — line calls currently assume singles lines only.
- **Real-time analysis** instead of upload-then-wait, for genuinely live line-calling during a match.

## Running it locally

**Prerequisites:** Node 20+, npm.

```bash
git clone https://github.com/vivekajayjariwala/night-hack.git
cd night-hack
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The demo clips work immediately with **zero AWS setup** — pick one from the Upload screen to see the full Calibrate → Review flow with real, pre-computed detection results.

### Running the full pipeline (live uploads + your own AWS backend)

Live uploads need your own AWS resources: an S3 bucket and a deployed Lambda function (see `lambda/Dockerfile` — built and pushed via AWS CloudShell, no local Docker needed). Once you have those:

1. Create `.env.local` in the project root:
   ```
   AWS_REGION=us-east-1
   AWS_S3_BUCKET=<your-bucket-name>
   LAMBDA_FUNCTION_NAME=<your-lambda-function-name>
   ```
2. Configure AWS credentials locally (`aws configure`) — the app picks them up automatically via the SDK's default credential chain. Never put secret keys in `.env.local`.
3. `npm run dev` as above; live uploads will now trigger real inference.

### Other useful commands

```bash
npm run build      # production build
npm test            # vitest unit suite (referee math: homography, bounce detection, line calls)
npm run lint         # eslint
```

### Regenerating or adding demo clips

`scripts/run_local.py` runs the exact same detection pipeline as the Lambda, entirely locally — no AWS required:

```bash
pip install ultralytics opencv-python-headless
pip install torch --index-url https://download.pytorch.org/whl/cpu
python3 scripts/run_local.py path/to/clip.mp4 --out public/demo/clip.json
```

Then add an entry to `public/demo/manifest.json` pointing at the clip and its results JSON.

## Project structure

```
app/                Next.js App Router pages + API routes (presign, analyze, results, warm)
components/wizard/   The four-step wizard UI (upload, calibrate, analyze, review) + timeline, mini-court
lib/                 Shared types (lib/types.ts) and the pure-function referee math (lib/referee.ts)
lambda/              Python detection pipeline (pipeline.py, detect.py) + Dockerfile for the Lambda image
scripts/             run_local.py — runs the detection pipeline locally, no AWS needed
public/demo/         Cached demo clips and their pre-computed results JSON
```

## License

Built in one night for a hackathon. No license file yet — ask before reusing.
