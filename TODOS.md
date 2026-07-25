# TODOS

Deferred from /autoplan review, 2026-07-24 (hackathon night). Context: RefAI virtual tennis referee — upload clip → YOLO detection on Lambda → client-side bounce/IN-OUT calls on canvas overlay + timeline.

- [ ] **Hawk-Eye challenge animation (E6)** — P3, human L / CC M
  - What: animated zoom-in on the bounce with a rendered ball-deformation ellipse, Hawk-Eye style.
  - Why: maximum theater for pitches/marketing after the hackathon.
  - Cons: multi-hour rendering work; zero extra correctness.
  - Depends on: mini-court view (shipped tonight).
- [ ] **Shareable result links / clip gallery (E7)** — P3, human M / CC S
  - What: results id in URL is already shareable server-side; add an index page + OG images.
  - Why: lets judges/others replay analyses after the event.
- [ ] **Doubles-court toggle** — P3, human S / CC S
  - What: IN/OUT vs doubles lines; tonight is hard-coded singles (labeled in UI).
- [ ] **Automatic court detection** — P3, human XL / CC L
  - What: replace manual 4-corner calibration with line-detection (Hough + court model fit).
  - Why: removes the only manual step; the JSON contract already supports it.
- [ ] **DESIGN.md via /design-consultation** — P3, CC S
  - What: real design system (tokens committed); tonight ships declared-inline tokens on shadcn defaults.
- [ ] **Mobile/touch support** — P3, human M / CC M
  - What: touch calibration, responsive layout; tonight is min-width desktop (projector demo).
- [ ] **Chunked parallel Lambda inference** — P3, human M / CC M
  - What: split frames across N concurrent invocations, merge JSON; ~Nx faster wall-clock.
  - Why: only needed if clips grow beyond 30s; reserved-concurrency cap must be revisited.
