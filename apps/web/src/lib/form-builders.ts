import type { ModuleDefinition } from "@/types/modules";
import type { RunFormState } from "@/types/forms";
import type { RunRequest, RunUploadBinding } from "@/types/api";
import { parseIntegerList, parseOptionalNumber } from "./parsers";

export function buildDefaultForm(module: ModuleDefinition): RunFormState {
  return {
    workspaceId: "ws_demo001",
    candidateDealId: "deal_demo001",
    engineProfile: module.defaultEngineProfile,
    randomSeed: "42",
    includeYearOutcomes: true,
    includeEventOutcomes: module.key === "sensitivity",
    propertyCatPricingYlt: {
      simulatedYears: "10000",
      returnPeriodsYearsCsv: "10, 20, 50, 100",
      yltRowLimit: "25",
      lossBasis: "net",
      includeGrossNetBreakout: true,
      includeSummaryPercentiles: true,
      propertyPortfolioPath: "test-data/property/synthetic_100_portfolio.json",
      hurdat2Path: "test-data/hurdat2/combined_atlantic_pacific.hurdat2",
      useScalaEngine: true,
      scalaEngineTimeoutMs: "",
    },
    ilsParametricTriggerSimulator: {
      triggerIndexName: "NOAA_WIND_INDEX",
      regionCode: "US-GULF",
      perilCode: "wind",
      attachmentThreshold: "65",
      exhaustionThreshold: "110",
      payoutCurve: "linear",
      simulationCount: "2500",
      includeEventLevelOutcomes: true,
      hurdat2Path: "test-data/hurdat2/combined_atlantic_pacific.hurdat2",
      useScalaEngine: true,
      scalaEngineTimeoutMs: "",
    },
    marginalPortfolioImpact: {
      referencePortfolioId: "port_demo001",
      tailMetric: "oep",
      returnPeriodsYearsCsv: "10, 20, 50, 100",
      candidateParticipationPct: "100",
      includeTailRiskComparison: true,
    },
  };
}

export function buildRunPayload(
  module: ModuleDefinition,
  form: RunFormState,
  includeIdempotencyKey: boolean,
  uploadId?: string,
  uploadBindings?: RunUploadBinding[]
): RunRequest {
  const randomSeedValue = form.randomSeed.trim();
  const payload: RunRequest = {
    workspaceId: form.workspaceId.trim(),
    candidateDealId: form.candidateDealId.trim(),
    analysisType: module.analysisType,
    engineProfile: form.engineProfile,
    outputOptions: {
      includeYearOutcomes: form.includeYearOutcomes,
      includeEventOutcomes: form.includeEventOutcomes,
      includePosteriorSamples: false,
    },
  };

  if (randomSeedValue.length > 0) {
    const parsed = Number(randomSeedValue);
    if (Number.isFinite(parsed)) {
      payload.randomSeed = Math.max(0, Math.trunc(parsed));
    }
  }

  if (uploadId && uploadId.trim().length > 0) {
    payload.uploadId = uploadId.trim();
  }

  if (uploadBindings && uploadBindings.length > 0) {
    payload.uploads = uploadBindings;
  }

  if (includeIdempotencyKey) {
    payload.idempotencyKey = `web-${module.key}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  }

  if (module.key === "pricing") {
    const pricingForm = form.propertyCatPricingYlt;
    const simulatedYears = parseOptionalNumber(pricingForm.simulatedYears);
    const yltRowLimit = parseOptionalNumber(pricingForm.yltRowLimit);
    const returnPeriodsYears = parseIntegerList(pricingForm.returnPeriodsYearsCsv);
    const pricingScalaEngineTimeoutMs = parseOptionalNumber(
      pricingForm.scalaEngineTimeoutMs
    );
    const pricingPropertyPortfolioPath = pricingForm.propertyPortfolioPath.trim();
    const pricingHurdat2Path = pricingForm.hurdat2Path.trim();

    payload.moduleParameters = {
      propertyCatPricing: {
        ...(typeof simulatedYears === "number"
          ? {
              simulatedYears: Math.max(1, Math.trunc(simulatedYears)),
              sampleYearCount: Math.max(1, Math.trunc(simulatedYears)),
            }
          : {}),
        ...(returnPeriodsYears.length > 0 ? { returnPeriodsYears } : {}),
        ...(typeof yltRowLimit === "number"
          ? { yltRowLimit: Math.max(1, Math.trunc(yltRowLimit)) }
          : {}),
        lossBasis: pricingForm.lossBasis,
        includeGrossNetBreakout: pricingForm.includeGrossNetBreakout,
        includeSummaryPercentiles: pricingForm.includeSummaryPercentiles,
        ...(pricingPropertyPortfolioPath.length > 0
          ? { propertyPortfolioPath: pricingPropertyPortfolioPath }
          : {}),
        ...(pricingHurdat2Path.length > 0
          ? { hurdat2Path: pricingHurdat2Path }
          : {}),
        useScalaEngine: true,
        ...(typeof pricingScalaEngineTimeoutMs === "number"
          ? {
              scalaEngineTimeoutMs: Math.max(
                1,
                Math.trunc(pricingScalaEngineTimeoutMs)
              ),
            }
          : {}),
      },
    };
  } else if (module.key === "sensitivity") {
    const ilsForm = form.ilsParametricTriggerSimulator;
    const attachmentThreshold = parseOptionalNumber(ilsForm.attachmentThreshold);
    const exhaustionThreshold = parseOptionalNumber(ilsForm.exhaustionThreshold);
    const simulationCount = parseOptionalNumber(ilsForm.simulationCount);
    const scalaEngineTimeoutMs = parseOptionalNumber(ilsForm.scalaEngineTimeoutMs);
    const triggerIndexName = ilsForm.triggerIndexName.trim();
    const regionCode = ilsForm.regionCode.trim();
    const perilCode = ilsForm.perilCode.trim();
    const hurdat2Path = ilsForm.hurdat2Path.trim();

    payload.moduleParameters = {
      ilsParametricTrigger: {
        ...(triggerIndexName.length > 0 ? { triggerIndexName } : {}),
        ...(regionCode.length > 0 ? { regionCode } : {}),
        ...(perilCode.length > 0 ? { perilCode } : {}),
        ...(typeof attachmentThreshold === "number"
          ? { attachmentThreshold }
          : {}),
        ...(typeof exhaustionThreshold === "number"
          ? { exhaustionThreshold }
          : {}),
        payoutCurve: ilsForm.payoutCurve,
        ...(typeof simulationCount === "number"
          ? { simulationCount: Math.max(1, Math.trunc(simulationCount)) }
          : {}),
        includeEventLevelOutcomes: ilsForm.includeEventLevelOutcomes,
        ...(hurdat2Path.length > 0 ? { hurdat2Path } : {}),
        useScalaEngine: true,
        ...(typeof scalaEngineTimeoutMs === "number"
          ? {
              scalaEngineTimeoutMs: Math.max(
                1,
                Math.trunc(scalaEngineTimeoutMs)
              ),
            }
          : {}),
      },
    };
  } else if (module.key === "risk") {
    throw new Error(
      "Marginal Portfolio Impact is disabled because its current engine still relies on synthetic heuristics."
    );
  }

  return payload;
}
