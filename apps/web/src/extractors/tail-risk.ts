import type {
  PosteriorBundle,
  MarginalPortfolioImpactOutput,
} from "@/types/api";
import type {
  TailRiskComparisonDisplay,
  TailRiskComparisonDisplayRow,
} from "@/types/display";
import { isObject, asFiniteNumber, asString } from "@/lib/type-coercion";
import { normalizeTailMetricLabel } from "@/lib/tone";

export function extractTailRiskComparison(
  bundle: PosteriorBundle
): TailRiskComparisonDisplay | null {
  const rawOutput: MarginalPortfolioImpactOutput | undefined =
    bundle.moduleOutputs?.marginalPortfolioImpact ??
    bundle.marginalPortfolioImpact;

  if (!isObject(rawOutput)) return null;

  const rawRows = Array.isArray(rawOutput.tailRiskComparison)
    ? rawOutput.tailRiskComparison
    : Array.isArray(rawOutput.beforeAfterTailRisk)
      ? rawOutput.beforeAfterTailRisk
      : Array.isArray(rawOutput.comparisonRows)
        ? rawOutput.comparisonRows
        : [];

  const defaultMetric =
    normalizeTailMetricLabel(rawOutput.tailMetric) ??
    normalizeTailMetricLabel(
      (rawOutput as Record<string, unknown>).metric
    ) ??
    "Tail";

  const rows = rawRows
    .flatMap((row): TailRiskComparisonDisplayRow[] => {
      if (!isObject(row)) return [];

      const returnPeriodYears =
        asFiniteNumber(row.returnPeriodYears) ??
        asFiniteNumber(row.returnPeriod) ??
        asFiniteNumber(row.returnPeriodYear) ??
        asFiniteNumber(row.periodYears);

      if (typeof returnPeriodYears !== "number") return [];

      const before =
        asFiniteNumber(row.before) ??
        asFiniteNumber(row.beforeLoss) ??
        asFiniteNumber(row.beforeNetLoss) ??
        asFiniteNumber(row.beforeTailRisk);
      const after =
        asFiniteNumber(row.after) ??
        asFiniteNumber(row.afterLoss) ??
        asFiniteNumber(row.afterNetLoss) ??
        asFiniteNumber(row.afterTailRisk);
      const delta =
        asFiniteNumber(row.delta) ??
        asFiniteNumber(row.deltaLoss) ??
        asFiniteNumber(row.deltaNetLoss) ??
        (typeof before === "number" && typeof after === "number"
          ? after - before
          : undefined);
      const deltaPct =
        asFiniteNumber(row.deltaPct) ??
        asFiniteNumber(row.deltaPercent) ??
        asFiniteNumber(row.deltaRate) ??
        (typeof before === "number" &&
        before !== 0 &&
        typeof after === "number"
          ? (after - before) / before
          : undefined);

      return [
        {
          returnPeriodYears: Math.trunc(returnPeriodYears),
          metric:
            normalizeTailMetricLabel(row.metric) ??
            normalizeTailMetricLabel(row.tailMetric) ??
            defaultMetric,
          before,
          after,
          delta,
          deltaPct,
        },
      ];
    })
    .sort((a, b) => {
      if (a.returnPeriodYears !== b.returnPeriodYears)
        return a.returnPeriodYears - b.returnPeriodYears;
      return a.metric.localeCompare(b.metric);
    });

  if (rows.length === 0) return null;

  return {
    currency:
      asString(rawOutput.currency) ??
      asString(
        (rawOutput as Record<string, unknown>).reportingCurrency
      ),
    rows,
  };
}
