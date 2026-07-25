"use client";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { ProgressJson } from "@/lib/types";

export type AnalyzePhase = "polling" | "error" | "timeout";

const STAGE_LABELS: Record<string, string> = {
  queued: "Warming up the model…",
  warming: "Warming up the model…",
  detecting: "Finding players and ball…",
  tracking: "Tracking ball trajectory…",
  writing: "Wrapping up…",
};

function stageLabel(progress: ProgressJson | null): string {
  if (!progress || progress.totalFrames === 0) return "Warming up the model…";
  return STAGE_LABELS[progress.stage] ?? `${progress.stage}…`;
}

export function AnalyzeStep({
  progress,
  phase,
  errorMessage,
  onCancel,
  onRetry,
}: {
  progress: ProgressJson | null;
  phase: AnalyzePhase;
  errorMessage: string | null;
  onCancel: () => void;
  onRetry: () => void;
}) {
  if (phase === "error") {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <div className="text-sm font-medium">Analysis failed</div>
        <div className="text-sm text-muted-foreground max-w-md">
          {errorMessage ?? "The inference run hit an error."}
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onCancel}>
            Back to upload
          </Button>
          <Button onClick={onRetry}>Retry</Button>
        </div>
      </div>
    );
  }

  if (phase === "timeout") {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <div className="text-sm font-medium">Taking too long</div>
        <div className="text-sm text-muted-foreground max-w-md">
          Analysis is still running after 6 minutes — something&apos;s probably stuck.
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onCancel}>
            Back to upload
          </Button>
          <Button onClick={onRetry}>Retry</Button>
        </div>
      </div>
    );
  }

  const hasFrameCount = !!progress && progress.totalFrames > 0;
  const pct = hasFrameCount ? Math.min(100, (progress!.framesDone / progress!.totalFrames) * 100) : undefined;

  return (
    <div className="flex flex-col items-center gap-6 py-16 text-center">
      <div className="text-sm font-medium">{stageLabel(progress)}</div>
      <div className="w-full max-w-md flex flex-col gap-2">
        <Progress value={pct ?? 8} className={pct === undefined ? "animate-pulse" : undefined} />
        {hasFrameCount && (
          <div className="t-mono text-xs text-muted-foreground">
            frame {progress!.framesDone}/{progress!.totalFrames}
          </div>
        )}
      </div>
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <div className="max-w-sm rounded-md border border-border bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
        Analysis can take 2+ minutes, especially right after a cold start — if it&apos;s been a
        while, that&apos;s normal, not stuck.
      </div>
    </div>
  );
}
