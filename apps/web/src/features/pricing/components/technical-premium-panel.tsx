import { formatCurrency, formatNumber } from "@/lib/format";
import { DataTable } from "@/components/shared/data-table";
import type { PropertyCatPricingYltOutput } from "@/types/api";

type LayerPremium = NonNullable<PropertyCatPricingYltOutput["layerPremiums"]>[number];
type TvarPoint = NonNullable<PropertyCatPricingYltOutput["tvarByReturnPeriod"]>[number];

interface TechnicalPremiumPanelProps {
  pricingOutput?: PropertyCatPricingYltOutput;
  currency: string;
}

/**
 * Renders per-layer premium + TVaR curve + layer-tower frequency flags.
 * Returns null when the run didn't configure a layer tower (engine
 * leaves layerPremiums unset in that case, so there's nothing to show).
 */
export function TechnicalPremiumPanel({ pricingOutput, currency }: TechnicalPremiumPanelProps) {
  const layerPremiums = pricingOutput?.layerPremiums ?? [];
  const tvar = pricingOutput?.tvarByReturnPeriod ?? [];
  const attachmentFreq = pricingOutput?.layerAttachmentFrequency;
  const exhaustionFreq = pricingOutput?.layerExhaustionFrequency;

  if (layerPremiums.length === 0 && tvar.length === 0) return null;

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <header>
        <h4 className="text-sm font-semibold">Technical premium & tail risk</h4>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Phase-3 financial pipeline output. Per-layer premium from the
          configured reinsurance tower; TVaR at each return period from the
          aggregate annual-loss distribution.
        </p>
      </header>

      {layerPremiums.length > 0 && (
        <div className="mt-3">
          <DataTable<LayerPremium>
            columns={[
              {
                key: "layerName",
                header: "Layer",
                render: (r) => r.layerName ?? "—",
              },
              {
                key: "pureLoss",
                header: "Pure loss",
                render: (r) => formatCurrency(r.pureLoss ?? 0, currency),
              },
              {
                key: "stdDev",
                header: "σ (loss)",
                render: (r) => formatCurrency(r.stdDevLoss ?? 0, currency),
              },
              {
                key: "riskLoaded",
                header: "Risk-loaded",
                render: (r) => formatCurrency(r.riskLoadedPremium ?? 0, currency),
              },
              {
                key: "brokerage",
                header: "Brokerage",
                render: (r) => formatCurrency(r.brokerage ?? 0, currency),
              },
              {
                key: "profitCommission",
                header: "PC",
                render: (r) => formatCurrency(r.profitCommission ?? 0, currency),
              },
              {
                key: "grossTechnicalPremium",
                header: "Gross tech",
                render: (r) => formatCurrency(r.grossTechnicalPremium ?? 0, currency),
              },
              {
                key: "rateOnLine",
                header: "RoL",
                render: (r) =>
                  typeof r.rateOnLine === "number"
                    ? `${formatNumber(r.rateOnLine * 100, 2)}%`
                    : "—",
              },
            ]}
            data={layerPremiums}
            keyExtractor={(r, i) => r.layerName ?? `layer-${i}`}
          />
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-4 max-md:grid-cols-1">
        {tvar.length > 0 && (
          <div>
            <h5 className="text-xs font-semibold uppercase text-muted-foreground">
              TVaR by return period
            </h5>
            <DataTable<TvarPoint>
              columns={[
                {
                  key: "returnPeriodYears",
                  header: "RP (yrs)",
                  render: (r) => formatNumber(r.returnPeriodYears ?? 0, 0),
                },
                {
                  key: "tvar",
                  header: "TVaR",
                  render: (r) => formatCurrency(r.tvar ?? 0, currency),
                },
              ]}
              data={tvar}
              keyExtractor={(r, i) => String(r.returnPeriodYears ?? i)}
            />
          </div>
        )}

        {typeof attachmentFreq === "number" &&
          typeof exhaustionFreq === "number" && (
            <div>
              <h5 className="text-xs font-semibold uppercase text-muted-foreground">
                Tower triggers
              </h5>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted-foreground">Years any layer attached</dt>
                <dd className="font-mono">{formatNumber(attachmentFreq * 100, 2)}%</dd>
                <dt className="text-muted-foreground">Years all layers exhausted</dt>
                <dd className="font-mono">{formatNumber(exhaustionFreq * 100, 2)}%</dd>
              </dl>
            </div>
          )}
      </div>
    </section>
  );
}
