import { cn } from "@/lib/utils";
import { statusTone, eventTone } from "@/lib/tone";

const toneClasses: Record<string, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  running: "border-primary/20 bg-primary/5 text-primary",
  success: "border-success/20 bg-success/5 text-success",
  error: "border-destructive/20 bg-destructive/5 text-destructive",
  warn: "border-warning/20 bg-warning/5 text-warning",
};

export function StatusBadge({ label }: { label: string | undefined }) {
  const state = label ?? "unknown";
  const tone = statusTone(state);
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide",
        toneClasses[tone]
      )}
      title={state}
    >
      {state}
    </span>
  );
}

export function EventLevelBadge({ label }: { label: string | undefined }) {
  const level = label ?? "event";
  const tone = eventTone(level);
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide",
        toneClasses[tone]
      )}
      title={level}
    >
      {level}
    </span>
  );
}
