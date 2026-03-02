import type { EngineProfile, UploadInputRole, UploadRecord } from "./api";

export interface MarginalPortfolioImpactFormState {
  referencePortfolioId: string;
  tailMetric: "oep" | "aep";
  returnPeriodsYearsCsv: string;
  candidateParticipationPct: string;
  includeTailRiskComparison: boolean;
}

export interface PropertyCatPricingYltFormState {
  simulatedYears: string;
  returnPeriodsYearsCsv: string;
  yltRowLimit: string;
  lossBasis: "net" | "gross" | "ceded";
  includeGrossNetBreakout: boolean;
  includeSummaryPercentiles: boolean;
  propertyPortfolioPath: string;
  hurdat2Path: string;
  useScalaEngine: boolean;
  scalaEngineTimeoutMs: string;
}

export interface IlsParametricTriggerSimulatorFormState {
  triggerIndexName: string;
  regionCode: string;
  perilCode: string;
  attachmentThreshold: string;
  exhaustionThreshold: string;
  payoutCurve: "linear" | "binary" | "stepped";
  simulationCount: string;
  includeEventLevelOutcomes: boolean;
  hurdat2Path: string;
  useScalaEngine: boolean;
  scalaEngineTimeoutMs: string;
}

export interface RunFormState {
  workspaceId: string;
  candidateDealId: string;
  engineProfile: EngineProfile;
  randomSeed: string;
  includeYearOutcomes: boolean;
  includeEventOutcomes: boolean;
  propertyCatPricingYlt: PropertyCatPricingYltFormState;
  ilsParametricTriggerSimulator: IlsParametricTriggerSimulatorFormState;
  marginalPortfolioImpact: MarginalPortfolioImpactFormState;
}

export type UploadRegistrationStatus =
  | "selected"
  | "registering"
  | "registered"
  | "error";

export interface UploadRegistrationItem {
  localId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  file?: File;
  role?: UploadInputRole | "";
  status: UploadRegistrationStatus;
  upload?: UploadRecord;
  errorMessage?: string;
}
