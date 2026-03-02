import type { ReactNode } from "react";
import type { PosteriorBundle } from "@/types/api";
import { formatCurrency, formatPercent, formatDateTime, formatNumber } from "@/lib/format";
import { SummaryStrip } from "@/components/shared/summary-strip";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorBanner } from "@/components/shared/error-banner";
import { ChevronDown, BarChart3 } from "lucide-react";
import { useState } from "react";

type ResultsStatus = "idle" | "loading" | "ready" | "unavailable" | "error";

interface ResultsLayoutProps {
  resultsStatus: ResultsStatus;
  resultsBundle: PosteriorBundle | null;
  resultsMessage: string | null;
  children: ReactNode;
}

export function ResultsLayout({
  resultsStatus,
  resultsBundle,
  resultsMessage,
  children,
}: ResultsLayoutProps) {
  const [metadataOpen, setMetadataOpen] = useState(false);

  return (
    <section className="col-span-full rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="mb-3">
        <h3 className="text-base font-semibold">Results</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Key risk metrics and analysis output.
        </p>
      </div>

      {resultsStatus === "idle" && (
        <EmptyState
          icon={BarChart3}
          title="No results yet"
          description="Submit a run to view results."
        />
      )}

      {resultsStatus === "loading" && (
        <p className="text-sm text-muted-foreground">
          Loading results...
        </p>
      )}

      {resultsStatus === "unavailable" && (
        <ErrorBanner
          message={resultsMessage ?? "Run completed, but results are not available yet."}
          variant="warn"
        />
      )}

      {resultsStatus === "error" && (
        <ErrorBanner
          message={resultsMessage ?? "Results request failed unexpectedly."}
        />
      )}

      {resultsStatus === "ready" && resultsBundle && (
        <div className="space-y-4">
          <SummaryStrip
            items={[
              {
                label: "Expected Loss",
                value: formatCurrency(
                  resultsBundle.riskMetrics.expectedLoss,
                  resultsBundle.riskMetrics.currency ?? "USD"
                ),
                help: "Average annual loss across all simulated scenarios.",
              },
              {
                label: "Attachment Probability",
                value: formatPercent(
                  resultsBundle.riskMetrics.attachmentProbability
                ),
                help: "Probability that losses exceed the attachment point in any given year.",
              },
              {
                label: "Exhaustion Probability",
                value: formatPercent(
                  resultsBundle.riskMetrics.exhaustionProbability
                ),
                help: "Probability that losses fully exhaust the coverage limit.",
              },
              {
                label: "VaR 99",
                value: formatCurrency(
                  resultsBundle.riskMetrics.var99,
                  resultsBundle.riskMetrics.currency ?? "USD"
                ),
                help: "99th percentile Value at Risk \u2014 loss exceeded only 1% of the time.",
              },
            ]}
          />

          <div className="rounded-lg border border-border bg-muted/30">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-4 py-3 text-sm font-semibold text-foreground/70 hover:text-foreground"
              onClick={() => setMetadataOpen(!metadataOpen)}
            >
              Model & Run Metadata
              <ChevronDown
                className={`ml-auto h-4 w-4 transition-transform ${metadataOpen ? "rotate-180" : ""}`}
              />
            </button>
            {metadataOpen && (
              <div className="border-t border-border p-3">
                <SummaryStrip
                  items={[
                    {
                      label: "Generated",
                      value: formatDateTime(resultsBundle.generatedAt),
                    },
                    {
                      label: "Posterior Samples",
                      value: formatNumber(
                        resultsBundle.posteriorSampleCount,
                        0
                      ),
                    },
                    {
                      label: "Model Version",
                      value: resultsBundle.modelVersion ?? "\u2014",
                    },
                    {
                      label: "Prior Version",
                      value: resultsBundle.priorVersion ?? "\u2014",
                    },
                  ]}
                />
              </div>
            )}
          </div>

          {children}
        </div>
      )}
    </section>
  );
}
