import { cn } from "@/lib/utils";
import { HelpTooltip } from "./help-tooltip";

interface MetricCardProps {
  label: string;
  value: string;
  help?: string;
  className?: string;
}

export function MetricCard({ label, value, help, className }: MetricCardProps) {
  return (
    <div
      className={cn(
        "grid gap-1 rounded-lg border border-border bg-muted/50 p-3",
        className
      )}
    >
      <span className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        {label}
        {help && <HelpTooltip content={help} />}
      </span>
      <strong className="break-words text-sm leading-snug">{value}</strong>
    </div>
  );
}
