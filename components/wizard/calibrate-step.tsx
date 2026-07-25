"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { isDegenerateQuad } from "@/lib/referee";
import type { CourtCorners, Point } from "@/lib/types";
import {
  applyIntrinsicTransform,
  displayToIntrinsic,
  observeVideoTransform,
  seekAndWaitForFrame,
  syncCanvasToContainer,
  type VideoTransform,
} from "@/lib/video-to-canvas";

const CORNER_LABELS = ["TL", "TR", "BR", "BL"];
const NUDGE_PX = 1;
const NUDGE_PX_FAST = 5;
const LOUPE_SIZE = 140;
const LOUPE_ZOOM = 3;

export function CalibrateStep({
  videoUrl,
  onContinue,
}: {
  videoUrl: string;
  onContinue: (corners: CourtCorners) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const seekingRef = useRef(false);
  const pendingSeekRef = useRef<number | null>(null);

  const [transform, setTransform] = useState<VideoTransform | null>(null);
  const [ready, setReady] = useState(false);
  const [duration, setDuration] = useState(0);
  const [scrub, setScrub] = useState(0);
  const [points, setPoints] = useState<Point[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [hover, setHover] = useState<{ display: Point; intrinsic: Point } | null>(null);

  const degenerate = points.length === 4 ? isDegenerateQuad(points as CourtCorners) : false;
  const canContinue = points.length === 4 && !degenerate;

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    const t = transform;
    if (!canvas || !video || !t || !video.videoWidth) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    syncCanvasToContainer(canvas, t);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    applyIntrinsicTransform(ctx, t);
    ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);

    // quad outline
    if (points.length > 1) {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      if (points.length === 4) ctx.closePath();
      ctx.strokeStyle = degenerate ? "oklch(0.62 0.22 27)" : "#ffffff";
      ctx.lineWidth = 3 / t.scale;
      ctx.stroke();
    }

    // numbered dots
    points.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8 / t.scale, 0, Math.PI * 2);
      ctx.fillStyle = i === selected ? "#22c55e" : "#ffffff";
      ctx.fill();
      ctx.lineWidth = 2 / t.scale;
      ctx.strokeStyle = "#000000";
      ctx.stroke();
      ctx.fillStyle = "#000000";
      ctx.font = `${12 / t.scale}px var(--font-geist-mono), monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), p.x, p.y);
    });

    ctx.restore();
  }, [transform, points, selected, degenerate]);

  // wire transform observer once video metadata is available
  useEffect(() => {
    const video = videoRef.current;
    const container = containerRef.current;
    if (!video || !container) return;

    return observeVideoTransform(video, container, (t) => {
      setTransform(t);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    redraw();
  }, [redraw]);

  const onLoadedMetadata = async () => {
    const video = videoRef.current;
    if (!video) return;
    setDuration(video.duration);
    // Decision F12 — seek off frame 0 (often black) and await `seeked` before drawing.
    const target = Math.min(0.1, video.duration / 2);
    await seekAndWaitForFrame(video, target);
    setScrub(target);
    redraw();
  };

  // Coalesces rapid scrub updates: only the most recently requested time is
  // ever seeked to once the in-flight seek resolves (a loop, not recursion,
  // so it plays nicely with strict-mode/compiler hook-purity checks).
  const runSeek = useCallback(
    async (time: number) => {
      pendingSeekRef.current = time;
      if (seekingRef.current) return;
      seekingRef.current = true;
      while (pendingSeekRef.current !== null) {
        const next = pendingSeekRef.current;
        pendingSeekRef.current = null;
        const video = videoRef.current;
        if (video) {
          await seekAndWaitForFrame(video, next);
          redraw();
        }
      }
      seekingRef.current = false;
    },
    [redraw],
  );

  const handleScrub = (value: number | readonly number[]) => {
    const v = Array.isArray(value) ? value[0] : (value as number);
    setScrub(v);
    runSeek(v);
  };

  const canvasPointFromEvent = (e: React.MouseEvent): { display: Point; intrinsic: Point } | null => {
    const canvas = canvasRef.current;
    const t = transform;
    if (!canvas || !t) return null;
    const rect = canvas.getBoundingClientRect();
    const display = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const intrinsic = displayToIntrinsic(display, t);
    return { display, intrinsic };
  };

  const handleCanvasClick = (e: React.MouseEvent) => {
    if (points.length >= 4) return;
    const p = canvasPointFromEvent(e);
    if (!p) return;
    setPoints((prev) => {
      const next = [...prev, p.intrinsic];
      setSelected(next.length - 1);
      return next;
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const p = canvasPointFromEvent(e);
    setHover(p);
    drawLoupe(p);
  };

  const drawLoupe = (p: { display: Point; intrinsic: Point } | null) => {
    const loupe = loupeRef.current;
    const video = videoRef.current;
    if (!loupe || !video || !p || !video.videoWidth) return;
    const ctx = loupe.getContext("2d");
    if (!ctx) return;
    loupe.width = LOUPE_SIZE;
    loupe.height = LOUPE_SIZE;
    const srcSize = LOUPE_SIZE / LOUPE_ZOOM;
    const sx = Math.max(0, Math.min(video.videoWidth - srcSize, p.intrinsic.x - srcSize / 2));
    const sy = Math.max(0, Math.min(video.videoHeight - srcSize, p.intrinsic.y - srcSize / 2));
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);
    ctx.drawImage(video, sx, sy, srcSize, srcSize, 0, 0, LOUPE_SIZE, LOUPE_SIZE);
    // crosshair at the exact cursor-mapped point
    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(LOUPE_SIZE / 2, 0);
    ctx.lineTo(LOUPE_SIZE / 2, LOUPE_SIZE);
    ctx.moveTo(0, LOUPE_SIZE / 2);
    ctx.lineTo(LOUPE_SIZE, LOUPE_SIZE / 2);
    ctx.stroke();
  };

  const handleUndo = () => {
    setPoints((prev) => prev.slice(0, -1));
    setSelected((prev) => (prev !== null && prev > 0 ? prev - 1 : null));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (selected === null || !points[selected]) return;
    const step = e.shiftKey ? NUDGE_PX_FAST : NUDGE_PX;
    let dx = 0;
    let dy = 0;
    if (e.key === "ArrowLeft") dx = -step;
    else if (e.key === "ArrowRight") dx = step;
    else if (e.key === "ArrowUp") dy = -step;
    else if (e.key === "ArrowDown") dy = step;
    else return;
    e.preventDefault();
    setPoints((prev) => prev.map((p, i) => (i === selected ? { x: p.x + dx, y: p.y + dy } : p)));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="text-sm text-muted-foreground">
        {points.length === 0 &&
          "Click the 4 outer doubles corners, in order, starting top-left: TL → TR → BR → BL."}
        {points.length > 0 && points.length < 4 && `${4 - points.length} corner(s) left — next: ${CORNER_LABELS[points.length]}.`}
        {points.length === 4 && !degenerate && "Corners look good. Continue when ready."}
        {points.length === 4 && degenerate && "Corners look off — undo and re-click."}
      </div>

      <div
        ref={containerRef}
        className="relative w-full aspect-video bg-black rounded-md overflow-hidden select-none"
      >
        {!ready && <div className="absolute inset-0 bg-secondary animate-pulse" />}
        {/* decode source only — not displayed directly, the canvas is the calibration surface */}
        <video
          ref={videoRef}
          src={videoUrl}
          className="hidden"
          muted
          playsInline
          onLoadedMetadata={onLoadedMetadata}
        />
        <canvas
          ref={canvasRef}
          tabIndex={0}
          onClick={handleCanvasClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHover(null)}
          onKeyDown={handleKeyDown}
          className="absolute inset-0 w-full h-full cursor-crosshair outline-none"
        />
        {hover && (
          <div
            className="absolute pointer-events-none rounded-full border-2 border-foreground overflow-hidden shadow-lg"
            style={{
              width: LOUPE_SIZE,
              height: LOUPE_SIZE,
              left: Math.min(
                (transform?.containerWidth ?? 0) - LOUPE_SIZE,
                Math.max(0, hover.display.x + 24),
              ),
              top: Math.max(0, hover.display.y - LOUPE_SIZE - 24),
            }}
          >
            <canvas ref={loupeRef} width={LOUPE_SIZE} height={LOUPE_SIZE} />
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <span className="t-mono text-xs text-muted-foreground w-10 text-right">{scrub.toFixed(1)}s</span>
        <Slider
          value={[scrub]}
          min={0}
          max={duration || 1}
          step={0.05}
          onValueChange={handleScrub}
          disabled={!ready}
          className="flex-1"
        />
        <span className="t-mono text-xs text-muted-foreground w-10">{duration.toFixed(1)}s</span>
      </div>
      <div className="text-xs text-muted-foreground -mt-2">
        Scrub to a frame that shows the full court. Click a numbered dot, then use arrow keys to nudge it
        (hold Shift for bigger steps).
      </div>

      <div className="flex items-center justify-between">
        <Button variant="secondary" onClick={handleUndo} disabled={points.length === 0}>
          Undo
        </Button>
        <Button onClick={() => canContinue && onContinue(points as CourtCorners)} disabled={!canContinue}>
          Continue
        </Button>
      </div>
    </div>
  );
}
