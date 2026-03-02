import { cn } from "@/lib/utils";
import { MetricCard } from "./metric-card";

interface SummaryItem {
  label: string;
  value: string;
  help?: string;
}

interface SummaryStripProps {
  items: SummaryItem[];
  className?: string;
}

export function SummaryStrip({ items, className }: SummaryStripProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-4 gap-2.5 max-md:grid-cols-2 max-sm:grid-cols-1",
        className
      )}
    >
      {items.map((item) => (
        <MetricCard
          key={item.label}
          label={item.label}
          value={item.value}
          help={item.help}
        />
      ))}
    </div>
  );
}
