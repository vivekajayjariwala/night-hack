<!-- /autoplan restore point: /Users/vivekjariwala/.gstack/projects/vivekajayjariwala-night-hack/main-autoplan-restore-20260724-202556.md -->
# RefAI — Virtual Tennis Referee (Hackathon Plan)

**Deadline:** tonight (2026-07-24). Bias every decision toward the simplest thing that demos well.

## Goal
User uploads a short tennis clip (10–30s). The system boxes players and the ball, detects ball bounces, and flags line calls (IN/OUT) on a timeline under the video player.

## Stack (LOCKED — do not relitigate)
- **Frontend:** Next.js App Router + shadcn/ui, deployed on Vercel
- **Video storage:** AWS S3 via presigned upload URLs
- **Inference:** AWS Lambda (Python container image: ultralytics YOLOv8n + OpenCV, CPU), writes results JSON back to S3
- **No database, no auth**

## Key design decisions (LOCKED — as amended at the D1–D4 premise gate)
1. **Court calibration is MANUAL:** after upload, show frame 1 and let the user click the 4 court corners (TL→TR→BR→BL, outer doubles corners; IN/OUT judged vs singles lines, labeled in UI). Homography computed **client-side**.
2. **Bounce detection (client-side, amended D2):** local **maximum of screen-y** (ball's lowest physical point) on the gap-interpolated, 3-frame-median-smoothed trajectory, requiring a sustained downward→upward velocity sign flip (rejects racket hits/net cords). Project bounce point via homography, point-in-polygon vs singles bounds → IN/OUT event with confidence; show "TOO CLOSE" when the margin is inside the calibration error bound.
3. **Backend NEVER re-encodes video; detection only (amended D3).** Lambda output is JSON:
   ```json
   {
     "fps": 30,
     "meta": { "detectionRate": 0.62, "imgsz": 960, "modelMs": 41000 },
     "frames": [{ "t": 0.0, "boxes": [{ "x": 0, "y": 0, "w": 0, "h": 0, "cls": "person", "conf": 0.9 }], "ball": { "x": 0, "y": 0, "conf": 0.5 } }]
   }
   ```
   (`ball` may be `null` per frame.) **Events are computed client-side** from `frames` + user corners — recalibration and threshold tuning never re-run inference. Lambda also writes `progress.json` ({stage, framesDone, totalFrames}) during the run and `error.json` on failure.
4. **Frontend rendering:** boxes/ball-trail/events drawn on a `<canvas>` overlay synced to `video.currentTime` (rAF + binary-search nearest frame, refs not React state), clickable event markers on a timeline, slow-mo ±1s auto-replay on marker click, and a top-down SVG mini-court showing projected bounce + IN/OUT badge + margin (D4).
5. **Upload gate (amended D1):** MP4 (H.264) or WebM only, ≤30s, ≤60MB. Lambda: 10GB memory, pre-warm ping before demo. Precomputed demo-clip cache (E1) is the demo spine; live upload is the flourish.

## User flow
1. Upload clip (10–30s) → presigned PUT to S3
2. See frame 1 → click 4 court corners (manual calibration)
3. Trigger Lambda inference (YOLOv8n ball + person detection per frame)
4. Poll for results JSON in S3
5. Watch video with live box overlay + IN/OUT event markers on timeline; click a marker to seek

## Out of scope (hackathon)
- Auth, database, multi-user, history
- Serve speed, player stats, rally analysis
- Automatic court detection
- GPU inference, real-time streaming

---

# /autoplan Phase 1 — CEO Review (SELECTIVE EXPANSION, via /autoplan)

## System audit
Greenfield: zero commits, no code, no CLAUDE.md/TODOS.md, GitHub remote configured. No prior reviews, no stashes, no retrospective history. Nothing to leverage in-repo; leverage comes from off-the-shelf libraries (ultralytics, OpenCV homography/point-in-polygon, shadcn/ui).

## 0A. Premise Challenge
| # | Premise | Verdict |
|---|---------|---------|
| P1 | YOLOv8n (CPU) can detect a tennis ball per frame | **SHAKY.** COCO "sports ball" misses small motion-blurred balls in many frames. Mitigate: low conf threshold (~0.25), imgsz≥960, and interpolate trajectory across gaps. Curate the demo clip. |
| P2 | Lambda CPU finishes 10–30s clip in acceptable time | **OK with caveats.** 300–900 frames × ~150–300ms ≈ 1–4.5 min. Under the 15-min Lambda cap, but too long to stare at silently → progress feedback required. |
| P3 | Container Lambda is demo-safe | **RISK.** ~2GB image → 30–60s cold start. Mitigate: warm-ping before demo. |
| P4 | y-trajectory local minimum = bounce | **PARTIALLY WRONG.** Also fires on racket hits, net cords, occlusion gaps. Mitigate: require descent→ascent velocity sign change with min magnitude, and trajectory continuity around the minimum. |
| P5 | Manual 4-corner homography suffices | **OK** — but must specify WHICH corners (recommend outer doubles corners; call IN/OUT vs singles or doubles bounds explicitly). |
| P6 | Browser can play the uploaded clip | **UNSTATED, WRONG for iPhone.** HEVC .mov won't play in Chrome. Gate uploads to H.264 MP4/WebM or the entire overlay UI is dead. |

## 0B. Existing Code Leverage
Empty repo → maps to libraries: ultralytics YOLOv8n (detection), cv2.findHomography/perspectiveTransform (projection), matplotlib-free point-in-polygon via cv2.pointPolygonTest, shadcn/ui (all UI chrome), AWS SDK presigned URLs. Nothing is being rebuilt that a library provides.

## 0C. Dream State
```
CURRENT: empty repo → THIS PLAN: upload→calibrate→infer→overlay demo → 12-MO IDEAL: auto court detection,
tracking-based ball model, real-time, multi-sport. Plan's manual-calibration + JSON contract is forward-
compatible with all of that (swap detector, keep contract). Moves TOWARD ideal.
```

## 0C-bis. Implementation Alternatives
- **A: As planned** (Lambda YOLO per-frame, JSON to S3, client polls). Effort M / Risk Med. Reuses locked stack. **CHOSEN** (matches locked decisions).
- **B: A + precomputed demo cache** — run the pipeline offline tonight on 2–3 curated clips, store results JSON keyed by clip; live path unchanged, demo never blocks on inference. Effort +S / Risk Low. **ACCEPTED as expansion E1.**
- **C: Client-side ONNX inference** — rejected: stack locked to Lambda; browser CPU on 900 frames is worse, not simpler.

## 0D. Selective-Expansion Cherry-Picks (auto-decided per /autoplan principles)
| # | Expansion | Effort (CC) | Decision | Principle |
|---|-----------|-------------|----------|-----------|
| E1 | Precomputed demo-clip cache (offline results JSON) | ~20 min | **ACCEPT** | P2 blast radius, kills the worst demo failure |
| E2 | Progress feedback: Lambda writes `progress.json` (stage, framesDone/total); UI progress bar | ~20 min | **ACCEPT** | P1 completeness — 1–4 min silent wait is a broken demo |
| E3 | Ball comet-trail on canvas (last ~10 positions) | ~15 min | **ACCEPT** | P3 pragmatic — "Hawk-Eye" feel for trivial cost |
| E4 | Slow-mo auto-replay (±1s at 0.25× on marker click) | ~15 min | **ACCEPT** | P2 — sells the line call moment |
| E5 | Top-down mini-court view of bounce location | ~1–2 h | **TASTE → final gate** | borderline scope |
| E6 | Hawk-Eye style zoom/challenge animation | multi-hour | **DEFER → TODOS** | P3 outside tonight's radius |
| E7 | Shareable result links / clip gallery | — | **DEFER → TODOS** | not needed to demo |

## 0E. Temporal Interrogation (human-hours; CC ≈ 10–20x faster)
- HR1: bucket/CORS/presigned setup; decide upload constraints (MP4/H.264 only, ≤60MB, ≤30s). Decide NOW.
- HR2-3: Lambda handler shape (event contract: {videoKey, corners?}); corners passed to backend vs client-side homography → **decide: client computes homography AND sends corners; backend does projection** (single source of truth in backend, keeps frontend render-only). Frame sampling rate (process every frame at imgsz 960; fall back to every 2nd frame if slow).
- HR4-5: canvas/video sync (rAF loop reading currentTime; nearest-frame lookup via binary search); polling cadence (2s) and hard timeout (6 min).
- HR6+: empty/error states, warm-up ping, demo-clip curation.

## Review Sections (1–11)
1. **Architecture** — 1 issue. Serverless fan-out is sound; single Lambda, no queue needed at demo scale. ISSUE A1: results polling needs a terminal failure signal — Lambda must write `error.json` on crash (wrapped top-level try/except) or the UI polls forever. Rollback = redeploy; no migrations. Diagram in Phase 3.
2. **Error & Rescue Map** — registry below; 3 gaps found, all folded into plan (upload failure UI, poll timeout, empty-events state).
3. **Security** — Presigned PUT constrained (content-type video/mp4, max size). Bucket private; results read via presigned GET from a Next.js route. Lambda invoked via API route (server-side AWS SDK) — no unauthenticated function URL. No PII. Injection: none (no DB, no exec of user input; video parsed by OpenCV — accept CVE surface for hackathon). Low residual risk; acceptable.
4. **Data/Interaction Edge Cases** — nil ball frames (contract allows `ball: null` — good); zero events; double-click upload (disable button while uploading); navigate-away mid-poll (poll tied to component lifecycle); corner clicks: wrong order (require TL→TR→BR→BL with numbered dots + undo), duplicate/collinear points (validate non-degenerate quad before enabling Continue).
5. **Code Quality** — plan is spec-level; enforce single shared TS type for results JSON, matching Python dataclass. No premature abstraction: one Lambda file, ~4 frontend components.
6. **Tests** — deferred to Phase 3 (eng review owns the test diagram; avoids duplicate output).
7. **Performance** — inference dominates; frontend must NOT re-render React per frame (draw overlay in rAF, refs not state). Results JSON for 900 frames ≈ 100–300KB — fine. imgsz 960 vs 640 tradeoff noted (detection rate vs 2× time).
8. **Observability** — CloudWatch logs + `progress.json` (E2) doubles as user-facing observability. Log per-stage timings + detection-rate summary in Lambda output. Sufficient for tonight.
9. **Deployment** — Vercel (frontend) + ECR/Lambda (manual create tonight). Risk: first ECR push of 2GB image on hotel wifi — do it EARLY. Post-deploy check: warm-ping Lambda, run one curated clip end-to-end.
10. **Trajectory** — Reversibility 5/5 (JSON contract is the API; every component swappable). Debt: manual calibration UX and CPU inference speed — both acknowledged, both fine for demo.
11. **Design & UX** — UI scope confirmed; full treatment in Phase 2.

## NOT in scope
Auth/DB/multi-user (locked), auto court detection (multi-hour CV rabbit hole), GPU/real-time (infra), E6 challenge animation (deferred), E7 sharing (deferred), doubles-vs-singles toggle (assume singles lines; note in UI).

## What already exists
Nothing in-repo (greenfield). All sub-problems map to libraries — see 0B.

## Error & Rescue Registry
| Codepath | Failure | Rescued? | Action | User sees |
|---|---|---|---|---|
| Presigned PUT | CORS/expiry/network | Y | retry button | "Upload failed — retry" toast |
| Upload | wrong codec (HEVC .mov) | Y (gate) | accept .mp4 (H.264)/webm only | "Please upload an MP4 (H.264)" |
| Lambda | crash/OOM/timeout | Y | top-level try/except writes `error.json` | "Analysis failed" + retry |
| Lambda | ball detected in <20% frames | Y | still write results, `events:[]`, flag `lowDetection:true` | "Couldn't track the ball reliably — try a clearer clip" |
| Frontend poll | no result after 6 min | Y | stop polling, error state | "Taking too long" + retry |
| Results fetch | malformed JSON | Y | try/catch parse | error state |
| Calibration | degenerate quad | Y | validate before Continue | "Corners look off — re-click" |

## Failure Modes Registry
| Codepath | Failure | Rescued | Test | User sees | Logged | |
|---|---|---|---|---|---|---|
| inference | cold start 60s | warm-ping | manual | progress UI | CW | OK |
| bounce detect | false positive at racket hit | velocity filter | curated-clip eval | wrong IN/OUT marker | summary | ACCEPTED RISK (confidence shown) |
| homography | sloppy corner clicks | quad validation | manual | slightly wrong calls | no | ACCEPTED RISK |
| poll loop | Lambda dies silently | error.json + timeout | manual | error state | CW | OK (was CRITICAL GAP → closed) |

## Dream state delta
Plan lands us at "working single-clip referee demo with honest confidence signals" — directly on the path to the 12-month ideal; no throwaway architecture except manual calibration (explicitly temporary).

## CEO Dual Voices [subagent-only — Codex CLI not installed]
**CLAUDE SUBAGENT (CEO — strategic independence), key findings:**
- Reframe: this is a **visualization demo, not an ML product**; boxes-on-video is table stakes, the top-down bounce replay is the hero moment.
- "y local minimum = bounce" is a **sign bug** in image coordinates (bounce = local max of screen-y). Also: interpolate gaps, smooth (median/Savitzky–Golay), require sustained velocity sign flip.
- Stock YOLOv8n ball detection ~50–80% per-frame miss risk on small blurred balls → validate on the real clip in hour one; fallback = HSV threshold + frame differencing + blob tracking (keep YOLO for persons).
- Compute bounces/calls **client-side** from Lambda-emitted trajectories → instant recalibration, tunable thresholds without ECR redeploys.
- Canned demo clips + cached JSON = highest-leverage 30 min tonight; live upload becomes the flourish, not the spine.
- Perf: 10s clip cap, 10GB Lambda memory (6 vCPUs), person boxes every 3rd frame, pre-warm, progress JSON.
- Calibration: corner click error of ~3px ≈ 20–40cm at the far baseline → magnifier on click; show "TOO CLOSE" when margin < error bound (more credible than fake precision).

```
CEO DUAL VOICES — CONSENSUS TABLE [subagent-only]:
═══════════════════════════════════════════════════════════════
  Dimension                             Claude  Subagent  Consensus
  ────────────────────────────────────  ──────  ────────  ─────────
  1. Premises valid?                    FLAGGED FLAGGED   CONFIRMED (P1/P4/P6 need fixes)
  2. Right problem to solve?            YES     YES*      CONFIRMED (*reframe: viz demo)
  3. Scope calibration correct?         MOSTLY  MOSTLY    CONFIRMED (+E1 both; E5 → taste)
  4. Alternatives sufficiently explored? NO→E1   NO→E1     CONFIRMED (canned clips was missing)
  5. Competitive/judging risks covered? PARTIAL PARTIAL   CONFIRMED (top-down view = differentiator)
  6. 6-month (tonight) trajectory sound? YES     YES       CONFIRMED
═══════════════════════════════════════════════════════════════
Disagreements with user's locked direction → gate: bounce-y definition (sign),
events computed backend (locked contract) vs client-side (both voices prefer client).
```

## Decision Audit Trail
| # | Phase | Decision | Class | Principle | Rationale | Rejected |
|---|-------|----------|-------|-----------|-----------|----------|
| 1 | Intake | Skip /office-hours prerequisite | Mechanical | P6 | deadline tonight; plan already well-shaped | run it |
| 2 | Intake | DX phase skipped | Mechanical | — | nothing developer-facing ships | run DX review |
| 3 | CEO | Mode = SELECTIVE EXPANSION | Mechanical | autoplan override | mandated by /autoplan | — |
| 4 | CEO | Approach A (+E1 cache) | Mechanical | P1/P5 | matches locked stack; B folded in as E1 | client-side ONNX |
| 5 | CEO | E1 demo cache ACCEPT | Mechanical | P2 | kills worst live-demo failure, ~20 min | skip |
| 6 | CEO | E2 progress.json ACCEPT | Mechanical | P1 | 1–4 min silent wait unacceptable | spinner only |
| 7 | CEO | E3 ball trail ACCEPT | Mechanical | P3 | 15 min, large demo impact | skip |
| 8 | CEO | E4 slow-mo replay ACCEPT | Mechanical | P2 | sells the core moment | skip |
| 9 | CEO | E5 mini-court TASTE | Taste | — | 1–2h vs demo-wow; user decides at gate | — |
| 10 | CEO | E6, E7 DEFER | Mechanical | P3 | outside tonight's radius | build now |
| 11 | CEO | MP4/H.264-only upload gate | Mechanical | P1 | HEVC kills browser playback | accept any video |
| 12 | CEO | ~~Backend computes projection from corners~~ **SUPERSEDED by #16 (D3)** | — | — | eng voice caught the stale row; do NOT implement | — |
| 13 | CEO | Singles-court bounds for IN/OUT | Mechanical | P3 | pick one, label it in UI | doubles toggle |
| 14 | Gate | D1 amended premises CONFIRMED by user | User gate | — | MP4 gate, hour-one detection validation + CV fallback, 10GB Lambda + warm-up | — |
| 15 | Gate | D2 bounce = screen-y max + velocity filter | User challenge → ACCEPTED | — | sign bug in original spec, both voices | literal y-min |
| 16 | Gate | D3 events computed client-side | User challenge → ACCEPTED | — | instant recalibration/tuning; Lambda = detection only | backend events (original lock) |
| 17 | Gate | D4 top-down mini-court IN scope | Taste → ACCEPTED | — | hero moment, ~30–45 min CC, pure client math | defer |
| 18 | Design | 4-step wizard IA (Upload→Calibrate→Analyze→Review) | Mechanical | P5 | linear flow matches the pipeline; stepper shows progress | free-form nav |
| 19 | Design | Dark "broadcast" theme, APP-UI rules | Taste (low stakes) | P5 | demo runs on a projector in a dark room; broadcast look sells referee framing | light theme |
| 20 | Design | IN=green / OUT=red badges, mono numerals for t= | Mechanical | P5 | instant legibility at distance | subtle palette |
| 21 | Design | Corner-click magnifier loupe | Mechanical | P2 | 3px click error = 20–40cm court error; loupe is ~20 min CC | bare clicks |
| 22 | Design | Timeline markers: ≥8px spacing, cluster+count badge when denser | Mechanical | P5 | 30s clip can have 10+ bounces; overlap = unclickable | overlap |
| 23 | Design | Ball-gap rendering: fade trail during missed detections, never freeze dot | Mechanical | P1 | frozen dot reads as bug on projector | freeze last position |
| 24 | Design | Mobile explicitly out of scope tonight | Mechanical | P3 | desktop/projector demo; noted in NOT-in-scope | responsive pass |

## Phase 2 — Design Review (via /autoplan)

### Step 0 — Scope
Initial design completeness: **4/10** (mechanics specified; zero visual hierarchy, states, or layout). No DESIGN.md (gap — /design-consultation deferred, universal principles apply). Greenfield: no existing patterns; vocabulary = shadcn/ui (Button, Progress, Badge, Tooltip, Dialog; Cards only where the card IS the interaction — clip picker). Classifier: **APP UI** → calm surface hierarchy, utility copy, no card mosaics.

### Passes
1. **Information Architecture 4→9/10.** Fix applied: linear 4-step wizard with stepper.
```
[1 Upload] ──▶ [2 Calibrate] ──▶ [3 Analyze] ──▶ [4 Review]
 drag-drop      frame-1 still     progress bar     ┌─────────────────────────┐
 or demo-clip   click 4 corners   stage label      │  VIDEO + canvas overlay │ 1st
 picker         loupe + undo      frames n/N       │  (the anchor, ~70% w)   │
                numbered dots     cancel           ├─────────────────────────┤
                                                   │  timeline + markers     │ 2nd
                                                   ├───────────┬─────────────┤
                                                   │ mini-court│ event panel │ 3rd
                                                   └───────────┴─────────────┘
```
2. **Interaction States 3→9/10.** Fix applied — what the user SEES:
| Feature | LOADING | EMPTY | ERROR | SUCCESS | PARTIAL |
|---|---|---|---|---|---|
| Upload | progress % on drop zone | drop zone + "try the demo clip" CTA | toast + retry, format hint | auto-advance to Calibrate | — |
| Calibrate | frame-1 skeleton | "Click the 4 corners, start top-left" helper | degenerate-quad warning, re-click | 4 numbered dots + quad outline, Continue enables | undo per-dot |
| Analyze | stage label + bar + n/N frames | — | "Analysis failed" + retry (error.json) | auto-advance | cancel returns to Upload |
| Review | skeleton layout | "No bounces detected — try a clearer clip" + low-detection banner | JSON parse error state | overlay + markers live | detection gaps → trail fades |
| Timeline | — | no markers, message above | — | IN/OUT colored markers, click seeks | cluster badge if dense |
| Mini-court | — | hidden until an event selected | — | bounce dot + badge + margin ("OUT by 12cm" / "TOO CLOSE") | — |
3. **Journey/Emotional Arc 5→8/10.** Pit = the wait. Storyboard: drop clip (anticipation) → corner clicks (agency, "I'm setting the rules") → progress with live frame count (trust) → reveal: first marker click triggers slow-mo + court cut (payoff). Demo-cache path makes the reveal instant for judges; live run kicked off at talk start as proof.
4. **AI Slop 6→9/10.** Bans for this build: no purple gradients, no 3-col icon-circle grids, no centered-everything, no emoji decor, real type (Geist is fine — it ships with Next and doesn't read as default), broadcast-dark surface, one accent (chalk white on court green; IN green / OUT red are semantic, not decorative).
5. **Design System 5/10 (accepted).** No DESIGN.md; tokens declared inline above (CSS variables). Full consultation deferred — tonight ships on shadcn defaults + declared tokens.
6. **Responsive & A11y 3→7/10.** Desktop/projector only (logged #24). Cheap a11y kept: arrow-key seek (±1 frame / ±5s with shift), visible focus rings, 4.5:1 contrast on all text, ≥24px hit areas on markers via padding (44px would swallow the timeline), loupe doubles as precision aid.
7. **Unresolved decisions — all resolved above** (#18–24 and #25–30 below). None deferred.

### Design Dual Voices [subagent-only — Codex CLI not installed]
**CLAUDE SUBAGENT (design — independent review), key findings folded into the plan:**
- **Demo-clips-first upload screen** (CRITICAL): plan calls the cache "the demo spine" but the flow opens on live upload — invert: 2–3 demo clip cards with thumbnails first and largest, dropzone secondary. → #25
- **Calibrate frame may not show the court** (intro/pan frames): add a small scrubber — "pick a frame showing the full court." → #26
- **Cold-start dead zone**: progress bar stuck at 0 for 30–60s before `progress.json` exists — explicit "Warming up the model…" pre-stage; narrated stage labels ("Finding players… Tracking ball… frame 412/900") double as demo patter. → #27
- **Results arrival is flat**: auto-seek to the first event and fire slow-mo + mini-court badge unprompted on load. → #28
- **Store corners in intrinsic pixel space** (displayed-size→native-resolution scaling is a classic bug); loupe or click-then-arrow-nudge. → #29
- **Hide native video controls** (custom timeline only — two seek bars confuse); projector legibility: ≥4px canvas strokes, filled IN/OUT badges with text labels, never color alone. → #30
- Mobile skip, trail-fade on gaps, wizard structure, dark theme: agrees with primary review (#18, #19, #23, #24).

```
DESIGN DUAL VOICES — LITMUS SCORECARD [subagent-only, APP-UI adapted]:
═══════════════════════════════════════════════════════════════
  Check                                   Claude  Subagent  Consensus
  ──────────────────────────────────────  ──────  ────────  ─────────
  1. Product unmistakable on first screen? YES*    YES*      CONFIRMED (*after demo-clips-first fix)
  2. One strong visual anchor?             YES     YES       CONFIRMED (video+overlay)
  3. Scannable structure?                  YES     YES       CONFIRMED (wizard + stepper)
  4. Each section one job?                 YES     YES       CONFIRMED
  5. Cards actually necessary?             YES     YES       CONFIRMED (only clip picker)
  6. Motion improves hierarchy?            YES     YES       CONFIRMED (slow-mo replay, court cut)
  7. Premium w/o decorative chrome?        YES     YES       CONFIRMED (broadcast-dark, semantic color)
  Hard rejections triggered:               0       0         CONFIRMED
═══════════════════════════════════════════════════════════════
No disagreements → no new taste decisions from this phase.
```

| # | Phase | Decision | Class | Principle | Rationale | Rejected |
|---|-------|----------|-------|-----------|-----------|----------|
| 25 | Design | Demo-clips-first upload hierarchy | Mechanical | P1 | demo opens on the safe path; upload secondary | upload-first |
| 26 | Design | Calibration frame scrubber | Mechanical | P1 | frame 1 may not show the court | frame-1 only |
| 27 | Design | "Warming up…" pre-stage + narrated stages | Mechanical | P1 | cold-start dead zone reads as hang | bar at 0% |
| 28 | Design | Auto-play first line call on results load | Mechanical | P3 | payoff delivered unprompted | video at 0:00 |
| 29 | Design | Corners stored in intrinsic pixel space + nudge keys | Mechanical | P5 | kills the display-scale coordinate bug | CSS-pixel coords |
| 30 | Design | Hide native controls; ≥4px strokes; filled text badges | Mechanical | P1 | projector legibility, one seek bar | native controls + thin strokes |

## Phase 3 — Eng Review (via /autoplan)

### Step 0 — Scope challenge
~10 source files, 0 new services beyond the one Lambda — under the 8-file/2-service smell threshold; scope held (never reduced per P2). Complete version chosen over shortcuts throughout (Lake principle): full state coverage, error.json path, cache tooling. **Architecture insight [EUREKA-lite]:** with events client-side (D3), Lambda needs no corner data → **invoke inference immediately on upload completion; the user calibrates corners WHILE inference runs.** The 1–4 min wait hides inside a step the user does anyway; the Analyze screen only shows remaining time. (Search check: no WebSearch performed — in-distribution knowledge; ultralytics/OpenCV/AWS SDK are Layer-1 tools, nothing custom-rolled where a built-in exists.)

### Section 1 — Architecture (1 issue, auto-decided)
```
┌─ Vercel (Next.js App Router) ──────────────────────────────┐
│ /            wizard page (client)                          │
│ /api/presign POST → S3 presigned PUT {id, url}             │
│ /api/analyze POST → Lambda async invoke {videoKey}         │
│ /api/results/[id] GET → proxies S3 results/progress/error  │
└──────┬──────────────────────────────▲──────────────────────┘
       │ presigned PUT                │ poll 2s (hard stop 6 min)
       ▼                              │
  S3 bucket (private): uploads/{id}.mp4 ─▶ Lambda (ECR image, 10GB,
       results/{id}.json  progress/{id}.json   timeout 600s, reserved
       errors/{id}.json   ◀────────────────────concurrency 5) YOLOv8n+cv2
Client-side math: homography (corners→court), bounce detect (y-max+velocity),
point-in-polygon → events[] — pure functions in lib/, unit-testable.
```
- Happy: upload → invoke → poll progress → results → calibrate+compute → render.
- Nil: `ball:null` frames → interpolation layer; no frames at all → error.json.
- Empty: `events:[]` → designed empty state.
- Error: Lambda crash → error.json; poll timeout → error state. All four paths land in specified UI.
- **A1 (auto-decided):** trigger = API-route async invoke, NOT S3 event notification. Rationale (P5 explicit): S3 triggers are invisible during live debugging and can double-fire; an explicit invoke returns an immediate error if IAM/params are wrong. Rollback: everything redeployable in minutes; no migrations.

### Section 2 — Code Quality (2 findings, auto-decided)
- Q1: results type defined ONCE in `lib/types.ts`, Python emits matching shape; a 5-line zod parse at fetch guards drift (P5).
- Q2: bounce/homography/PIP as pure functions in `lib/referee.ts` — no React imports, unit-testable, tunable constants exported (`MIN_FLIP_FRAMES`, `SMOOTH_WINDOW`). VFR caveat: Lambda MUST use `CAP_PROP_POS_MSEC` per frame for `t`, never `frame_idx / fps` — phone video is variable-frame-rate and index-math drifts seconds by clip end.

### Section 3 — Test Review
```
NEW UX FLOWS: upload(demo|file) / calibrate(scrub,click,undo,nudge) / analyze(progress,cancel)
              / review(seek,marker click,slow-mo,court view)
NEW DATA FLOWS: presign→PUT→invoke / lambda→progress,results,error JSON / poll→parse→compute→render
NEW CODEPATHS: interpolate gaps / smooth / bounce y-max+flip / homography project / PIP+margin
              / marker clustering / intrinsic↔display coord map
NEW EXTERNAL CALLS: S3 PUT+GET, Lambda invoke, ECR push
NEW ERROR PATHS: upload fail / codec reject / lambda crash / poll timeout / empty events / parse fail
COVERAGE PLAN (tonight):
[unit — vitest, ~30 min CC]                          [manual E2E — checklist]
 ├── bounce detector: synthetic parabolic bounce      ├── demo clip end-to-end on prod URL
 │    → exactly 1 event at known t (2am test)         ├── HEVC .mov rejected with clear copy
 ├── racket-hit trajectory → 0 events                 ├── kill Lambda mid-run → error state
 ├── gap interpolation: 30% nulls → continuous        ├── refresh mid-poll → recovers via id in URL
 ├── homography: known corners → known court pos      └── projector check: strokes/badges legible
 ├── PIP margin: on-line ball → IN (ITF rule),
 │    outside by ε → OUT, inside error bound → TOO CLOSE
 └── coord mapping: intrinsic↔display roundtrip
[python harness — scripts/run_local.py]: runs pipeline on demo clip locally; prints
 detectionRate; writes cache JSON (this IS the E1 tool + the hour-one P1 validation)
```
Regression rule: N/A (no existing behavior). Eval suites: N/A (no LLM). Flakiness: unit set is pure-function, deterministic.
- **T1 (auto-decided, P1):** unit set above ships tonight — it's the only way to debug bounce logic at 2am without re-watching video.

### Section 4 — Performance (2 findings, auto-decided)
- PF1: canvas draw loop = rAF + refs; React state only for selected event/step. Frame lookup by binary search over sorted t.
- PF2: person boxes every 3rd frame (interpolate), ball attempted every frame; imgsz 960; if local harness shows >3 min for 30s clip → drop to every-2nd-frame ball + imgsz 800. Poll 2s. Results JSON ~100–300KB (fine).
- Security (folded, hackathon-calibrated): presign constrained (ContentType whitelist, ≤60MB, 5-min expiry); bucket private, GETs proxied server-side; Lambda reserved concurrency 5 + 600s timeout caps worst-case spend; S3 lifecycle: delete objects after 1 day.

### Worktree parallelization
| Lane | Steps | Modules | Depends on |
|---|---|---|---|
| A | S3+IAM+ECR+Lambda infra, first image push via **AWS CloudShell** (no local Docker) | aws/ | — |
| B | detect.py + scripts/run_local.py + hour-one ball validation | lambda/ | — |
| C | wizard UI + canvas + referee math on fixture JSON | app/, lib/ | — |
| D | wire live path, E1 cache, warm-ping, demo run | all | A+B+C |
Launch A, B, C in parallel; D is the integration hour. B's harness unblocks the go/no-go on YOLO vs HSV fallback — run it first.

### Eng Dual Voices [subagent-only — Codex CLI not installed]
**CLAUDE SUBAGENT (eng — independent review), 12 findings, all folded in (F2/F5 convergent with primary review):**
- **F1** Async invoke (`InvocationType='Event'`, return 202) AND `MaximumRetryAttempts=0` — default async config retries a crashing Lambda 2×: triple cost, `error.json` overwritten mid-poll.
- **F2** Invoke on upload-complete; calibrate during inference (convergent with primary EUREKA). Flagged stale audit row #12 → struck.
- **F3** Poll a Next API route returning 200/202/500 (presigned GET on a missing key 403s, not 404s — indistinguishable from broken). Client UUID jobId, validated by regex in API routes; keys `uploads/{id}.mp4`, `results/{id}/{progress,results,error}.json`.
- **F4** Play video + extract calibration frames from the local `File` via `URL.createObjectURL` — no presigned GET, no read CORS, no tainted canvas. Tradeoff: refresh loses the local video (demo clips live in `/public`, immune). Accepted (P3).
- **F5** `t` from `cv2.CAP_PROP_POS_MSEC` (PTS), never index/fps (VFR drift); re-encode demo-cache clips to CFR with ffmpeg.
- **F6** Phantom-bounce guard: never emit an event whose apex frame is interpolated — require real detections within ±2 frames of apex. **Added to bounce spec.**
- **F7** OpenCV opens corrupt files without throwing: check `isOpened()` and `framesRead>0`, else `error.json`.
- **F8** Billing bomb: reserved concurrency **3**, timeout **480s** (supersedes 5/600s), presign expiry 5 min, lifecycle 1 day.
- **F9** Correction to primary review: presigned **PUT cannot enforce content-length** (only POST can) — size gate is client-side only; residual risk accepted tonight given F8 caps worst-case spend.
- **F10 [AMENDED 2026-07-24 — no local Docker]** Container traps: build **x86_64** in AWS CloudShell (x86_64 host, Docker/git/CLI preinstalled) + **x86_64 Lambda** (native match, no emulation — CloudShell is x86_64 so this removes the original arm64-cross-build risk entirely); CPU-only torch via `--index-url .../cpu` for the **x86_64/manylinux** wheel + `opencv-python-headless` (else ~4GB CUDA bloat); `YOLO_CONFIG_DIR=/tmp` (read-only FS crash); bake weights into image; **push to ECR before writing any frontend code**.
- **F11** One `videoToCanvas()` helper (scale + letterbox offset, ResizeObserver) shared by calibration and overlay — or the same bug gets fixed three times.
- **F12** Frame extraction: seek to 0.1s and await `seeked` before `drawImage` (t=0 is often black).
- Non-issues confirmed: S3 is strongly consistent (no handling needed); double-submission benign with UUID keys.

```
ENG DUAL VOICES — CONSENSUS TABLE [subagent-only]:
═══════════════════════════════════════════════════════════════
  Dimension                        Claude   Subagent  Consensus
  ───────────────────────────────  ───────  ────────  ─────────
  1. Architecture sound?           YES      YES*      CONFIRMED (*after F1/F3/F4 specifics)
  2. Test coverage sufficient?     YES      YES       CONFIRMED (same 2am unit set independently)
  3. Performance risks addressed?  YES      YES       CONFIRMED (F10 build traps added)
  4. Security threats covered?     PARTIAL  PARTIAL   CONFIRMED (F8 fix; F9 corrected primary claim)
  5. Error paths handled?          YES      YES*      CONFIRMED (*F6/F7 added)
  6. Deployment risk manageable?   YES      YES       CONFIRMED (ECR-first ordering)
═══════════════════════════════════════════════════════════════
No cross-voice disagreements. F9 = intra-review correction, logged.
```

| # | Phase | Decision | Class | Principle | Rationale | Rejected |
|---|-------|----------|-------|-----------|-----------|----------|
| 31 | Eng | Async invoke + MaximumRetryAttempts=0 | Mechanical | P5 | silent retries corrupt poll state and 3× cost | default retries |
| 32 | Eng | Poll via API route (200/202/500), UUID-validated ids | Mechanical | P5 | 403≠404 on presigned GET; explicit states | presigned-GET polling |
| 33 | Eng | Local objectURL for playback + calibration | Mechanical | P3 | no read-CORS/tainted canvas; demo clips in /public | presigned GET + CORS |
| 34 | Eng | Phantom-bounce guard (real detections ±2 frames of apex) | Mechanical | P1 | interpolation must not fabricate events | raw interpolated apex |
| 35 | Eng | Reserved concurrency 3, timeout 480s | Mechanical | P1 | caps worst-case spend with no auth | 5/600s (primary's looser cap) |
| 36 | Eng | Keep presigned PUT; accept size-gate limitation | Mechanical | P3 | POST swap not worth it tonight given F8 | presigned POST |
| 37 | Eng | ~~arm64 image~~ **x86_64 image built in AWS CloudShell (amended)**, CPU torch, headless cv2, YOLO_CONFIG_DIR=/tmp, ECR push first | Mechanical | P5 | each trap costs 30–60 min tonight if hit; user has no local Docker | discover at 1am / require Docker install |
| 38 | Eng | Single videoToCanvas() helper + ResizeObserver | Mechanical | P4 | one transform, three consumers | per-component math |

### Phase Completion Summaries
- **CEO:** mode SELECTIVE EXPANSION; 6 premises challenged (3 amended); alternatives A/B/C produced; 7 expansions (5 accepted, 2 deferred); 11 sections run; error registry 7 rows; failure modes 4 (0 open critical gaps); dual voices [subagent-only] 6/6 confirmed; 2 user challenges + 1 taste → resolved at gate D1–D4.
- **Design:** completeness 4/10 → 9/10; passes: IA 9, States 9, Journey 8, Slop 9, System 5 (accepted), Responsive/A11y 7, Decisions 13/13 resolved; scorecard 7/7 confirmed, 0 hard rejections; 0 unresolved.
- **Eng:** scope held; 4 sections run; architecture diagram + 4-path data flow; test diagram + artifact written (`~/.gstack/projects/vivekajayjariwala-night-hack/vivekjariwala-main-test-plan-20260724-203900.md`); 12 subagent findings folded; failure modes closed; parallelization 4 lanes (3 parallel + 1 integration); 0 unresolved. TODOS.md written (7 items).

### Cross-Phase Themes (independent multi-phase signals — high confidence)
1. **The wait is the product risk** — CEO (E2 progress, cold start), Design (#27 warming pre-stage, narration), Eng (F2 calibrate-during-inference). Three independent voices converged: hide, narrate, and parallelize the 1–4 min.
2. **Demo-cache-first** — CEO (E1 spine), Design (#25 clips-first hierarchy), Eng (F5 CFR re-encode of cached clips). The live path is the proof; the cached path is the demo.
3. **Calibration precision pipeline** — CEO (loupe, TOO CLOSE honesty), Design (#29 intrinsic coords, nudge keys), Eng (F11 single transform helper). Same bug class flagged three ways.

## Implementation Tasks
Aggregated across phases, priority-sorted. Suggested order: T1 (push image while working) → C1 (go/no-go on YOLO) → T4+T5+D1 in parallel → rest.

- [ ] **C1 (P1, CC ~30min) — lambda** — Hour-one ball-detection validation harness with HSV+frame-diff fallback decision (`lambda/detect.py`, `scripts/run_local.py`)
- [ ] **C2 (P1, CC ~20min) — frontend** — Precomputed demo-clip cache: CFR clips in `/public` + cached results JSON
- [ ] **C5 (P1, CC ~10min) — frontend** — Upload gate: MP4(H.264)/WebM only, ≤30s, ≤60MB (client-side)
- [ ] **D1 (P1, CC ~30min) — app** — 4-step wizard with stepper; demo-clips-first upload hierarchy
- [ ] **D2 (P1, CC ~40min) — app** — Full interaction-state coverage (loading/empty/error/success/partial per step)
- [ ] **D3 (P1, CC ~45min) — app** — Calibration UX: frame scrubber, loupe, numbered dots, undo, arrow-nudge, intrinsic-pixel coords
- [ ] **T1 (P1, CC ~45min) — aws** — ECR **x86_64** image FIRST, built via **AWS CloudShell** (no local Docker): CPU torch index, opencv-python-headless, `YOLO_CONFIG_DIR=/tmp`, weights baked (`lambda/Dockerfile`)
- [ ] **T2 (P1, CC ~20min) — aws** — Lambda: async invoke `MaximumRetryAttempts=0`, reserved concurrency 3, 480s, 10GB; S3 lifecycle 1d + PUT-only CORS
- [ ] **T3 (P1, CC ~40min) — lambda** — `detect.py`: POS_MSEC timestamps, isOpened/framesRead guards, progress.json + error.json
- [ ] **T4 (P1, CC ~45min) — lib** — `lib/referee.ts` pure functions (interpolate, median-smooth, y-max+velocity-flip, phantom guard, homography, PIP margin) + vitest 2am unit set
- [ ] **T5 (P1, CC ~30min) — app** — API routes: presign / analyze(202) / results(200/202/500) with UUID validation
- [ ] **C3 (P2, CC ~20min) — frontend** — progress.json progress UI + pre-demo warm-ping
- [ ] **C4 (P2, CC ~30min) — frontend** — Ball comet-trail + slow-mo auto-replay on marker click
- [ ] **D4 (P2, CC ~20min) — app** — Results reveal: auto-seek first event, fire slow-mo + mini-court badge unprompted
- [ ] **D5 (P2, CC ~30min) — app** — Broadcast-dark theme, ≥4px strokes, filled IN/OUT text badges, hide native controls
- [ ] **T6 (P2, CC ~20min) — lib** — Single `videoToCanvas()` helper + ResizeObserver; rAF overlay loop with refs
- [ ] **T7 (P2, CC ~35min) — app** — Top-down SVG mini-court: bounce dot, IN/OUT badge, margin cm / TOO CLOSE

## Environment Amendment — 2026-07-24, post-approval

User has no local Docker and does not want to install it; ~$25 AWS credit; hard deadline 11:45pm.

**T1 build mechanism changed:** local Docker build → **AWS CloudShell** (browser shell, Docker/git/AWS CLI preinstalled, x86_64 host). All arm64 references (T1, F10, audit row 37) flipped to **x86_64** — this also removes F10's original cross-arch risk since build host (CloudShell) and run host (Lambda) now match natively.

**Local tooling:** `brew install awscli` only. AWS SDK credentials for the Next.js API routes come from the same local AWS CLI credentials (`~/.aws/credentials`, written by `aws configure`, never touches the repo or chat). If a `.env.local` is created for any AWS-region/bucket-name config (non-secret), it must be gitignored — secrets themselves never go in an env file for this project, only in `~/.aws/credentials`.

**Budget flag:** LOW risk against $25 at hackathon-night volume. Lambda (10GB × ≤480s × reserved concurrency 3) worst-case is cents per run even at dozens of invocations; ECR storage of a ~2GB image is fractions of a cent per day; S3/CloudShell are free-tier/no-charge for this usage. **One real trap to avoid: do NOT put the Lambda in a VPC.** A VPC-attached Lambda that needs internet/AWS-API access typically requires a NAT Gateway, which runs ~$0.045/hr + data processing — that alone could burn a meaningful slice of $25 over a few hours if left running. Lambda stays in the default (no VPC) network config; it only talks to S3/ECR over AWS's internal network, so no NAT is needed.

**Plan-B checkpoint — 9:30pm hard cutover if T1 (CloudShell image build) is not done:**
Recommended fallback (in order of preference): **skip Lambda/Docker/ECR entirely for tonight and run `scripts/run_local.py` (already required by C1) directly on the laptop**, writing results JSON into `public/demo/` (the same cache path C2 already builds). This costs zero new build time — C1 and C2 are already scope — and only drops the "live upload triggers a Lambda invocation" path (T2/T3/T5's AWS wiring); calibration, canvas overlay, referee math, timeline, and mini-court are all untouched and still demo live. Pitch framing: "runs locally tonight; architected as serverless for production." Escalate only if that's somehow also blocked: (b) zip-based Lambda using classical CV only (HSV+frame-diff, no torch/ultralytics, opencv via a public Lambda Layer ARN) — avoids Docker but is new code at a stressed hour, higher risk than (a); (c) a hosted inference API (e.g. Roboflow) called directly from a Next.js API route — fastest to wire but introduces a new third-party dependency and model-compatibility unknown at 9:30pm. Default to (a) unless there's a specific reason it doesn't work.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAR (PLAN via /autoplan) | 7 proposals, 5 accepted, 2 deferred |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — (Codex CLI not installed; Claude subagent voices ran per-phase) | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN via /autoplan) | 17 issues, 0 critical gaps (all folded into plan) |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR (PLAN via /autoplan) | score: 4/10 → 9/10, 13 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | SKIPPED | no developer-facing scope |

- **VERDICT:** CEO + ENG + DESIGN CLEARED — ready to implement. Approved by user at gate D5 on 2026-07-24.

NO UNRESOLVED DECISIONS
