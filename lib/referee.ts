import type { BounceEvent, CourtCorners, Frame, LineCall, Point } from "./types";

// Tunable constants (PLAN.md Decision Q2) — kept here, not buried in components.
export const SMOOTH_WINDOW = 3; // median filter taps
export const MIN_FLIP_FRAMES = 3; // consecutive descending/ascending frames required around a bounce apex
export const PHANTOM_WINDOW = 2; // apex must have a real (non-interpolated) detection within this many frames (Decision F6)
export const ERROR_BOUND_M = 0.2; // calibration error bound in meters (~20cm at far baseline per corner-click precision estimate)
export const MIN_FLIP_MAGNITUDE_PX = 40; // min net y-movement (px) over MIN_FLIP_FRAMES on each side of the apex — rejects gentle arcs (racket hits, lobs) per CEO review P4 "min magnitude" mitigation. Raised from 20 — the HSV/frame-diff fallback tracker is jittery enough that 20px of noise alone could clear the old bar, over-firing bounce events.

// Standard tennis court dimensions (meters).
export const COURT = {
  DOUBLES_WIDTH: 10.97,
  SINGLES_WIDTH: 8.23,
  LENGTH: 23.77,
};
export const SIDELINE_INSET = (COURT.DOUBLES_WIDTH - COURT.SINGLES_WIDTH) / 2; // 1.37m
export const SINGLES_RECT = {
  xmin: SIDELINE_INSET,
  xmax: COURT.DOUBLES_WIDTH - SIDELINE_INSET,
  ymin: 0,
  ymax: COURT.LENGTH,
};

// ---------------------------------------------------------------------------
// Trajectory: gap interpolation + median smoothing
// ---------------------------------------------------------------------------

export interface Sample {
  t: number;
  pos: Point;
  real: boolean; // true if this index had an actual (non-interpolated) detection
  conf: number;
}

function median(vals: number[]): number {
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Linearly interpolates gaps in the ball trajectory, then applies a median
 * filter to x/y independently. Trims to the span between the first and last
 * real detection — we never extrapolate beyond real data.
 */
export function interpolateAndSmooth(frames: Frame[], smoothWindow = SMOOTH_WINDOW): Sample[] {
  const n = frames.length;
  const raw: (Point | null)[] = frames.map((f) => (f.ball ? { x: f.ball.x, y: f.ball.y } : null));
  const conf: number[] = frames.map((f) => f.ball?.conf ?? 0);
  const ts = frames.map((f) => f.t);
  const real = raw.map((p) => p !== null);

  const firstReal = real.indexOf(true);
  const lastReal = real.lastIndexOf(true);
  if (firstReal === -1) return [];

  const interpolated: Point[] = new Array(n);
  for (let i = firstReal; i <= lastReal; i++) {
    if (raw[i]) {
      interpolated[i] = raw[i]!;
      continue;
    }
    let lo = i - 1;
    while (lo >= firstReal && !raw[lo]) lo--;
    let hi = i + 1;
    while (hi <= lastReal && !raw[hi]) hi++;
    const a = raw[lo]!;
    const b = raw[hi]!;
    const frac = (ts[i] - ts[lo]) / (ts[hi] - ts[lo]);
    interpolated[i] = { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac };
  }

  const half = Math.floor(smoothWindow / 2);
  const out: Sample[] = [];
  for (let i = firstReal; i <= lastReal; i++) {
    const lo = Math.max(firstReal, i - half);
    const hi = Math.min(lastReal, i + half);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let j = lo; j <= hi; j++) {
      xs.push(interpolated[j].x);
      ys.push(interpolated[j].y);
    }
    out.push({ t: ts[i], pos: { x: median(xs), y: median(ys) }, real: real[i], conf: conf[i] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bounce detection: local max of screen-y (lowest point on screen = ground)
// with a sustained descend->ascend velocity flip, guarded against phantom
// (fully-interpolated) apexes. Screen y increases downward, so a bounce is a
// local MAXIMUM of y, not a minimum (Decision D2 — corrects the original
// image-coordinate sign bug).
// ---------------------------------------------------------------------------

/**
 * Returns indices into `samples` where a validated bounce apex occurs.
 *
 * Two things beyond a plain sign-flip check, both required to match real
 * (and realistically-synthetic) trajectories:
 *
 *  1. Non-strict monotonicity. A median-smoothed, near-symmetric peak (the
 *     textbook clean bounce) reliably produces a 2-3 frame PLATEAU of equal
 *     y at its apex — the true single-frame peak is exactly what a window-3
 *     median filter discards as the outlier. Requiring strictly-increasing-
 *     then-strictly-decreasing dy around the apex misses this common case
 *     entirely, so adjacent frames of equal y are tolerated and adjacent
 *     candidate indices are then collapsed into one event (below).
 *  2. Minimum flip magnitude. A sign flip alone doesn't distinguish a sharp
 *     ground bounce from a gentle in-air apex (racket redirect, lob peak) —
 *     both are locally "descend then ascend." Real bounces have much higher
 *     curvature (near-instant reversal on ground contact) than smooth
 *     gravity-only arcs, so we additionally require the net y-movement over
 *     the flip window, on both sides, to clear MIN_FLIP_MAGNITUDE_PX
 *     (CEO review P4: "min magnitude" mitigation).
 */
export function findBounceIndices(
  samples: Sample[],
  minFlipFrames = MIN_FLIP_FRAMES,
  phantomWindow = PHANTOM_WINDOW,
  minFlipMagnitudePx = MIN_FLIP_MAGNITUDE_PX,
): number[] {
  const n = samples.length;
  const candidates: number[] = [];
  if (n < 2 * minFlipFrames + 1) return candidates;

  const dy: number[] = [];
  for (let i = 1; i < n; i++) dy.push(samples[i].pos.y - samples[i - 1].pos.y);

  for (let i = minFlipFrames; i < n - minFlipFrames; i++) {
    let descending = true;
    for (let k = i - minFlipFrames; k < i; k++) {
      if (dy[k] < 0) {
        descending = false;
        break;
      }
    }
    if (!descending) continue;
    if (samples[i].pos.y - samples[i - minFlipFrames].pos.y < minFlipMagnitudePx) continue;

    let ascending = true;
    for (let k = i; k < i + minFlipFrames; k++) {
      if (dy[k] > 0) {
        ascending = false;
        break;
      }
    }
    if (!ascending) continue;
    if (samples[i].pos.y - samples[i + minFlipFrames].pos.y < minFlipMagnitudePx) continue;

    let hasReal = false;
    for (let k = Math.max(0, i - phantomWindow); k <= Math.min(n - 1, i + phantomWindow); k++) {
      if (samples[k].real) {
        hasReal = true;
        break;
      }
    }
    if (!hasReal) continue;

    candidates.push(i);
  }

  // Collapse a run of adjacent candidates (the apex plateau) into a single
  // event at the true local max within the cluster.
  const bounceIdx: number[] = [];
  for (let c = 0; c < candidates.length; c++) {
    if (c > 0 && candidates[c] - candidates[c - 1] === 1) continue; // already absorbed below
    let clusterEnd = c;
    while (clusterEnd + 1 < candidates.length && candidates[clusterEnd + 1] - candidates[clusterEnd] === 1) {
      clusterEnd++;
    }
    let best = candidates[c];
    for (let k = c; k <= clusterEnd; k++) {
      if (samples[candidates[k]].pos.y > samples[best].pos.y) best = candidates[k];
    }
    bounceIdx.push(best);
  }
  return bounceIdx;
}

// ---------------------------------------------------------------------------
// Homography: 4-point DLT (Direct Linear Transform), pure JS, no deps.
// Maps clicked image-pixel corners (TL,TR,BR,BL, outer doubles corners) to
// real-world court meters. Client-side per Decision D3.
// ---------------------------------------------------------------------------

export type Homography = number[]; // [h11,h12,h13,h21,h22,h23,h31,h32] with h33=1

function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-10) throw new Error("Degenerate system — corners are likely collinear");
    [M[col], M[pivot]] = [M[pivot], M[col]];

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

export function computeHomography(corners: CourtCorners): Homography {
  // Destination: doubles court rectangle in meters, TL=(0,0), TR=(width,0), BR=(width,length), BL=(0,length)
  const dst: Point[] = [
    { x: 0, y: 0 },
    { x: COURT.DOUBLES_WIDTH, y: 0 },
    { x: COURT.DOUBLES_WIDTH, y: COURT.LENGTH },
    { x: 0, y: COURT.LENGTH },
  ];

  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = corners[i];
    const { x: X, y: Y } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]);
    b.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]);
    b.push(Y);
  }
  return solveLinearSystem(A, b);
}

export function applyHomography(h: Homography, pt: Point): Point {
  const denom = h[6] * pt.x + h[7] * pt.y + 1;
  return {
    x: (h[0] * pt.x + h[1] * pt.y + h[2]) / denom,
    y: (h[3] * pt.x + h[4] * pt.y + h[5]) / denom,
  };
}

/** Rejects self-intersecting / near-collinear / too-small calibration quads. */
export function isDegenerateQuad(corners: CourtCorners, minAreaPx2 = 1000): boolean {
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    area += a.x * b.y - b.x * a.y;
  }
  area = Math.abs(area) / 2;
  if (area < minAreaPx2) return true;

  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const p0 = corners[i];
    const p1 = corners[(i + 1) % 4];
    const p2 = corners[(i + 2) % 4];
    const cross = (p1.x - p0.x) * (p2.y - p1.y) - (p1.y - p0.y) * (p2.x - p1.x);
    const s = Math.sign(cross);
    if (s !== 0) {
      if (sign === 0) sign = s;
      else if (s !== sign) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Point-in-rectangle margin + line call
// ---------------------------------------------------------------------------

interface Rect {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
}

/** Signed distance (meters) to the rectangle boundary: positive = inside, negative = outside. */
export function marginMeters(pt: Point, rect: Rect = SINGLES_RECT): number {
  const dx = Math.max(rect.xmin - pt.x, 0, pt.x - rect.xmax);
  const dy = Math.max(rect.ymin - pt.y, 0, pt.y - rect.ymax);
  if (dx === 0 && dy === 0) {
    return Math.min(pt.x - rect.xmin, rect.xmax - pt.x, pt.y - rect.ymin, rect.ymax - pt.y);
  }
  return -Math.sqrt(dx * dx + dy * dy);
}

/**
 * IN whenever the ball is on or inside the line (ITF rule: touching = in) —
 * we only hedge toward TOO_CLOSE in the direction that could produce a false
 * OUT call, since corner-click imprecision (~20-40cm at the far baseline)
 * should never cost a player a point we're not confident about.
 */
export function classify(marginM: number, errorBoundM = ERROR_BOUND_M): LineCall {
  if (marginM >= 0) return "IN";
  if (marginM <= -errorBoundM) return "OUT";
  return "TOO_CLOSE";
}

// ---------------------------------------------------------------------------
// Top-level: frames + corners -> bounce events
// ---------------------------------------------------------------------------

export function computeEvents(frames: Frame[], corners: CourtCorners): BounceEvent[] {
  const h = computeHomography(corners);
  const samples = interpolateAndSmooth(frames);
  const bounceIdx = findBounceIndices(samples);

  return bounceIdx.map((i) => {
    const s = samples[i];
    const courtPos = applyHomography(h, s.pos);
    const marginM = marginMeters(courtPos);
    const call = classify(marginM);

    const confs: number[] = [];
    for (let k = Math.max(0, i - PHANTOM_WINDOW); k <= Math.min(samples.length - 1, i + PHANTOM_WINDOW); k++) {
      if (samples[k].real) confs.push(samples[k].conf);
    }
    const confidence = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0.4;

    return {
      t: s.t,
      type: "BOUNCE" as const,
      call,
      confidence,
      courtPos,
      marginCm: marginM * 100,
      screenPos: s.pos,
    };
  });
}

/** Binary search for the sample/frame index nearest a given video time — used by the rAF overlay loop (refs, not React state). */
export function nearestIndexByTime<T extends { t: number }>(items: T[], t: number): number {
  if (items.length === 0) return -1;
  let lo = 0;
  let hi = items.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(items[lo - 1].t - t) < Math.abs(items[lo].t - t)) return lo - 1;
  return lo;
}
