import { lazy, Suspense, useMemo } from "react";
import type { PricingYltDisplay } from "@/types/display";
import type { PosteriorBundle } from "@/types/api";
import { formatCurrency, formatNumber } from "@/lib/format";
import { SummaryStrip } from "@/components/shared/summary-strip";
import { DataTable } from "@/components/shared/data-table";
import { ChartSkeleton } from "@/components/shared/loading-skeleton";

const LossExceedanceCurve = lazy(
  () => import("../charts/loss-exceedance-curve")
);
const LossDistribution = lazy(
  () => import("../charts/loss-distribution")
);
const PercentileBar = lazy(() => import("../charts/percentile-bar"));

interface PricingResultsProps {
  pricingYlt: PricingYltDisplay;
  bundle: PosteriorBundle;
}

export function PricingResults({ pricingYlt, bundle }: PricingResultsProps) {
  const currency =
    pricingYlt.currency ?? bundle.riskMetrics.currency ?? "USD";

  const visibleRows = useMemo(
    () =>
      pricingYlt.rows.slice(
        0,
        Math.min(pricingYlt.rowLimit ?? 100, pricingYlt.rows.length)
      ),
    [pricingYlt]
  );

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-semibold">
          Year Loss Table
        </h4>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Simulated annual losses with summary statistics.
        </p>
      </div>

      <SummaryStrip
        items={[
          {
            label: "Simulated Years",
            value: formatNumber(pricingYlt.simulatedYears, 0),
          },
          {
            label: "P50 Loss",
            value: formatCurrency(pricingYlt.p50Loss, currency),
            help: "Median annual loss \u2014 50% of years have lower losses.",
          },
          {
            label: "P99 Loss",
            value: formatCurrency(pricingYlt.p99Loss, currency),
            help: "Loss exceeded in only 1% of simulated years.",
          },
          {
            label: "Max Loss",
            value: formatCurrency(pricingYlt.maxLoss, currency),
          },
        ]}
      />

      <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
        <Suspense fallback={<ChartSkeleton />}>
          {bundle.riskMetrics.oep && bundle.riskMetrics.oep.length > 0 && (
            <LossExceedanceCurve
              oep={bundle.riskMetrics.oep}
              aep={bundle.riskMetrics.aep}
              currency={currency}
            />
          )}
        </Suspense>
        <Suspense fallback={<ChartSkeleton />}>
          {pricingYlt.rows.length > 0 && (
            <LossDistribution rows={pricingYlt.rows} currency={currency} />
          )}
        </Suspense>
      </div>

      <Suspense fallback={<ChartSkeleton />}>
        {(pricingYlt.p50Loss || pricingYlt.p90Loss || pricingYlt.p99Loss) && (
          <PercentileBar
            p50={pricingYlt.p50Loss}
            p90={pricingYlt.p90Loss}
            p99={pricingYlt.p99Loss}
            max={pricingYlt.maxLoss}
            currency={currency}
          />
        )}
      </Suspense>

      <DataTable
        columns={[
          {
            key: "yearIndex",
            header: "Year",
            render: (row) => row.yearIndex,
          },
          {
            key: "eventCount",
            header: "Events",
            render: (row) => formatNumber(row.eventCount, 0),
          },
          {
            key: "grossLoss",
            header: "Gross Loss",
            render: (row) => formatCurrency(row.grossLoss, currency),
          },
          {
            key: "cededLoss",
            header: "Ceded Loss",
            render: (row) => formatCurrency(row.cededLoss, currency),
          },
          {
            key: "netLoss",
            header: "Net Loss",
            render: (row) => formatCurrency(row.netLoss, currency),
          },
          {
            key: "payout",
            header: "Payout",
            render: (row) => formatCurrency(row.payout, currency),
          },
          {
            key: "triggered",
            header: "Triggered",
            render: (row) =>
              typeof row.triggered === "boolean"
                ? row.triggered
                  ? "Yes"
                  : "No"
                : "\u2014",
          },
        ]}
        data={visibleRows}
        keyExtractor={(row) => `pricing-ylt-${row.yearIndex}`}
        maxRows={50}
      />
    </div>
  );
}
