import { describe, expect, it } from "vitest";
import {
  applyHomography,
  classify,
  computeEvents,
  computeHomography,
  findBounceIndices,
  interpolateAndSmooth,
  isDegenerateQuad,
  marginMeters,
  nearestIndexByTime,
  COURT,
  SINGLES_RECT,
} from "./referee";
import type { CourtCorners, Frame } from "./types";

// Synthetic parabolic ball trajectory: y = a*(t-t0)^2 + yPeak, minimum screen-y
// at t0 means the ball is HIGHEST at t0 (screen y grows downward), so the
// bounce (lowest point) is the local MAXIMUM of this parabola in y.
function syntheticBounce(bounceT: number, opts: { withGaps?: boolean; racketHit?: boolean } = {}): Frame[] {
  const frames: Frame[] = [];
  const fps = 30;
  const duration = 1.0; // 1s window centered on the bounce
  const start = bounceT - duration / 2;
  const peakY = 800; // screen-y at the bounce apex (near ground/bottom of frame)
  const apexSharpness = 4000; // px per s^2

  for (let f = 0; f <= duration * fps; f++) {
    const t = start + f / fps;
    let y: number;
    if (opts.racketHit) {
      // sharp single-frame spike then continues descending — not a real bounce
      y = Math.abs(t - bounceT) < 1 / fps ? peakY : peakY - apexSharpness * Math.pow(t - bounceT, 2) * 0.3;
    } else {
      y = peakY - apexSharpness * Math.pow(t - bounceT, 2);
    }
    const x = 400 + (t - start) * 50;
    const isGap = opts.withGaps && f % 3 === 0 && Math.abs(t - bounceT) > 2 / fps;
    frames.push({
      t,
      boxes: [],
      ball: isGap ? null : { x, y, conf: 0.7 },
    });
  }
  return frames;
}

describe("interpolateAndSmooth", () => {
  it("produces a continuous trajectory even with 30%+ nulls", () => {
    const frames = syntheticBounce(0.5, { withGaps: true });
    const nullCount = frames.filter((f) => f.ball === null).length;
    expect(nullCount / frames.length).toBeGreaterThan(0.2);

    const samples = interpolateAndSmooth(frames);
    expect(samples.length).toBeGreaterThan(0);
    for (const s of samples) {
      expect(Number.isFinite(s.pos.x)).toBe(true);
      expect(Number.isFinite(s.pos.y)).toBe(true);
    }
  });
});

describe("findBounceIndices", () => {
  it("finds exactly one bounce at the known apex time", () => {
    const bounceT = 0.5;
    const frames = syntheticBounce(bounceT);
    const samples = interpolateAndSmooth(frames);
    const idx = findBounceIndices(samples);
    expect(idx.length).toBe(1);
    expect(samples[idx[0]].t).toBeCloseTo(bounceT, 1);
  });

  it("rejects a racket-hit spike (no sustained velocity flip)", () => {
    const frames = syntheticBounce(0.5, { racketHit: true });
    const samples = interpolateAndSmooth(frames);
    const idx = findBounceIndices(samples);
    expect(idx.length).toBe(0);
  });

  it("still finds the bounce with interpolated gaps, guarded by real detections nearby", () => {
    const frames = syntheticBounce(0.5, { withGaps: true });
    const samples = interpolateAndSmooth(frames);
    const idx = findBounceIndices(samples);
    expect(idx.length).toBe(1);
  });
});

describe("homography", () => {
  it("maps known corners to known court positions", () => {
    // Pretend the camera sees the court as a simple 1000x2000px rectangle (no perspective) for this test
    const corners: CourtCorners = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 2000 },
      { x: 0, y: 2000 },
    ];
    const h = computeHomography(corners);

    const tl = applyHomography(h, { x: 0, y: 0 });
    expect(tl.x).toBeCloseTo(0, 3);
    expect(tl.y).toBeCloseTo(0, 3);

    const center = applyHomography(h, { x: 500, y: 1000 });
    expect(center.x).toBeCloseTo(COURT.DOUBLES_WIDTH / 2, 3);
    expect(center.y).toBeCloseTo(COURT.LENGTH / 2, 3);

    const br = applyHomography(h, { x: 1000, y: 2000 });
    expect(br.x).toBeCloseTo(COURT.DOUBLES_WIDTH, 3);
    expect(br.y).toBeCloseTo(COURT.LENGTH, 3);
  });
});

describe("isDegenerateQuad", () => {
  it("rejects collinear points", () => {
    const corners: CourtCorners = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
      { x: 300, y: 0 },
    ];
    expect(isDegenerateQuad(corners)).toBe(true);
  });

  it("rejects a too-small quad", () => {
    const corners: CourtCorners = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
      { x: 0, y: 5 },
    ];
    expect(isDegenerateQuad(corners)).toBe(true);
  });

  it("accepts a normal convex quad", () => {
    const corners: CourtCorners = [
      { x: 100, y: 100 },
      { x: 900, y: 120 },
      { x: 950, y: 900 },
      { x: 50, y: 880 },
    ];
    expect(isDegenerateQuad(corners)).toBe(false);
  });
});

describe("marginMeters + classify", () => {
  it("calls an on-line ball IN (ITF rule: touching the line is in)", () => {
    const onLine = { x: SINGLES_RECT.xmin, y: COURT.LENGTH / 2 };
    const margin = marginMeters(onLine);
    expect(margin).toBeCloseTo(0, 5);
    expect(classify(margin)).toBe("IN");
  });

  it("calls a ball clearly outside by more than the error bound OUT", () => {
    const wide = { x: SINGLES_RECT.xmin - 1.0, y: COURT.LENGTH / 2 };
    const margin = marginMeters(wide);
    expect(classify(margin)).toBe("OUT");
  });

  it("calls a ball just outside, within the calibration error bound, TOO_CLOSE", () => {
    const justOut = { x: SINGLES_RECT.xmin - 0.05, y: COURT.LENGTH / 2 };
    const margin = marginMeters(justOut);
    expect(classify(margin)).toBe("TOO_CLOSE");
  });
});

describe("nearestIndexByTime", () => {
  it("round-trips to the closest sample", () => {
    const items = [{ t: 0 }, { t: 1 }, { t: 2 }, { t: 3 }];
    expect(nearestIndexByTime(items, 1.4)).toBe(1);
    expect(nearestIndexByTime(items, 1.6)).toBe(2);
    expect(nearestIndexByTime(items, -5)).toBe(0);
    expect(nearestIndexByTime(items, 100)).toBe(3);
  });
});

describe("computeEvents end-to-end", () => {
  it("produces a single well-formed event for a synthetic in-bounds bounce", () => {
    const corners: CourtCorners = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 2000 },
      { x: 0, y: 2000 },
    ];
    const frames = syntheticBounce(0.5);
    // Force the apex position into court space near the center by construction of syntheticBounce's x/y range.
    const events = computeEvents(frames, corners);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("BOUNCE");
    expect(["IN", "OUT", "TOO_CLOSE"]).toContain(events[0].call);
    expect(Number.isFinite(events[0].confidence)).toBe(true);
  });
});
