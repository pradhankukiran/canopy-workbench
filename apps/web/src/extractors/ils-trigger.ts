import type {
  PosteriorBundle,
  IlsParametricTriggerSimulatorOutput,
} from "@/types/api";
import type {
  IlsTriggerSimulationDisplay,
  IlsTriggerSimulationDisplayRow,
} from "@/types/display";
import {
  isObject,
  asFiniteNumber,
  asString,
  asBoolean,
  maybeRatio,
} from "@/lib/type-coercion";
import { getBundleField } from "./bundle-utils";

export function extractIlsTriggerSimulation(
  bundle: PosteriorBundle
): IlsTriggerSimulationDisplay | null {
  const rawOutput = getBundleField(
    bundle,
    "ilsParametricTrigger",
    "ilsParametricTriggerSimulator",
    "parametricTriggerSimulation",
    "triggerSimulation",
    "ilsTriggerSimulation"
  ) as IlsParametricTriggerSimulatorOutput | unknown;

  if (rawOutput === undefined) return null;

  const rawObject = isObject(rawOutput) ? rawOutput : null;
  const nestedTable =
    rawObject && isObject(rawObject.table) ? rawObject.table : null;
  const summary =
    (rawObject && isObject(rawObject.summary) ? rawObject.summary : null) ??
    (nestedTable && isObject(nestedTable.summary)
      ? nestedTable.summary
      : null);
  const rawRows = Array.isArray(rawOutput)
    ? rawOutput
    : Array.isArray(rawObject?.rows)
      ? rawObject.rows
      : Array.isArray(rawObject?.scenarios)
        ? rawObject.scenarios
        : Array.isArray(rawObject?.simulatedEvents)
          ? rawObject.simulatedEvents
          : Array.isArray(rawObject?.eventScenarios)
            ? rawObject.eventScenarios
            : Array.isArray(rawObject?.triggerSimulation)
              ? rawObject.triggerSimulation
              : Array.isArray(rawObject?.outcomes)
                ? rawObject.outcomes
                : Array.isArray(nestedTable?.rows)
                  ? nestedTable.rows
                  : [];

  const rows = rawRows.flatMap(
    (row, index): IlsTriggerSimulationDisplayRow[] => {
      if (typeof row === "boolean") {
        return [{ scenario: `Scenario ${index + 1}`, triggered: row }];
      }
      if (typeof row === "number" && Number.isFinite(row)) {
        return [
          { scenario: `Scenario ${index + 1}`, triggerIndexValue: row },
        ];
      }
      if (!isObject(row)) return [];

      const triggerIndexValue =
        asFiniteNumber(row.triggerIndexValue) ??
        asFiniteNumber(row.indexValue) ??
        asFiniteNumber(row.measurement) ??
        asFiniteNumber(row.intensity);
      const threshold =
        asFiniteNumber(row.threshold) ??
        asFiniteNumber(row.attachmentThreshold) ??
        asFiniteNumber(row.triggerThreshold);
      const payoutPct =
        maybeRatio(row.payoutPct) ??
        maybeRatio(row.payoutPercent) ??
        maybeRatio(row.payoutRate) ??
        maybeRatio(row.payoutShare);
      const payoutAmount =
        asFiniteNumber(row.payoutAmount) ??
        asFiniteNumber(row.bondPayout) ??
        asFiniteNumber(row.recoveryAmount);

      const triggered =
        asBoolean(row.triggered) ??
        asBoolean(row.attachmentReached) ??
        (typeof payoutPct === "number" ? payoutPct > 0 : undefined);
      const exhausted =
        asBoolean(row.exhausted) ??
        asBoolean(row.exhaustionReached) ??
        (typeof payoutPct === "number" ? payoutPct >= 1 : undefined);

      const scenario =
        asString(row.scenario) ??
        asString(row.scenarioId) ??
        asString(row.name) ??
        asString(row.eventId) ??
        asString(row.id) ??
        `Scenario ${index + 1}`;

      return [
        {
          scenario,
          eventId: asString(row.eventId) ?? asString(row.id),
          peril: asString(row.peril) ?? asString(row.perilCode),
          region: asString(row.region) ?? asString(row.regionCode),
          triggerIndexValue,
          threshold,
          payoutPct,
          payoutAmount,
          triggered,
          exhausted,
        },
      ];
    }
  );

  if (rows.length === 0) return null;

  const thresholds =
    (rawObject && isObject(rawObject.thresholds)
      ? rawObject.thresholds
      : null) ??
    (rawObject && isObject(rawObject.triggerDefinition)
      ? rawObject.triggerDefinition
      : null);

  const simulationCount =
    asFiniteNumber(rawObject?.simulationCount) ??
    asFiniteNumber(rawObject?.simulatedEventCount) ??
    asFiniteNumber(rawObject?.scenarioCount) ??
    asFiniteNumber(summary?.simulationCount) ??
    asFiniteNumber(summary?.scenarioCount) ??
    rows.length;

  return {
    currency:
      asString(rawObject?.currency) ??
      asString(rawObject?.reportingCurrency) ??
      asString(summary?.currency),
    triggerProbability:
      maybeRatio(rawObject?.triggerProbability) ??
      maybeRatio(summary?.triggerProbability) ??
      maybeRatio(rawObject?.attachmentProbability),
    exhaustionProbability:
      maybeRatio(rawObject?.exhaustionProbability) ??
      maybeRatio(summary?.exhaustionProbability),
    expectedPayout:
      asFiniteNumber(rawObject?.expectedPayout) ??
      asFiniteNumber(rawObject?.averagePayout) ??
      asFiniteNumber(summary?.expectedPayout) ??
      asFiniteNumber(summary?.averagePayout),
    attachmentThreshold:
      asFiniteNumber(rawObject?.attachmentThreshold) ??
      asFiniteNumber(summary?.attachmentThreshold) ??
      asFiniteNumber(thresholds?.attachmentThreshold),
    exhaustionThreshold:
      asFiniteNumber(rawObject?.exhaustionThreshold) ??
      asFiniteNumber(summary?.exhaustionThreshold) ??
      asFiniteNumber(thresholds?.exhaustionThreshold),
    simulationCount:
      typeof simulationCount === "number"
        ? Math.max(1, Math.trunc(simulationCount))
        : undefined,
    rows,
  };
}
