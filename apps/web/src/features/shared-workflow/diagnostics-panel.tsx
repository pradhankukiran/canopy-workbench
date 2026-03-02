import type { RunEventRecord } from "@/types/api";
import { formatDateTime, formatPercent, clampProgress } from "@/lib/format";
import { StatusBadge, EventLevelBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorBanner } from "@/components/shared/error-banner";
import { Activity, ChevronDown } from "lucide-react";
import { useState } from "react";

type EventsStatus = "idle" | "loading" | "ready" | "unavailable" | "error";

interface DiagnosticsPanelProps {
  eventsStatus: EventsStatus;
  runEvents: RunEventRecord[];
  eventsMessage: string | null;
  pollingActive: boolean;
}

export function DiagnosticsPanel({
  eventsStatus,
  runEvents,
  eventsMessage,
  pollingActive,
}: DiagnosticsPanelProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="col-span-full rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="mb-3">
        <h3 className="text-base font-semibold">Diagnostics</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Worker messages and lifecycle events.
        </p>
      </div>

      {eventsStatus === "idle" && (
        <EmptyState
          icon={Activity}
          title="Waiting for run"
          description="Submit a run to see the event timeline."
        />
      )}

      {eventsStatus === "loading" && (
        <p className="text-sm text-muted-foreground">Fetching run events...</p>
      )}

      {eventsStatus === "unavailable" && (
        <ErrorBanner
          message={eventsMessage ?? "Events endpoint is not available for this backend."}
          variant="warn"
        />
      )}

      {eventsStatus === "error" && (
        <ErrorBanner
          message={eventsMessage ?? "Events request failed unexpectedly."}
        />
      )}

      {eventsStatus === "ready" && runEvents.length === 0 && (
        <EmptyState
          icon={Activity}
          title="No events yet"
          description="No events returned for this run."
        />
      )}

      {eventsStatus === "ready" && runEvents.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/30">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-4 py-3 text-sm font-semibold text-foreground/70 hover:text-foreground"
            onClick={() => setExpanded(!expanded)}
          >
            <Activity className="h-4 w-4" />
            Worker timeline ({runEvents.length} events)
            <ChevronDown
              className={`ml-auto h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          </button>

          {expanded && (
            <div className="border-t border-border p-3">
              <div className="max-h-96 space-y-2 overflow-auto">
                {runEvents.map((event, index) => {
                  const normalizedProgress =
                    typeof event.progress === "number" && event.progress > 1
                      ? clampProgress(event.progress / 100)
                      : clampProgress(event.progress);

                  return (
                    <div
                      key={
                        event.eventId ??
                        `${event.sequence ?? "evt"}-${event.createdAt ?? "time"}-${index}`
                      }
                      className="rounded-md border border-border bg-card p-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <EventLevelBadge label={event.level} />
                          {event.state && <StatusBadge label={event.state} />}
                          {event.type && (
                            <code className="rounded border border-border bg-muted px-1.5 py-0.5 text-[0.7rem]">
                              {event.type}
                            </code>
                          )}
                          {event.stage && (
                            <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[0.7rem] font-semibold">
                              {event.stage}
                            </span>
                          )}
                          {normalizedProgress !== null && (
                            <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[0.7rem] font-semibold">
                              {formatPercent(normalizedProgress)}
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(event.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm">{event.message}</p>
                      {event.details && Object.keys(event.details).length > 0 && (
                        <pre className="mt-2 max-h-32 overflow-auto rounded-md border border-border bg-muted p-2 font-mono text-[0.7rem] leading-relaxed">
                          {JSON.stringify(event.details, null, 2)}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {pollingActive ? "Events polling..." : "Events polling idle"}
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
