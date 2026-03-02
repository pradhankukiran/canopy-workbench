import * as React from "react";
import { cn } from "@/lib/utils";

export interface CollapsibleProps
  extends React.DetailsHTMLAttributes<HTMLDetailsElement> {
  defaultOpen?: boolean;
}

const Collapsible = React.forwardRef<HTMLDetailsElement, CollapsibleProps>(
  ({ className, defaultOpen, open, ...props }, ref) => (
    <details
      ref={ref}
      open={defaultOpen || open}
      className={cn("group", className)}
      {...props}
    />
  )
);
Collapsible.displayName = "Collapsible";

const CollapsibleTrigger = React.forwardRef<
  HTMLElement,
  React.HTMLAttributes<HTMLElement>
>(({ className, children, ...props }, ref) => (
  <summary
    ref={ref as React.Ref<HTMLElement>}
    className={cn(
      "flex cursor-pointer list-none items-center justify-between rounded-md px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden",
      className
    )}
    {...props}
  >
    {children}
  </summary>
));
CollapsibleTrigger.displayName = "CollapsibleTrigger";

const CollapsibleContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("px-4 pb-2 pt-0 text-sm", className)}
    {...props}
  />
));
CollapsibleContent.displayName = "CollapsibleContent";

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
