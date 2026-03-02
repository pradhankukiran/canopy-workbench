import type { PosteriorBundle, PropertyCatPricingYltOutput } from "@/types/api";
import type { PricingYltDisplay, PricingYltDisplayRow } from "@/types/display";
import { isObject, asFiniteNumber, asString, asBoolean } from "@/lib/type-coercion";
import { getBundleField } from "./bundle-utils";

export function extractPricingYlt(
  bundle: PosteriorBundle
): PricingYltDisplay | null {
  const rawOutput = getBundleField(
    bundle,
    "propertyCatPricing",
    "propertyCatPricingYlt",
    "pricingYlt",
    "propertyCatPricingYearLossTable",
    "ylt"
  ) as PropertyCatPricingYltOutput | unknown;

  if (rawOutput === undefined) return null;

  const rawObject = isObject(rawOutput) ? rawOutput : null;
  const nestedTable =
    rawObject && isObject(rawObject.yearLossTable)
      ? rawObject.yearLossTable
      : null;
  const rawRows = Array.isArray(rawOutput)
    ? rawOutput
    : Array.isArray(rawObject?.yearLossTable)
      ? rawObject.yearLossTable
      : Array.isArray(rawObject?.yltRows)
        ? rawObject.yltRows
        : Array.isArray(rawObject?.rows)
          ? rawObject.rows
          : Array.isArray(rawObject?.ylt)
            ? rawObject.ylt
            : Array.isArray(nestedTable?.rows)
              ? nestedTable.rows
              : [];

  const rows = rawRows
    .flatMap((row, index): PricingYltDisplayRow[] => {
      if (typeof row === "number" && Number.isFinite(row)) {
        return [{ yearIndex: index + 1, netLoss: row }];
      }
      if (!isObject(row)) return [];

      const yearIndex =
        asFiniteNumber(row.yearIndex) ??
        asFiniteNumber(row.year) ??
        asFiniteNumber(row.sampleYear) ??
        asFiniteNumber(row.simYear) ??
        index + 1;

      const grossLoss =
        asFiniteNumber(row.grossLoss) ??
        asFiniteNumber(row.aggregateGrossLoss) ??
        asFiniteNumber(row.gross);
      const cededLoss =
        asFiniteNumber(row.cededLoss) ??
        asFiniteNumber(row.aggregateCededLoss) ??
        asFiniteNumber(row.ceded);
      const payout =
        asFiniteNumber(row.payout) ??
        asFiniteNumber(row.bondPayout) ??
        asFiniteNumber(row.recovery) ??
        cededLoss;
      const netLoss =
        asFiniteNumber(row.netLoss) ??
        asFiniteNumber(row.aggregateNetLoss) ??
        asFiniteNumber(row.loss) ??
        (typeof grossLoss === "number" && typeof cededLoss === "number"
          ? grossLoss - cededLoss
          : undefined);

      return [
        {
          yearIndex: Math.max(1, Math.trunc(yearIndex)),
          eventCount:
            asFiniteNumber(row.eventCount) ??
            asFiniteNumber(row.events) ??
            asFiniteNumber(row.numEvents),
          grossLoss,
          cededLoss,
          netLoss,
          payout,
          triggered:
            asBoolean(row.triggered) ??
            asBoolean(row.bondExhausted) ??
            asBoolean(row.attachmentReached),
        },
      ];
    })
    .sort((a, b) => a.yearIndex - b.yearIndex);

  if (rows.length === 0) return null;

  const summary =
    (rawObject && isObject(rawObject.summary) ? rawObject.summary : null) ??
    (nestedTable && isObject(nestedTable.summary)
      ? nestedTable.summary
      : null);
  const percentiles =
    (summary && isObject(summary.percentiles) ? summary.percentiles : null) ??
    (rawObject && isObject(rawObject.percentiles)
      ? rawObject.percentiles
      : null);

  const p50Loss =
    asFiniteNumber(rawObject?.p50Loss) ??
    asFiniteNumber(rawObject?.lossP50) ??
    asFiniteNumber(summary?.p50Loss) ??
    asFiniteNumber(percentiles?.p50) ??
    asFiniteNumber(percentiles?.["50"]);
  const p90Loss =
    asFiniteNumber(rawObject?.p90Loss) ??
    asFiniteNumber(rawObject?.lossP90) ??
    asFiniteNumber(summary?.p90Loss) ??
    asFiniteNumber(percentiles?.p90) ??
    asFiniteNumber(percentiles?.["90"]);
  const p99Loss =
    asFiniteNumber(rawObject?.p99Loss) ??
    asFiniteNumber(rawObject?.lossP99) ??
    asFiniteNumber(summary?.p99Loss) ??
    asFiniteNumber(percentiles?.p99) ??
    asFiniteNumber(percentiles?.["99"]);
  const maxLoss =
    asFiniteNumber(rawObject?.maxLoss) ??
    asFiniteNumber(summary?.maxLoss) ??
    asFiniteNumber(summary?.maximumLoss);
  const simulatedYears =
    asFiniteNumber(rawObject?.simulatedYears) ??
    asFiniteNumber(rawObject?.sampleYearCount) ??
    asFiniteNumber(summary?.simulatedYears) ??
    (rows.length > 0 ? rows.length : undefined);
  const rowLimit =
    asFiniteNumber(rawObject?.rowLimit) ??
    asFiniteNumber(rawObject?.yltRowLimit) ??
    asFiniteNumber(nestedTable?.rowLimit);

  return {
    currency:
      asString(rawObject?.currency) ??
      asString(rawObject?.reportingCurrency) ??
      asString(summary?.currency),
    rowLimit:
      typeof rowLimit === "number"
        ? Math.max(1, Math.trunc(rowLimit))
        : undefined,
    simulatedYears:
      typeof simulatedYears === "number"
        ? Math.max(1, Math.trunc(simulatedYears))
        : undefined,
    p50Loss,
    p90Loss,
    p99Loss,
    maxLoss,
    rows,
  };
}
