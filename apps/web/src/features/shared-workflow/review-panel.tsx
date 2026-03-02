import type { RunRequest } from "@/types/api";
import { SummaryStrip } from "@/components/shared/summary-strip";
import { ErrorBanner } from "@/components/shared/error-banner";
import { ChevronDown, Play, RefreshCw } from "lucide-react";
import { useState } from "react";

interface ReviewPanelProps {
  reviewPayload: RunRequest | null;
  reviewHighlights: Array<{ label: string; value: string }>;
  isSubmitting: boolean;
  pollingActive: boolean;
  submitError: string | null;
  hasPollTarget: boolean;
  onManualRefresh: () => void;
}

export function ReviewPanel({
  reviewPayload,
  reviewHighlights,
  isSubmitting,
  pollingActive,
  submitError,
  hasPollTarget,
  onManualRefresh,
}: ReviewPanelProps) {
  const [technicalOpen, setTechnicalOpen] = useState(false);

  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="mb-3">
        <h3 className="text-base font-semibold">Review & Run</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Confirm the execution plan and launch.
        </p>
      </div>

      <SummaryStrip items={reviewHighlights} className="mb-3" />

      <p className="mb-3 text-sm text-muted-foreground">
        The run will use the active module inputs above.
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50"
          disabled={isSubmitting || pollingActive}
        >
          <Play className="h-3.5 w-3.5" />
          {isSubmitting ? "Submitting..." : "Submit Run"}
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80 disabled:opacity-50"
          onClick={onManualRefresh}
          disabled={!hasPollTarget}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Poll now
        </button>
      </div>

      <div className="mt-3 rounded-lg border border-border bg-muted/30">
        <button
          type="button"
          className="flex w-full items-center gap-2 px-4 py-3 text-sm font-semibold text-foreground/70 hover:text-foreground"
          onClick={() => setTechnicalOpen(!technicalOpen)}
        >
          Technical Details
          <ChevronDown
            className={`ml-auto h-4 w-4 transition-transform ${technicalOpen ? "rotate-180" : ""}`}
          />
        </button>
        {technicalOpen && (
          <div className="border-t border-border p-3">
            <div className="max-h-64 overflow-auto rounded-md border border-border bg-card">
              <pre className="p-3 font-mono text-xs leading-relaxed">
                {JSON.stringify(reviewPayload, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>

      {submitError && <ErrorBanner message={submitError} />}
    </section>
  );
}
