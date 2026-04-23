import { useEffect, useState } from "react";
import {
  getDataSources,
  type DataArtifactStatus,
  type DataSourcesSummary,
} from "@/api/client";

/**
 * Small admin-style panel that surfaces the API's /data-sources registry
 * status so deployers can see which hazard artifacts are cached, missing,
 * or failing checksum. Read-only; a production admin UI could add refresh
 * buttons, but this panel's job is pure transparency.
 *
 * Loads on mount, refreshes on an explicit button click. Stays quiet (no
 * flashing) during background polling.
 */
export function DataSourcesPanel() {
  const [summary, setSummary] = useState<DataSourcesSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const next = await getDataSources();
      setSummary(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <section className="rounded-lg border border-border/60 bg-card p-4">
      <header className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">Hazard data sources</h3>
          <p className="text-xs text-muted-foreground">
            External artifacts required by the engine. Downloaded once and
            cached on the worker host.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="text-xs rounded-md border border-border/60 px-2 py-1 hover:bg-muted/50 disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {error && (
        <p className="mt-3 text-xs text-destructive">
          Failed to load data-source status: {error}
        </p>
      )}

      {summary && (
        <>
          <p className="mt-3 text-xs text-muted-foreground">
            Cache directory: <code className="text-xs">{summary.cacheDir}</code>
          </p>
          <ul className="mt-3 divide-y divide-border/50">
            {summary.artifacts.map((artifact) => (
              <li key={artifact.id} className="py-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono text-xs">{artifact.id}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {artifact.description}
                  </div>
                  {artifact.reason && (
                    <div className="text-xs text-destructive mt-1">{artifact.reason}</div>
                  )}
                </div>
                <StateBadge status={artifact} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function StateBadge({ status }: { status: DataArtifactStatus }) {
  const labels: Record<DataArtifactStatus["state"], { text: string; cls: string }> = {
    ready: { text: "ready", cls: "bg-emerald-500/15 text-emerald-300" },
    missing: { text: "missing", cls: "bg-amber-500/15 text-amber-300" },
    unavailable: { text: "unavailable", cls: "bg-red-500/15 text-red-300" },
  };
  const label = labels[status.state];
  const size = status.sizeBytes
    ? `${(status.sizeBytes / 1024 / 1024).toFixed(1)} MB`
    : `~${status.approximateMb} MB`;
  return (
    <div className="flex flex-col items-end gap-1">
      <span
        className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${label.cls}`}
      >
        {label.text}
      </span>
      <span className="text-xs text-muted-foreground">{size}</span>
    </div>
  );
}
