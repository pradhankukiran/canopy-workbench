import { HelpCircle } from "lucide-react";

interface HelpTooltipProps {
  content: string;
}

export function HelpTooltip({ content }: HelpTooltipProps) {
  return (
    <span className="group relative inline-flex cursor-help">
      <HelpCircle className="h-3.5 w-3.5 text-muted-foreground/60" />
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-56 -translate-x-1/2 rounded-md border border-border bg-popover px-3 py-2 text-xs font-normal normal-case tracking-normal text-popover-foreground opacity-0 shadow-md transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
        {content}
      </span>
    </span>
  );
}
