export interface TailRiskComparisonDisplayRow {
  returnPeriodYears: number;
  metric: string;
  before?: number;
  after?: number;
  delta?: number;
  deltaPct?: number;
}

export interface TailRiskComparisonDisplay {
  currency?: string;
  rows: TailRiskComparisonDisplayRow[];
}

export interface MpiRainierCalibrationDisplay {
  status: string;
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
  rHatMax?: number;
  essMin?: number;
}

export interface PricingYltDisplayRow {
  yearIndex: number;
  eventCount?: number;
  grossLoss?: number;
  cededLoss?: number;
  netLoss?: number;
  payout?: number;
  triggered?: boolean;
}

export interface PricingYltDisplay {
  currency?: string;
  rowLimit?: number;
  rows: PricingYltDisplayRow[];
  simulatedYears?: number;
  p50Loss?: number;
  p90Loss?: number;
  p99Loss?: number;
  maxLoss?: number;
}

export interface IlsTriggerSimulationDisplayRow {
  scenario: string;
  eventId?: string;
  peril?: string;
  region?: string;
  triggerIndexValue?: number;
  threshold?: number;
  payoutPct?: number;
  payoutAmount?: number;
  triggered?: boolean;
  exhausted?: boolean;
}

export interface IlsTriggerSimulationDisplay {
  currency?: string;
  rows: IlsTriggerSimulationDisplayRow[];
  triggerProbability?: number;
  exhaustionProbability?: number;
  expectedPayout?: number;
  attachmentThreshold?: number;
  exhaustionThreshold?: number;
  simulationCount?: number;
}
