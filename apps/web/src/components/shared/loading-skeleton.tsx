import { cn } from "@/lib/utils";

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-muted",
        className
      )}
    />
  );
}

export function MetricStripSkeleton() {
  return (
    <div className="grid grid-cols-4 gap-2.5 max-md:grid-cols-2 max-sm:grid-cols-1">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="grid gap-2 rounded-lg border border-border bg-muted/50 p-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-5 w-28" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b bg-muted/30 px-3 py-2.5">
        <Skeleton className="h-3 w-full" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 border-b px-3 py-2.5 last:border-0">
          {Array.from({ length: 5 }).map((_, j) => (
            <Skeleton key={j} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <div className="flex items-center justify-center rounded-lg border border-border bg-card p-6">
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
