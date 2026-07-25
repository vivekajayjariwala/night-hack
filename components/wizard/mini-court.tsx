import { COURT, SINGLES_RECT, SIDELINE_INSET } from "@/lib/referee";
import type { BounceEvent } from "@/lib/types";
import { CallBadge } from "./call-badge";

/**
 * Top-down SVG mini-court (Decision D4/T7) — drawn to scale from the same
 * COURT/SINGLES_RECT constants `computeEvents` uses, so the dot's position
 * always matches the call. Hidden entirely until an event is selected
 * (Phase 2 Interaction States table — EMPTY = hidden, not a placeholder).
 */
export function MiniCourt({ event }: { event: BounceEvent | null }) {
  if (!event) return null;

  const marginLabel =
    event.call === "TOO_CLOSE"
      ? "TOO CLOSE"
      : `${event.call} by ${Math.abs(event.marginCm).toFixed(0)}cm`;

  const dotColor =
    event.call === "IN" ? "var(--call-in)" : event.call === "OUT" ? "var(--call-out)" : "var(--muted-foreground)";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Bounce location</span>
        <CallBadge call={event.call} />
      </div>
      <svg
        viewBox={`-0.6 -0.6 ${COURT.DOUBLES_WIDTH + 1.2} ${COURT.LENGTH + 1.2}`}
        className="w-full h-auto max-h-[360px] rounded-sm bg-secondary"
        role="img"
        aria-label={`Top-down court view: bounce ${marginLabel}`}
      >
        {/* doubles boundary */}
        <rect
          x={0}
          y={0}
          width={COURT.DOUBLES_WIDTH}
          height={COURT.LENGTH}
          fill="none"
          stroke="var(--court-line)"
          strokeWidth={0.06}
          opacity={0.5}
        />
        {/* singles boundary — the line IN/OUT is judged against */}
        <rect
          x={SIDELINE_INSET}
          y={0}
          width={SINGLES_RECT.xmax - SINGLES_RECT.xmin}
          height={COURT.LENGTH}
          fill="none"
          stroke="var(--court-line)"
          strokeWidth={0.08}
        />
        {/* net */}
        <line
          x1={0}
          y1={COURT.LENGTH / 2}
          x2={COURT.DOUBLES_WIDTH}
          y2={COURT.LENGTH / 2}
          stroke="var(--court-line)"
          strokeWidth={0.1}
          opacity={0.8}
        />
        {/* bounce point */}
        <circle
          cx={event.courtPos.x}
          cy={event.courtPos.y}
          r={0.22}
          fill={dotColor}
          stroke="var(--background)"
          strokeWidth={0.05}
        />
      </svg>
      <div className="t-mono text-sm text-center">{marginLabel}</div>
    </div>
  );
}
