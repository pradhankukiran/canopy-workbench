import { ParentSize } from "@visx/responsive";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ChartContainerProps {
  height?: number;
  title?: string;
  description?: string;
  className?: string;
  children: (dimensions: { width: number; height: number }) => ReactNode;
}

export function ChartContainer({
  height = 300,
  title,
  description,
  className,
  children,
}: ChartContainerProps) {
  return (
    <div className={cn("rounded-lg border border-border bg-card", className)}>
      {(title || description) && (
        <div className="border-b border-border px-4 py-3">
          {title && <h4 className="text-sm font-semibold">{title}</h4>}
          {description && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      )}
      <div style={{ height }} className="px-2 py-2">
        <ParentSize>
          {({ width: w, height: h }) =>
            w > 0 && h > 0 ? children({ width: w, height: h }) : null
          }
        </ParentSize>
      </div>
    </div>
  );
}
