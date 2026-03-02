import * as React from "react";
import { cn } from "@/lib/utils";

export interface TooltipProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "content"> {
  content: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  delayMs?: number;
}

const Tooltip = React.forwardRef<HTMLDivElement, TooltipProps>(
  ({ className, content, side = "top", children, delayMs = 200, ...props }, ref) => {
    const sideClasses: Record<string, string> = {
      top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
      bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
      left: "right-full top-1/2 -translate-y-1/2 mr-2",
      right: "left-full top-1/2 -translate-y-1/2 ml-2",
    };

    return (
      <div
        ref={ref}
        className={cn("group/tooltip relative inline-flex", className)}
        {...props}
      >
        {children}
        <div
          role="tooltip"
          className={cn(
            "pointer-events-none absolute z-50 hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md",
            "group-hover/tooltip:block",
            sideClasses[side]
          )}
          style={{
            animationDelay: `${delayMs}ms`,
            animationName: "tooltip-fade-in",
            animationDuration: "150ms",
            animationFillMode: "backwards",
          }}
        >
          {content}
        </div>
        <style>{`
          @keyframes tooltip-fade-in {
            from { opacity: 0; }
            to { opacity: 1; }
          }
        `}</style>
      </div>
    );
  }
);
Tooltip.displayName = "Tooltip";

export { Tooltip };
