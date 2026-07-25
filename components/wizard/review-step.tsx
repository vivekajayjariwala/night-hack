"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { computeEvents, nearestIndexByTime } from "@/lib/referee";
import type { BounceEvent, CourtCorners, Results } from "@/lib/types";
import {
  applyIntrinsicTransform,
  observeVideoTransform,
  syncCanvasToContainer,
  type VideoTransform,
} from "@/lib/video-to-canvas";
import { seekAndWaitForFrame } from "@/lib/video-to-canvas";
import { Timeline } from "./timeline";
import { MiniCourt } from "./mini-court";
import { CallBadge } from "./call-badge";

const TRAIL_LENGTH = 10;
const TRAIL_SCAN_LIMIT = 40; // frames to look back for real ball detections
const REPLAY_RATE = 0.25;
const REPLAY_PAD_S = 1;

export function ReviewStep({
  videoUrl,
  results,
  corners,
  onStartOver,
}: {
  videoUrl: string;
  results: Results;
  corners: CourtCorners;
  onStartOver: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<VideoTransform | null>(null);
  const rafRef = useRef<number | null>(null);
  const replayEndRef = useRef<number | null>(null);
  const autoPlayedRef = useRef(false);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const events = useMemo(() => computeEvents(results.frames, corners), [results, corners]);
  const selectedEvent: BounceEvent | null = selectedIndex !== null ? events[selectedIndex] : null;

  // --- rAF overlay draw loop: reads video.currentTime via refs, no React state per frame ---
  const draw = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const t = transformRef.current;
    if (video && canvas && t && video.videoWidth) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        syncCanvasToContainer(canvas, t);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
        applyIntrinsicTransform(ctx, t);

        const frames = results.frames;
        const idx = nearestIndexByTime(frames, video.currentTime);
        if (idx >= 0) {
          const frame = frames[idx];

          // person boxes
          ctx.lineWidth = 4 / t.scale;
          ctx.strokeStyle = "#ffffff";
          for (const box of frame.boxes) {
            ctx.strokeRect(box.x, box.y, box.w, box.h);
          }

          // ball comet trail: last ~10 real detections at/before idx, fading opacity
          const trail: { x: number; y: number }[] = [];
          for (let i = idx; i >= Math.max(0, idx - TRAIL_SCAN_LIMIT) && trail.length < TRAIL_LENGTH; i--) {
            const b = frames[i].ball;
            if (b) trail.push({ x: b.x, y: b.y });
          }
          for (let i = trail.length - 1; i >= 0; i--) {
            const alpha = 1 - i / TRAIL_LENGTH;
            ctx.beginPath();
            ctx.arc(trail[i].x, trail[i].y, (i === 0 ? 7 : 5) / t.scale, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 214, 10, ${Math.max(0.08, alpha)})`;
            ctx.fill();
          }
        }
      }
    }
  }, [results.frames]);

  useEffect(() => {
    const loop = () => {
      draw();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [draw]);

  useEffect(() => {
    const video = videoRef.current;
    const container = containerRef.current;
    if (!video || !container) return;
    return observeVideoTransform(video, container, (t) => {
      transformRef.current = t;
    });
  }, []);

  // low-frequency time/duration state for the timeline (native timeupdate, not rAF)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => {
      setCurrentTime(video.currentTime);
      if (replayEndRef.current !== null && video.currentTime >= replayEndRef.current) {
        video.pause();
        video.playbackRate = 1;
        replayEndRef.current = null;
        setPlaying(false);
      }
    };
    const onLoaded = () => setDuration(video.duration);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, []);

  const playSlowMoReplay = useCallback(async (t: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.playbackRate = 1;
    const start = Math.max(0, t - REPLAY_PAD_S);
    await seekAndWaitForFrame(video, start);
    replayEndRef.current = t + REPLAY_PAD_S;
    video.playbackRate = REPLAY_RATE;
    video.play();
  }, []);

  const selectEvent = useCallback(
    (index: number) => {
      setSelectedIndex(index);
      const ev = events[index];
      if (ev) playSlowMoReplay(ev.t);
    },
    [events, playSlowMoReplay],
  );

  // Decision #28/D4 — auto-seek + slow-mo + mini-court reveal on the first event,
  // unprompted. Deferred a tick so the state update isn't synchronous within the
  // effect body itself (avoids cascading-render churn on mount).
  useEffect(() => {
    if (autoPlayedRef.current) return;
    if (events.length === 0) return;
    autoPlayedRef.current = true;
    queueMicrotask(() => selectEvent(0));
  }, [events, selectEvent]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.playbackRate = 1;
      replayEndRef.current = null;
      video.play();
    } else {
      video.pause();
    }
  };

  const handleSeek = (t: number) => {
    const video = videoRef.current;
    if (!video) return;
    replayEndRef.current = null;
    video.playbackRate = 1;
    video.currentTime = t;
  };

  return (
    <div className="mx-auto w-full max-w-5xl flex flex-col gap-4">
      <div className="flex justify-end">
        <Button size="sm" variant="secondary" onClick={onStartOver}>
          Start over
        </Button>
      </div>

      {results.meta.lowDetection && (
        <div className="rounded-md border border-call-out/50 bg-call-out/10 px-3 py-2 text-sm text-call-out">
          Couldn&apos;t track the ball reliably — try a clearer clip.
        </div>
      )}
      {events.length === 0 && !results.meta.lowDetection && (
        <div className="rounded-md border border-border bg-secondary px-3 py-2 text-sm text-muted-foreground">
          No bounces detected — try a clearer clip.
        </div>
      )}

      <div ref={containerRef} className="relative w-full aspect-video bg-black rounded-md overflow-hidden">
        <video ref={videoRef} src={videoUrl} className="w-full h-full object-contain" playsInline />
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
        <button
          type="button"
          onClick={togglePlay}
          className="absolute bottom-3 left-3 flex items-center justify-center h-9 w-9 rounded-full bg-background/80 text-foreground hover:bg-background"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
      </div>

      <Timeline
        events={events}
        duration={duration}
        currentTime={currentTime}
        selectedIndex={selectedIndex}
        onSelectEvent={selectEvent}
        onSeek={handleSeek}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-md border border-border bg-card p-4 min-h-[200px] flex items-center justify-center">
          <MiniCourt event={selectedEvent} />
        </div>
        <div className="rounded-md border border-border bg-card p-2 max-h-[360px] overflow-y-auto">
          {events.length === 0 ? (
            <div className="text-sm text-muted-foreground p-3">No events to list.</div>
          ) : (
            <ul className="flex flex-col">
              {events.map((ev, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => selectEvent(i)}
                    className={`w-full flex items-center justify-between gap-3 rounded-sm px-3 py-2 text-left text-sm hover:bg-secondary ${
                      i === selectedIndex ? "bg-secondary" : ""
                    }`}
                  >
                    <span className="t-mono text-muted-foreground">t={ev.t.toFixed(2)}s</span>
                    <CallBadge call={ev.call} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
