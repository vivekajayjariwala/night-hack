import { cn } from "@/lib/utils";
import type { LineCall } from "@/lib/types";

const LABEL: Record<LineCall, string> = {
  IN: "IN",
  OUT: "OUT",
  TOO_CLOSE: "TOO CLOSE",
};

/**
 * Filled badge with a text label — never color alone (Decision #19/#30,
 * projector legibility + accessibility). IN=green / OUT=red is the ONE
 * semantic accent pair in this UI; TOO_CLOSE gets a neutral outline since
 * it's neither call.
 */
export function CallBadge({ call, className }: { call: LineCall; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-bold tracking-wide",
        call === "IN" && "bg-call-in text-call-in-foreground",
        call === "OUT" && "bg-call-out text-call-out-foreground",
        call === "TOO_CLOSE" && "border border-muted-foreground text-muted-foreground",
        className,
      )}
    >
      {LABEL[call]}
    </span>
  );
}
