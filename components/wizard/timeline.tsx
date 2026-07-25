"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { BounceEvent } from "@/lib/types";

const CLUSTER_PX = 8; // Decision #22 — markers closer than this cluster into a count badge

interface Marker {
  indices: number[]; // indices into `events`
  x: number; // px within the track
}

function clusterMarkers(events: BounceEvent[], duration: number, width: number): Marker[] {
  if (width <= 0 || duration <= 0) return [];
  const positioned = events.map((e, i) => ({ i, x: (e.t / duration) * width }));
  const markers: Marker[] = [];
  for (const p of positioned) {
    const last = markers[markers.length - 1];
    if (last && p.x - last.x < CLUSTER_PX) {
      last.indices.push(p.i);
      last.x = (last.x * (last.indices.length - 1) + p.x) / last.indices.length;
    } else {
      markers.push({ indices: [p.i], x: p.x });
    }
  }
  return markers;
}

export function Timeline({
  events,
  duration,
  currentTime,
  selectedIndex,
  onSelectEvent,
  onSeek,
}: {
  events: BounceEvent[];
  duration: number;
  currentTime: number;
  selectedIndex: number | null;
  onSelectEvent: (index: number) => void;
  onSeek: (t: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const clusterCursor = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setWidth(entries[0].contentRect.width);
    });
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  const markers = clusterMarkers(events, duration, width);
  const playheadPct = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!trackRef.current || duration <= 0) return;
    const rect = trackRef.current.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    onSeek(frac * duration);
  };

  if (events.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-3 px-1">No bounce markers on this clip.</div>
    );
  }

  return (
    <div className="w-full select-none">
      <div
        ref={trackRef}
        onClick={handleTrackClick}
        className="relative h-10 w-full rounded-sm bg-secondary cursor-pointer"
      >
        {/* playhead */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-foreground/70 pointer-events-none"
          style={{ left: `${playheadPct}%` }}
        />
        {markers.map((m) => {
          const key = m.indices.join("-");
          const isCluster = m.indices.length > 1;
          const primaryIdx = m.indices.includes(selectedIndex ?? -1) ? (selectedIndex as number) : m.indices[0];
          const call = events[primaryIdx].call;
          const isSelected = selectedIndex !== null && m.indices.includes(selectedIndex);

          return (
            <button
              key={key}
              type="button"
              title={
                isCluster
                  ? `${m.indices.length} events near t=${events[m.indices[0]].t.toFixed(2)}s`
                  : `t=${events[m.indices[0]].t.toFixed(2)}s — ${events[m.indices[0]].call}`
              }
              onClick={(e) => {
                e.stopPropagation();
                if (!isCluster) {
                  onSelectEvent(m.indices[0]);
                  return;
                }
                const cur = clusterCursor.current.get(key) ?? -1;
                const next = (cur + 1) % m.indices.length;
                clusterCursor.current.set(key, next);
                onSelectEvent(m.indices[next]);
              }}
              className={cn(
                "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center rounded-full border-2 transition-transform",
                isCluster ? "h-6 min-w-6 px-1" : "h-4 w-4",
                call === "IN" && "bg-call-in border-call-in",
                call === "OUT" && "bg-call-out border-call-out",
                call === "TOO_CLOSE" && "bg-muted-foreground border-muted-foreground",
                isSelected && "ring-2 ring-offset-2 ring-offset-secondary ring-foreground scale-110",
              )}
              style={{ left: `${(m.x / Math.max(width, 1)) * 100}%` }}
            >
              {isCluster && (
                <span className="t-mono text-[10px] font-bold text-background leading-none">
                  {m.indices.length}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="flex justify-between mt-1 t-mono text-[11px] text-muted-foreground">
        <span>0:00</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}

function formatTime(s: number): string {
  if (!Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
