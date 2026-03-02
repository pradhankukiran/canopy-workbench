import { cn } from "@/lib/utils";
import { useState } from "react";

interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T, index: number) => string;
  maxRows?: number;
  className?: string;
  emptyMessage?: string;
}

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  maxRows,
  className,
  emptyMessage = "No data available.",
}: DataTableProps<T>) {
  const [showAll, setShowAll] = useState(false);
  const limit = maxRows && !showAll ? maxRows : data.length;
  const visibleData = data.slice(0, limit);
  const hasMore = maxRows && data.length > maxRows && !showAll;

  if (data.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="overflow-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[640px] border-collapse">
          <thead>
            <tr className="bg-muted/40">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    "border-b border-border px-3 py-2.5 text-left text-[0.7rem] font-bold uppercase tracking-wider text-muted-foreground",
                    col.className
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleData.map((row, index) => (
              <tr
                key={keyExtractor(row, index)}
                className="border-b border-border/60 transition-colors last:border-0 hover:bg-accent/30"
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      "px-3 py-2.5 text-sm",
                      col.className
                    )}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="text-xs font-medium text-primary hover:underline"
        >
          Show all {data.length} rows ({data.length - limit} more)
        </button>
      )}
    </div>
  );
}
