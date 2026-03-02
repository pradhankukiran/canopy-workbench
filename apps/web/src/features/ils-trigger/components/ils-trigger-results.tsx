import { lazy, Suspense, useMemo } from "react";
import type { IlsTriggerSimulationDisplay } from "@/types/display";
import type { PosteriorBundle } from "@/types/api";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import { SummaryStrip } from "@/components/shared/summary-strip";
import { DataTable } from "@/components/shared/data-table";
import { ChartSkeleton } from "@/components/shared/loading-skeleton";

const TriggerResponseCurve = lazy(
  () => import("../charts/trigger-response-curve")
);
const PayoutDistribution = lazy(
  () => import("../charts/payout-distribution")
);
const ScenarioScatter = lazy(
  () => import("../charts/scenario-scatter")
);

interface IlsTriggerResultsProps {
  simulation: IlsTriggerSimulationDisplay;
  bundle: PosteriorBundle;
}

export function IlsTriggerResults({
  simulation,
  bundle,
}: IlsTriggerResultsProps) {
  const currency =
    simulation.currency ?? bundle.riskMetrics.currency ?? "USD";

  const visibleRows = useMemo(
    () => simulation.rows.slice(0, Math.min(100, simulation.rows.length)),
    [simulation]
  );

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-semibold">Trigger Simulation</h4>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Parametric trigger outcomes and payout analysis.
        </p>
      </div>

      <SummaryStrip
        items={[
          {
            label: "Trigger Probability",
            value: formatPercent(simulation.triggerProbability),
            help: "Probability that the index exceeds the trigger point in a given scenario.",
          },
          {
            label: "Exhaustion Probability",
            value: formatPercent(simulation.exhaustionProbability),
            help: "Probability that the bond pays the full notional amount.",
          },
          {
            label: "Expected Payout",
            value: formatCurrency(simulation.expectedPayout, currency),
            help: "Average payout across all simulated scenarios.",
          },
          {
            label: "Scenarios",
            value: formatNumber(simulation.simulationCount, 0),
          },
        ]}
      />

      <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
        <Suspense fallback={<ChartSkeleton />}>
          {simulation.attachmentThreshold != null &&
            simulation.exhaustionThreshold != null && (
              <TriggerResponseCurve
                attachmentThreshold={simulation.attachmentThreshold}
                exhaustionThreshold={simulation.exhaustionThreshold}
              />
            )}
        </Suspense>
        <Suspense fallback={<ChartSkeleton />}>
          {simulation.rows.length > 0 && (
            <PayoutDistribution rows={simulation.rows} currency={currency} />
          )}
        </Suspense>
      </div>

      <Suspense fallback={<ChartSkeleton />}>
        {simulation.rows.length > 0 && (
          <ScenarioScatter rows={simulation.rows} />
        )}
      </Suspense>

      <DataTable
        columns={[
          { key: "scenario", header: "Scenario", render: (r) => r.scenario },
          { key: "peril", header: "Peril", render: (r) => r.peril ?? "\u2014" },
          { key: "region", header: "Region", render: (r) => r.region ?? "\u2014" },
          {
            key: "indexValue",
            header: "Index Value",
            render: (r) => formatNumber(r.triggerIndexValue, 2),
          },
          {
            key: "triggered",
            header: "Triggered",
            render: (r) =>
              typeof r.triggered === "boolean"
                ? r.triggered
                  ? "Yes"
                  : "No"
                : "\u2014",
          },
          {
            key: "payoutPct",
            header: "Payout %",
            render: (r) => formatPercent(r.payoutPct),
          },
          {
            key: "payoutAmount",
            header: "Payout",
            render: (r) => formatCurrency(r.payoutAmount, currency),
          },
          {
            key: "exhausted",
            header: "Exhausted",
            render: (r) =>
              typeof r.exhausted === "boolean"
                ? r.exhausted
                  ? "Yes"
                  : "No"
                : "\u2014",
          },
        ]}
        data={visibleRows}
        keyExtractor={(r, i) =>
          `ils-${r.scenario}-${r.eventId ?? i}`
        }
        maxRows={50}
      />
    </div>
  );
}
