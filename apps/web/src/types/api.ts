export type JobState =
  | "queued"
  | "validating"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled"
  | (string & {});

export type AnalysisType = "pricing" | "risk" | "sensitivity";
export type EngineProfile = "fast" | "standard" | "full";

export interface ApiErrorDetails {
  code?: string;
  message?: string;
  details?: unknown;
  requestId?: string;
}

export interface ApiErrorEnvelope {
  error?: ApiErrorDetails;
}

export interface JobRecord {
  jobId: string;
  runId?: string;
  workspaceId?: string;
  state: JobState;
  progress?: number;
  submittedAt?: string;
  updatedAt?: string;
  error?: ApiErrorDetails;
}

export interface RunRecord {
  runId: string;
  workspaceId: string;
  candidateDealId?: string;
  jobId?: string;
  state: JobState;
  analysisType?: string;
  createdAt?: string;
  completedAt?: string;
  resultAvailable?: boolean;
}

export interface RunSubmission {
  run: RunRecord;
  job: JobRecord;
}

export interface UploadRecord {
  uploadId: string;
  workspaceId?: string;
  filename?: string;
  contentType?: string;
  bytes?: number;
  status?: string;
  storagePath?: string;
  createdAt?: string;
}

export interface CreateUploadRequest {
  workspaceId?: string;
  filename: string;
  contentType?: string;
  sizeBytes?: number;
  contentText?: string;
}

export type UploadInputRole =
  | "hurdat2"
  | "propertyPortfolio"
  | "baselinePortfolio"
  | "candidateDeal"
  | "catBondTerms"
  | (string & {});

export interface RunUploadBinding {
  uploadId: string;
  role?: UploadInputRole;
  filename?: string;
}

export interface MarginalPortfolioImpactParameters {
  baselinePortfolioId?: string;
  candidateDealName?: string;
  candidateDealLimit?: number;
  tailCurve?: "oep" | "aep" | (string & {});
  tailMetric?: "var" | "tvar" | "oep" | "aep" | (string & {});
  tailReturnPeriodYears?: number;
  referencePortfolioId?: string;
  returnPeriodsYears?: number[];
  candidateParticipationPct?: number;
  includeTailRiskComparison?: boolean;
}

export interface PropertyCatPricingYltParameters {
  simulatedYears?: number;
  sampleYearCount?: number;
  returnPeriodsYears?: number[];
  yltRowLimit?: number;
  includeSummaryPercentiles?: boolean;
  includeGrossNetBreakout?: boolean;
  lossBasis?: "net" | "gross" | "ceded" | (string & {});
  propertyPortfolioPath?: string;
  hurdat2Path?: string;
  useScalaEngine?: boolean;
  scalaEngineTimeoutMs?: number;
}

export interface IlsParametricTriggerSimulatorParameters {
  triggerIndexName?: string;
  regionCode?: string;
  perilCode?: string;
  attachmentThreshold?: number;
  exhaustionThreshold?: number;
  payoutCurve?: "linear" | "binary" | "stepped" | (string & {});
  simulationCount?: number;
  includeEventLevelOutcomes?: boolean;
  hurdat2Path?: string;
  useScalaEngine?: boolean;
  scalaEngineTimeoutMs?: number;
}

export interface RunRequest {
  workspaceId: string;
  candidateDealId: string;
  analysisType: AnalysisType;
  engineProfile: EngineProfile;
  uploadId?: string;
  uploads?: RunUploadBinding[];
  randomSeed?: number;
  outputOptions?: {
    includeYearOutcomes?: boolean;
    includeEventOutcomes?: boolean;
    includePosteriorSamples?: boolean;
  };
  moduleParameters?: {
    propertyCatPricing?: PropertyCatPricingYltParameters;
    propertyCatPricingYlt?: PropertyCatPricingYltParameters;
    pricingYlt?: PropertyCatPricingYltParameters;
    ilsParametricTrigger?: IlsParametricTriggerSimulatorParameters;
    ilsParametricTriggerSimulator?: IlsParametricTriggerSimulatorParameters;
    parametricTriggerSimulation?: IlsParametricTriggerSimulatorParameters;
    marginalPortfolioImpact?: MarginalPortfolioImpactParameters;
  };
  idempotencyKey?: string;
}

export interface RunEventRecord {
  eventId?: string;
  runId?: string;
  jobId?: string;
  type?: string;
  stage?: string;
  state?: string;
  level?: string;
  message: string;
  progress?: number;
  sequence?: number;
  createdAt?: string;
  details?: Record<string, unknown>;
}

export interface RunEventsResponse {
  items: RunEventRecord[];
}

export interface ReturnPeriodPoint {
  returnPeriodYears: number;
  grossLoss?: number;
  netLoss?: number;
  bondPayout?: number;
}

export interface RiskMetrics {
  currency?: string;
  expectedLoss: number;
  expectedLossRate?: number;
  stdDevLoss?: number;
  attachmentProbability: number;
  exhaustionProbability: number;
  var99?: number;
  tvar99?: number;
  oep?: ReturnPeriodPoint[];
  aep?: ReturnPeriodPoint[];
}

export interface YearOutcome {
  yearIndex: number;
  eventCount: number;
  aggregateGrossLoss: number;
  aggregateCededLoss?: number;
  aggregateNetLoss: number;
  bondExhausted?: boolean;
}

export interface PosteriorBundle {
  runId: string;
  workspaceId?: string;
  generatedAt: string;
  modelVersion?: string;
  priorVersion?: string;
  posteriorSampleCount: number;
  riskMetrics: RiskMetrics;
  yearOutcomes?: YearOutcome[];
  diagnostics?: {
    rHatMax?: number;
    essMin?: number;
  };
  moduleOutputs?: {
    propertyCatPricing?: PropertyCatPricingYltOutput;
    propertyCatPricingYlt?: PropertyCatPricingYltOutput;
    pricingYlt?: PropertyCatPricingYltOutput;
    ilsParametricTrigger?: IlsParametricTriggerSimulatorOutput;
    ilsParametricTriggerSimulator?: IlsParametricTriggerSimulatorOutput;
    parametricTriggerSimulation?: IlsParametricTriggerSimulatorOutput;
    marginalPortfolioImpact?: MarginalPortfolioImpactOutput;
    [key: string]: unknown;
  };
  propertyCatPricing?: PropertyCatPricingYltOutput;
  propertyCatPricingYlt?: PropertyCatPricingYltOutput;
  pricingYlt?: PropertyCatPricingYltOutput;
  ilsParametricTrigger?: IlsParametricTriggerSimulatorOutput;
  ilsParametricTriggerSimulator?: IlsParametricTriggerSimulatorOutput;
  parametricTriggerSimulation?: IlsParametricTriggerSimulatorOutput;
  marginalPortfolioImpact?: MarginalPortfolioImpactOutput;
  artifacts?: {
    summaryUri?: string;
    rawSamplesUri?: string;
    traceUri?: string;
  };
}

export interface MarginalPortfolioImpactTailRiskRow {
  returnPeriodYears: number;
  metric?: string;
  before?: number;
  after?: number;
  delta?: number;
  deltaPct?: number;
}

export interface RainierCalibrationDiagnostics {
  rHatMax?: number;
  essMin?: number;
}

export interface MarginalPortfolioImpactRainierCalibration {
  status?: string;
  engineProfile?: string;
  message?: string;
  posteriorMeanRate?: number;
  posteriorMedianRate?: number;
  posteriorP05Rate?: number;
  posteriorP95Rate?: number;
  posteriorStdDevRate?: number;
  posteriorSampleCount?: number;
  deterministicBaseRate?: number;
  scaleFactor?: number;
  observedRateCount?: number;
  mapRate?: number;
  diagnostics?: RainierCalibrationDiagnostics;
}

export interface MarginalPortfolioImpactOutput {
  currency?: string;
  tailMetric?: string;
  tailRiskComparison?: MarginalPortfolioImpactTailRiskRow[];
  beforeAfterTailRisk?: MarginalPortfolioImpactTailRiskRow[];
  comparisonRows?: MarginalPortfolioImpactTailRiskRow[];
  rainierCalibration?: MarginalPortfolioImpactRainierCalibration;
  [key: string]: unknown;
}

export interface BandPoint {
  returnPeriodYears?: number;
  mean?: number;
  p05?: number;
  p95?: number;
}

export interface PropertyCatPricingYltOutput {
  currency?: string;
  yltRows?: unknown[];
  yearLossTable?: unknown[];
  rows?: unknown[];
  ylt?: unknown[];
  // Phase 3: technical-premium surface (present when a layer tower is
  // configured on the run).
  layerPremiums?: Array<{
    layerName?: string;
    pureLoss?: number;
    stdDevLoss?: number;
    riskLoadedPremium?: number;
    brokerage?: number;
    profitCommission?: number;
    grossTechnicalPremium?: number;
    rateOnLine?: number;
  }>;
  tvarByReturnPeriod?: Array<{
    returnPeriodYears?: number;
    tvar?: number;
  }>;
  // Phase 4: per-quantile posterior credible bands on OEP/AEP.
  // source = "bootstrap+rainier" when Rainier converged, else "bootstrap".
  oepBands?: {
    source?: string;
    bootstrapSamples?: number;
    gross?: BandPoint[];
    net?: BandPoint[];
  };
  aepBands?: {
    source?: string;
    bootstrapSamples?: number;
    gross?: BandPoint[];
    net?: BandPoint[];
  };
  layerAttachmentFrequency?: number;
  layerExhaustionFrequency?: number;
  enrichmentLog?: Array<{
    locationId?: string;
    field?: string;
    assumedValue?: string;
    reason?: string;
  }>;
  [key: string]: unknown;
}

export interface IlsParametricTriggerSimulatorOutput {
  currency?: string;
  rows?: unknown[];
  scenarios?: unknown[];
  simulatedEvents?: unknown[];
  eventScenarios?: unknown[];
  triggerSimulation?: unknown[];
  [key: string]: unknown;
}
