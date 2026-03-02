import type { RunRecord, JobRecord } from "@/types/api";
import { formatDateTime, formatPercent } from "@/lib/format";
import { StatusBadge } from "@/components/shared/status-badge";
import { ErrorBanner } from "@/components/shared/error-banner";

interface RunStatusPanelProps {
  runRecord: RunRecord | null;
  jobRecord: JobRecord | null;
  pollingActive: boolean;
  lastPolledAt: string | null;
  jobProgress: number | null;
  pollError: string | null;
}

export function RunStatusPanel({
  runRecord,
  jobRecord,
  pollingActive,
  lastPolledAt,
  jobProgress,
  pollError,
}: RunStatusPanelProps) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="mb-3">
        <h3 className="text-base font-semibold">Run Status</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Tracks queue progress and completion state.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        <div className="grid gap-1 rounded-lg border border-border bg-muted/50 p-3">
          <span className="text-[0.7rem] font-bold uppercase tracking-wider text-muted-foreground">
            Run ID
          </span>
          <code className="break-all text-xs">
            {runRecord?.runId ?? "\u2014"}
          </code>
        </div>
        <div className="grid gap-1 rounded-lg border border-border bg-muted/50 p-3">
          <span className="text-[0.7rem] font-bold uppercase tracking-wider text-muted-foreground">
            Job ID
          </span>
          <code className="break-all text-xs">
            {jobRecord?.jobId ?? "\u2014"}
          </code>
        </div>
        <div className="grid gap-1 rounded-lg border border-border bg-muted/50 p-3">
          <span className="text-[0.7rem] font-bold uppercase tracking-wider text-muted-foreground">
            Run State
          </span>
          <StatusBadge label={runRecord?.state} />
        </div>
        <div className="grid gap-1 rounded-lg border border-border bg-muted/50 p-3">
          <span className="text-[0.7rem] font-bold uppercase tracking-wider text-muted-foreground">
            Job State
          </span>
          <StatusBadge label={jobRecord?.state} />
        </div>
        <div className="grid gap-1 rounded-lg border border-border bg-muted/50 p-3">
          <span className="text-[0.7rem] font-bold uppercase tracking-wider text-muted-foreground">
            Created
          </span>
          <span className="text-xs">{formatDateTime(runRecord?.createdAt)}</span>
        </div>
        <div className="grid gap-1 rounded-lg border border-border bg-muted/50 p-3">
          <span className="text-[0.7rem] font-bold uppercase tracking-wider text-muted-foreground">
            Updated
          </span>
          <span className="text-xs">
            {formatDateTime(jobRecord?.updatedAt)}
          </span>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-border bg-muted/50 p-3">
        <div className="flex items-center justify-between text-sm">
          <span>Job progress</span>
          <strong>
            {jobProgress === null ? "\u2014" : formatPercent(jobProgress)}
          </strong>
        </div>
        <div
          className="mt-2 h-2.5 overflow-hidden rounded-full bg-muted"
          aria-hidden="true"
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary to-primary/80 transition-all duration-200"
            style={{ width: `${(jobProgress ?? 0) * 100}%` }}
          />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {pollingActive ? "Polling in progress..." : "Idle"}
          {lastPolledAt ? ` \u00B7 Last poll ${formatDateTime(lastPolledAt)}` : ""}
        </p>
      </div>

      {pollError && <ErrorBanner message={pollError} />}
    </section>
  );
}
