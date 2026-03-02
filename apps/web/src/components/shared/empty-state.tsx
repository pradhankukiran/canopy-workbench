import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { FileQuestion } from "lucide-react";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  className?: string;
}

export function EmptyState({
  icon: Icon = FileQuestion,
  title,
  description,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-dashed border-border/80 bg-muted/30 px-6 py-10 text-center",
        className
      )}
    >
      <Icon className="h-10 w-10 text-muted-foreground/40" />
      <div className="grid gap-1">
        <p className="text-sm font-semibold text-muted-foreground">{title}</p>
        {description && (
          <p className="text-xs text-muted-foreground/70">{description}</p>
        )}
      </div>
    </div>
  );
}
