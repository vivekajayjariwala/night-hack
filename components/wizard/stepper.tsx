import { cn } from "@/lib/utils";

export type WizardStep = "upload" | "calibrate" | "analyze" | "review";

const STEPS: { key: WizardStep; label: string }[] = [
  { key: "upload", label: "Upload" },
  { key: "calibrate", label: "Calibrate" },
  { key: "analyze", label: "Analyze" },
  { key: "review", label: "Review" },
];

export function Stepper({ current }: { current: WizardStep }) {
  const currentIdx = STEPS.findIndex((s) => s.key === current);

  return (
    <ol className="flex items-center gap-2 sm:gap-3" aria-label="Progress">
      {STEPS.map((s, i) => {
        const state = i < currentIdx ? "done" : i === currentIdx ? "current" : "upcoming";
        return (
          <li key={s.key} className="flex items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium t-mono",
                  state === "done" && "bg-foreground text-background",
                  state === "current" && "border-2 border-foreground text-foreground",
                  state === "upcoming" && "border border-border text-muted-foreground",
                )}
                aria-current={state === "current" ? "step" : undefined}
              >
                {i + 1}
              </span>
              <span
                className={cn(
                  "text-sm hidden sm:inline",
                  state === "current" ? "text-foreground font-medium" : "text-muted-foreground",
                )}
              >
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={cn("h-px w-6 sm:w-10", state === "done" ? "bg-foreground" : "bg-border")} />
            )}
          </li>
        );
      })}
    </ol>
  );
}
