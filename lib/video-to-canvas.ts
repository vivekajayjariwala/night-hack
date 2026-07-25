import type { Point } from "./types";

// Single shared video<->canvas transform helper (PLAN.md Decision #38/F11/T6).
// Used by BOTH the calibration canvas and the review-screen overlay canvas —
// this is the only place scale + letterbox-offset math is implemented.
//
// The video element renders with `object-contain` inside a container it
// fills completely (w-full h-full); the browser letterboxes internally. The
// canvas overlay is absolutely positioned to fill that same container, so it
// must independently compute where the *visible* video content sits within
// its own box and draw through the same transform, in intrinsic (native
// video resolution) pixel space — never displayed CSS pixels (Decision #29).

export interface VideoTransform {
  /** intrinsic video px -> displayed CSS px */
  scale: number;
  /** letterbox offset, in container CSS px */
  offsetX: number;
  offsetY: number;
  displayWidth: number;
  displayHeight: number;
  containerWidth: number;
  containerHeight: number;
  videoWidth: number;
  videoHeight: number;
  dpr: number;
}

export function computeVideoTransform(video: HTMLVideoElement, container: HTMLElement): VideoTransform | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;

  const rect = container.getBoundingClientRect();
  const cw = rect.width;
  const ch = rect.height;
  if (!cw || !ch) return null;

  const videoAspect = vw / vh;
  const containerAspect = cw / ch;

  let displayWidth: number;
  let displayHeight: number;
  let offsetX: number;
  let offsetY: number;

  if (videoAspect > containerAspect) {
    // wider than container -> letterboxed top/bottom
    displayWidth = cw;
    displayHeight = cw / videoAspect;
    offsetX = 0;
    offsetY = (ch - displayHeight) / 2;
  } else {
    // taller than container -> letterboxed left/right
    displayHeight = ch;
    displayWidth = ch * videoAspect;
    offsetY = 0;
    offsetX = (cw - displayWidth) / 2;
  }

  return {
    scale: displayWidth / vw,
    offsetX,
    offsetY,
    displayWidth,
    displayHeight,
    containerWidth: cw,
    containerHeight: ch,
    videoWidth: vw,
    videoHeight: vh,
    dpr: typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
  };
}

/** Sizes a canvas's backing store to the container (accounting for DPR) and its CSS box to match. */
export function syncCanvasToContainer(canvas: HTMLCanvasElement, t: VideoTransform): void {
  const targetW = Math.max(1, Math.round(t.containerWidth * t.dpr));
  const targetH = Math.max(1, Math.round(t.containerHeight * t.dpr));
  if (canvas.width !== targetW) canvas.width = targetW;
  if (canvas.height !== targetH) canvas.height = targetH;
  canvas.style.width = `${t.containerWidth}px`;
  canvas.style.height = `${t.containerHeight}px`;
}

/**
 * Sets the canvas context transform so that all subsequent draw calls can
 * use raw intrinsic (native video pixel) coordinates directly — matching
 * the coordinate space of `Frame.boxes`, `ball`, and stored `CourtCorners`.
 */
export function applyIntrinsicTransform(ctx: CanvasRenderingContext2D, t: VideoTransform): void {
  ctx.setTransform(t.dpr, 0, 0, t.dpr, 0, 0);
  ctx.translate(t.offsetX, t.offsetY);
  ctx.scale(t.scale, t.scale);
}

/** Displayed (container CSS px, e.g. a click event's offsetX/offsetY) -> intrinsic video px. */
export function displayToIntrinsic(pt: Point, t: VideoTransform): Point {
  return {
    x: (pt.x - t.offsetX) / t.scale,
    y: (pt.y - t.offsetY) / t.scale,
  };
}

/** Intrinsic video px -> displayed (container CSS px). */
export function intrinsicToDisplay(pt: Point, t: VideoTransform): Point {
  return {
    x: pt.x * t.scale + t.offsetX,
    y: pt.y * t.scale + t.offsetY,
  };
}

/**
 * Keeps a VideoTransform in sync with video metadata + container resizes.
 * Returns a cleanup function. Call `onChange` drives both re-render of
 * overlay content and canvas backing-store resizing.
 */
export function observeVideoTransform(
  video: HTMLVideoElement,
  container: HTMLElement,
  onChange: (t: VideoTransform) => void,
): () => void {
  const update = () => {
    const t = computeVideoTransform(video, container);
    if (t) onChange(t);
  };
  update();

  const ro = new ResizeObserver(update);
  ro.observe(container);
  video.addEventListener("loadedmetadata", update);
  video.addEventListener("resize", update);
  window.addEventListener("resize", update);

  return () => {
    ro.disconnect();
    video.removeEventListener("loadedmetadata", update);
    video.removeEventListener("resize", update);
    window.removeEventListener("resize", update);
  };
}

/** Awaits the video's `seeked` event after setting currentTime (Decision F12 — frame 0 is often black otherwise). */
export function seekAndWaitForFrame(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = time;
  });
}
