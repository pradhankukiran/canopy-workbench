import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join as joinPath, resolve as resolvePath } from "node:path";

import { Worker } from "bullmq";
import IORedis from "ioredis";

import {
  DEFAULT_REDIS_PREFIX,
  DEFAULT_RUN_QUEUE_NAME,
  type RunResultRecord,
  type UploadRecord,
  RedisWorkerStateStore
} from "./state";

interface RunJobPayload {
  jobId: string;
  runId: string;
  workspaceId: string;
  uploadId?: string;
  input: Record<string, unknown>;
}

interface RunUploadBinding {
  uploadId?: unknown;
  role?: unknown;
  filename?: unknown;
}

interface ResolvedRunUpload {
  uploadId: string;
  role?: string;
  filename?: string;
  contentType?: string;
  bytes?: number;
  storagePath: string;
}

interface WorkerConfig {
  port: number;
  redisUrl: string;
  redisPrefix: string;
  runQueueName: string;
  concurrency: number;
  stepDelayMs: number;
  databaseUrl?: string;
  propertyPricingScalaCliCommand: string;
  propertyPricingScalaCliTimeoutMs: number;
  propertyPricingScalaCliCwd: string;
  ilsScalaCliCommand: string;
  ilsScalaCliTimeoutMs: number;
  ilsScalaCliCwd: string;
  mpiScalaCliCommand: string;
  mpiScalaCliTimeoutMs: number;
  mpiScalaCliCwd: string;
}

const DEFAULT_REPO_ROOT = resolvePath(__dirname, "../../..");
const DEFAULT_PROPERTY_PRICING_SCALA_CLI_COMMAND =
  'sbt -batch -error "canopy-engine-property/runMain canopy.engine.property.Hurdat2PropertyCatPricingYltCli --input {input}"';
const DEFAULT_ILS_SCALA_CLI_COMMAND =
  'sbt -batch -error "canopy-engine-trigger/runMain canopy.engine.trigger.Hurdat2IlsTriggerCli --input {input}"';
const DEFAULT_MPI_SCALA_CLI_COMMAND =
  'sbt -batch -error "canopy-engine-portfolio/runMain canopy.engine.portfolio.MarginalPortfolioImpactCli --input {input}"';

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readStringEnv(name: string, fallback: string): string {
  const raw = process.env[name];
  if (typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function readConfig(): WorkerConfig {
  return {
    port: readIntEnv("WORKER_PORT", 4001),
    redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
    redisPrefix: process.env.CANOPY_REDIS_PREFIX ?? DEFAULT_REDIS_PREFIX,
    runQueueName: process.env.CANOPY_RUN_QUEUE ?? DEFAULT_RUN_QUEUE_NAME,
    concurrency: Math.max(1, readIntEnv("WORKER_CONCURRENCY", 2)),
    stepDelayMs: Math.max(50, readIntEnv("WORKER_STEP_DELAY_MS", 350)),
    databaseUrl: process.env.DATABASE_URL,
    propertyPricingScalaCliCommand: readStringEnv(
      "WORKER_PROPERTY_PRICING_SCALA_CLI_COMMAND",
      DEFAULT_PROPERTY_PRICING_SCALA_CLI_COMMAND
    ),
    propertyPricingScalaCliTimeoutMs: Math.max(
      1_000,
      readIntEnv("WORKER_PROPERTY_PRICING_SCALA_CLI_TIMEOUT_MS", 120_000)
    ),
    propertyPricingScalaCliCwd: readStringEnv("WORKER_PROPERTY_PRICING_SCALA_CLI_CWD", DEFAULT_REPO_ROOT),
    ilsScalaCliCommand: readStringEnv("WORKER_ILS_SCALA_CLI_COMMAND", DEFAULT_ILS_SCALA_CLI_COMMAND),
    ilsScalaCliTimeoutMs: Math.max(1_000, readIntEnv("WORKER_ILS_SCALA_CLI_TIMEOUT_MS", 120_000)),
    ilsScalaCliCwd: readStringEnv("WORKER_ILS_SCALA_CLI_CWD", DEFAULT_REPO_ROOT),
    mpiScalaCliCommand: readStringEnv("WORKER_MPI_SCALA_CLI_COMMAND", DEFAULT_MPI_SCALA_CLI_COMMAND),
    mpiScalaCliTimeoutMs: Math.max(1_000, readIntEnv("WORKER_MPI_SCALA_CLI_TIMEOUT_MS", 120_000)),
    mpiScalaCliCwd: readStringEnv("WORKER_MPI_SCALA_CLI_CWD", DEFAULT_REPO_ROOT)
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type AnalysisType = "pricing" | "risk" | "sensitivity";
type EngineProfile = "fast" | "standard" | "full";
type RiskMetricsRecord = RunResultRecord["riskMetrics"];
type YearOutcomesRecord = RunResultRecord["yearOutcomes"];

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
  return items.length > 0 ? items : undefined;
}

function asNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter(
    (item): item is number => typeof item === "number" && Number.isFinite(item)
  );
  return items.length > 0 ? items : undefined;
}

function deepCloneRecord<T extends Record<string, unknown>>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeUploadRole(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "auto") return undefined;
  switch (normalized) {
    case "hurdat2":
    case "track":
    case "tracks":
      return "hurdat2";
    case "propertyportfolio":
    case "property_portfolio":
    case "property-portfolio":
      return "propertyPortfolio";
    case "baselineportfolio":
    case "baseline_portfolio":
    case "baseline-portfolio":
    case "portfolio":
      return "baselinePortfolio";
    case "candidatedeal":
    case "candidate_deal":
    case "candidate-deal":
      return "candidateDeal";
    case "catbondterms":
    case "cat_bond_terms":
    case "cat-bond-terms":
    case "bondterms":
    case "bond_terms":
    case "bond-terms":
      return "catBondTerms";
    default:
      return normalized;
  }
}

function inferUploadRoleFromFilename(filename: string | undefined): string | undefined {
  const lower = filename?.trim().toLowerCase();
  if (!lower) return undefined;
  if (lower.endsWith(".hurdat2") || lower.includes("hurdat2")) return "hurdat2";
  if (!lower.endsWith(".json")) return undefined;
  if (lower.includes("candidate")) return "candidateDeal";
  if (lower.includes("bond") || lower.includes("catbond") || lower.includes("cat_bond")) {
    return "catBondTerms";
  }
  if (lower.includes("property") && lower.includes("portfolio")) return "propertyPortfolio";
  if (lower.includes("portfolio")) return "baselinePortfolio";
  return undefined;
}

function collectRunUploadBindings(input: Record<string, unknown>, legacyUploadId?: string): RunUploadBinding[] {
  const bindings: RunUploadBinding[] = [];
  const rawUploads = Array.isArray(input.uploads) ? input.uploads : [];
  for (const raw of rawUploads) {
    const record = asRecord(raw);
    if (!record) continue;
    bindings.push(record);
  }

  const legacyFromInput = asString(input.uploadId);
  if (legacyUploadId || legacyFromInput) {
    bindings.push({ uploadId: legacyUploadId ?? legacyFromInput });
  }

  return bindings;
}

function ensureObjectPath(root: Record<string, unknown>, path: string[]): Record<string, unknown> {
  let cursor: Record<string, unknown> = root;
  for (const segment of path) {
    const next = asRecord(cursor[segment]);
    if (next) {
      cursor = next;
      continue;
    }
    const created: Record<string, unknown> = {};
    cursor[segment] = created;
    cursor = created;
  }
  return cursor;
}

function firstModuleParamsObject(
  input: Record<string, unknown>,
  keys: string[]
): Record<string, unknown> {
  const moduleParameters = ensureObjectPath(input, ["moduleParameters"]);
  for (const key of keys) {
    const candidate = asRecord(moduleParameters[key]);
    if (candidate) return candidate;
  }
  const created: Record<string, unknown> = {};
  moduleParameters[keys[0] ?? "module"] = created;
  return created;
}

function isPathSet(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isLikelyPropertyPortfolioJson(value: unknown): value is Record<string, unknown> {
  const root = asRecord(value);
  if (!root) return false;
  if (Array.isArray(root.locations)) return true;
  const propertyPortfolio = asRecord(root.propertyPortfolio);
  if (propertyPortfolio && Array.isArray(propertyPortfolio.locations)) return true;
  const portfolio = asRecord(root.portfolio);
  const nestedPropertyPortfolio = asRecord(portfolio?.propertyPortfolio);
  return Boolean(nestedPropertyPortfolio && Array.isArray(nestedPropertyPortfolio.locations));
}

function extractPropertyPortfolioObject(value: unknown): Record<string, unknown> | undefined {
  const root = asRecord(value);
  if (!root) return undefined;
  if (Array.isArray(root.locations)) return root;
  const propertyPortfolio = asRecord(root.propertyPortfolio);
  if (propertyPortfolio && Array.isArray(propertyPortfolio.locations)) return propertyPortfolio;
  const portfolio = asRecord(root.portfolio);
  const nestedPropertyPortfolio = asRecord(portfolio?.propertyPortfolio);
  if (nestedPropertyPortfolio && Array.isArray(nestedPropertyPortfolio.locations)) return nestedPropertyPortfolio;
  return undefined;
}

function extractCandidateDealObject(value: unknown): Record<string, unknown> | undefined {
  const root = asRecord(value);
  if (!root) return undefined;
  const nestedCandidateDeal = asRecord(root.candidateDeal);
  if (nestedCandidateDeal) return nestedCandidateDeal;
  return root;
}

function extractCatBondTermsObject(value: unknown): Record<string, unknown> | undefined {
  const root = asRecord(value);
  if (!root) return undefined;
  const nestedTerms = asRecord(root.catBondTerms);
  if (nestedTerms) return nestedTerms;
  const candidateDeal = asRecord(root.candidateDeal);
  const candidateTerms = asRecord(candidateDeal?.catBondTerms);
  if (candidateTerms) return candidateTerms;
  return root;
}

async function readJsonObjectFile(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text) as unknown;
    return asRecord(parsed);
  } catch {
    return undefined;
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function roundInt(value: number): number {
  return Math.round(value);
}

function roundRatio(value: number): number {
  return Number(clamp01(value).toFixed(4));
}

function roundTo(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

function stableHash(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function coerceEngineProfile(value: unknown): EngineProfile {
  return value === "fast" || value === "standard" || value === "full" ? value : "standard";
}

function coerceAnalysisType(params: {
  raw: unknown;
  moduleParameters?: Record<string, unknown>;
}): AnalysisType {
  if (params.raw === "pricing" || params.raw === "risk" || params.raw === "sensitivity") {
    return params.raw;
  }

  if (params.moduleParameters) {
    if (asRecord(params.moduleParameters.marginalPortfolioImpact)) return "risk";
    if (asRecord(params.moduleParameters.ilsParametricTrigger)) return "sensitivity";
    if (asRecord(params.moduleParameters.ilsParametricTriggerSimulator)) return "sensitivity";
    if (asRecord(params.moduleParameters.propertyCatPricing)) return "pricing";
    if (asRecord(params.moduleParameters.propertyCatPricingYlt)) return "pricing";
  }

  return "pricing";
}

function uniqueSortedPositiveIntegers(values: number[] | undefined, fallback: number[]): number[] {
  const source = values && values.length > 0 ? values : fallback;
  const unique = new Set<number>();
  for (const value of source) {
    if (!Number.isFinite(value)) continue;
    unique.add(Math.max(1, Math.trunc(value)));
  }
  return [...unique].sort((a, b) => a - b);
}

function pickCurrency(params: {
  propertyPortfolio?: Record<string, unknown>;
  catBondTerms?: Record<string, unknown>;
}): string {
  const fromPortfolio = asString(params.propertyPortfolio?.currency);
  if (fromPortfolio) return fromPortfolio.toUpperCase();
  const fromTerms = asString(params.catBondTerms?.currency);
  if (fromTerms) return fromTerms.toUpperCase();
  return "USD";
}

function summarizePropertyPortfolio(
  propertyPortfolio: Record<string, unknown> | undefined
): {
  locationCount: number;
  totalTiv: number;
  sampledPerils: string[];
} {
  const locations = Array.isArray(propertyPortfolio?.locations) ? propertyPortfolio.locations : [];
  let totalTiv = 0;
  const perilSet = new Set<string>();

  for (const location of locations) {
    const row = asRecord(location);
    if (!row) continue;
    const tiv = asNumber(row.tiv);
    if (typeof tiv === "number") totalTiv += tiv;

    const perils = asStringArray(row.perilSet);
    if (!perils) continue;
    for (const peril of perils) {
      perilSet.add(peril);
      if (perilSet.size >= 8) break;
    }
    if (perilSet.size >= 8) break;
  }

  return {
    locationCount: locations.length,
    totalTiv: roundInt(totalTiv),
    sampledPerils: [...perilSet].slice(0, 8)
  };
}

function createYearOutcomes(params: {
  yearCount: number;
  baseGross: number;
  trendPct: number;
  eventBase: number;
  eventSwing: number;
  severitySwingPct: number;
  cededBaseShare: number;
  cededSwingPct: number;
  exhaustionThreshold: number;
  seed: number;
}): YearOutcomesRecord {
  const rows: YearOutcomesRecord = [];
  for (let index = 0; index < params.yearCount; index += 1) {
    const yearIndex = index + 1;
    const cycle = ((params.seed >>> (index % 16)) ^ (index * 37 + (params.seed % 97))) % 13;
    const eventCount = Math.max(
      0,
      roundInt(params.eventBase + (cycle % 5) - 2 + ((index + params.seed) % 3 ? 0 : params.eventSwing))
    );
    const trendFactor = 1 + params.trendPct * index;
    const cycleFactor = 1 + ((cycle - 6) / 12) * params.severitySwingPct;
    const eventFactor = 1 + Math.max(0, eventCount - 1) * 0.07;
    const gross = Math.max(0, roundInt(params.baseGross * trendFactor * cycleFactor * eventFactor));
    const cededShare = clamp01(
      params.cededBaseShare + ((cycle % 7) - 3) * params.cededSwingPct + (eventCount > 2 ? 0.03 : 0)
    );
    const ceded = Math.min(gross, Math.max(0, roundInt(gross * cededShare)));
    const net = Math.max(0, gross - ceded);

    rows.push({
      yearIndex,
      eventCount,
      aggregateGrossLoss: gross,
      aggregateCededLoss: ceded,
      aggregateNetLoss: net,
      bondExhausted: gross >= params.exhaustionThreshold || ceded >= params.exhaustionThreshold * 0.6
    });
  }
  return rows;
}

function createRiskMetrics(params: {
  currency: string;
  expectedLoss: number;
  notional: number;
  stdDevMultiplier: number;
  attachmentProbability: number;
  exhaustionProbability: number;
  varMultiplier: number;
  tvarMultiplier: number;
  returnPeriodsYears?: number[];
  grossCurveMultiplier: number;
  cessionShareBase: number;
  cessionShareSlope: number;
  bondPayoutShareBase: number;
  bondPayoutShareSlope: number;
  seed: number;
}): RiskMetricsRecord {
  const returnPeriodsYears = uniqueSortedPositiveIntegers(params.returnPeriodsYears, [10, 20, 50]);
  const expectedLoss = Math.max(1, roundInt(params.expectedLoss));
  const notional = Math.max(1, roundInt(params.notional));
  const expectedLossRate = roundTo(expectedLoss / notional, 4);
  const stdDevLoss = Math.max(expectedLoss, roundInt(expectedLoss * params.stdDevMultiplier));
  const var99 = Math.max(expectedLoss, roundInt(expectedLoss * params.varMultiplier));
  const tvar99 = Math.max(var99 + 1, roundInt(var99 * params.tvarMultiplier));

  const makeCurve = (curveType: "oep" | "aep") =>
    returnPeriodsYears.map((returnPeriodYears, index) => {
      const logFactor = Math.log(returnPeriodYears + 1) / Math.log(10);
      const curveBias = curveType === "oep" ? 1 : 0.92;
      const gross = Math.max(
        expectedLoss,
        roundInt(
          expectedLoss *
            params.grossCurveMultiplier *
            curveBias *
            (1 + logFactor * (0.85 + index * 0.08)) *
            (1 + (((params.seed >>> (index % 8)) & 7) - 3) / 100)
        )
      );
      const cessionShare = clamp01(
        params.cessionShareBase + index * params.cessionShareSlope + (curveType === "aep" ? -0.02 : 0)
      );
      const ceded = Math.min(gross, Math.max(0, roundInt(gross * cessionShare)));
      const netLoss = Math.max(0, gross - ceded);
      const bondPayoutShare = Math.min(
        cessionShare,
        clamp01(
          params.bondPayoutShareBase +
            index * params.bondPayoutShareSlope +
            (curveType === "aep" ? -0.02 : 0)
        )
      );
      const bondPayout = Math.min(ceded, Math.max(0, roundInt(gross * bondPayoutShare)));

      return {
        returnPeriodYears,
        grossLoss: gross,
        netLoss,
        bondPayout
      };
    });

  return {
    currency: params.currency,
    expectedLoss,
    expectedLossRate,
    stdDevLoss,
    attachmentProbability: roundRatio(params.attachmentProbability),
    exhaustionProbability: roundRatio(params.exhaustionProbability),
    var99,
    tvar99,
    oep: makeCurve("oep"),
    aep: makeCurve("aep")
  };
}

function createDiagnostics(params: {
  engineProfile: EngineProfile;
  posteriorSampleCount: number;
  seed: number;
}): RunResultRecord["diagnostics"] {
  const rHatBase =
    params.engineProfile === "fast" ? 1.018 : params.engineProfile === "full" ? 1.006 : 1.01;
  return {
    rHatMax: roundTo(rHatBase + (params.seed % 7) * 0.0006, 4),
    essMin: Math.max(
      250,
      roundInt(params.posteriorSampleCount * (params.engineProfile === "fast" ? 0.62 : 0.74) + (params.seed % 91))
    )
  };
}

function createDummyPosteriorBundle(params: {
  runId: string;
  workspaceId: string;
  input: Record<string, unknown>;
}): RunResultRecord {
  const moduleParameters = asRecord(params.input.moduleParameters);
  const pricingInput =
    asRecord(moduleParameters?.propertyCatPricing) ??
    asRecord(moduleParameters?.propertyCatPricingYlt);
  const sensitivityInput =
    asRecord(moduleParameters?.ilsParametricTrigger) ??
    asRecord(moduleParameters?.ilsParametricTriggerSimulator);
  const mpiInput = asRecord(moduleParameters?.marginalPortfolioImpact);
  const analysisType = coerceAnalysisType({
    raw: params.input.analysisType,
    moduleParameters
  });
  const engineProfile = coerceEngineProfile(params.input.engineProfile);
  const engineFactor = engineProfile === "fast" ? 0.94 : engineProfile === "full" ? 1.08 : 1;
  const randomSeed = Math.max(0, Math.trunc(asNumber(params.input.randomSeed) ?? 0));
  const signature = stableHash(
    [params.runId, params.workspaceId, safeJson(params.input), String(randomSeed)].join("|")
  );
  const seedUnit = (signature % 1000) / 1000;
  const seedTilt = ((signature % 17) - 8) / 100;

  const candidateDeal = asRecord(params.input.candidateDeal);
  const catBondTerms = asRecord(candidateDeal?.catBondTerms);
  const portfolio = asRecord(candidateDeal?.portfolio);
  const propertyPortfolio = asRecord(portfolio?.propertyPortfolio);
  const propertySummary = summarizePropertyPortfolio(propertyPortfolio);

  const catBondPerils =
    asStringArray(catBondTerms?.perils) ??
    (propertySummary.sampledPerils.length > 0 ? propertySummary.sampledPerils : ["wind", "quake"]);
  const catBondRegions = asStringArray(catBondTerms?.regions) ?? ["US-GULF"];
  const currency = pickCurrency({ propertyPortfolio, catBondTerms });
  const candidateDealId = asString(params.input.candidateDealId) ?? asString(candidateDeal?.candidateDealId) ?? "deal_demo001";
  const dealName = asString(candidateDeal?.name) ?? candidateDealId;
  const triggerType =
    asString(catBondTerms?.triggerType) ??
    (analysisType === "sensitivity" ? "parametric" : "indemnity");
  const modeledShare = clamp01(asNumber(catBondTerms?.modeledShare) ?? (analysisType === "sensitivity" ? 0.78 : 0.86));

  const fallbackNotional = roundInt((12_000_000 + (signature % 9) * 1_750_000) * engineFactor);
  const notional = Math.max(500_000, roundInt(asNumber(catBondTerms?.notional) ?? fallbackNotional));
  const attachmentPoint = Math.max(
    0,
    roundInt(asNumber(catBondTerms?.attachmentPoint) ?? notional * (0.85 + (signature % 5) * 0.03))
  );
  const exhaustionPoint = Math.max(
    attachmentPoint + 100_000,
    roundInt(asNumber(catBondTerms?.exhaustionPoint) ?? attachmentPoint + notional)
  );
  const expectedLossBpsInput = asNumber(catBondTerms?.expectedLossBps);
  const couponSpreadBpsInput = asNumber(catBondTerms?.couponSpreadBps);

  let posteriorSampleCount = 1000;
  let riskMetrics: RunResultRecord["riskMetrics"];
  let yearOutcomes: RunResultRecord["yearOutcomes"];
  let moduleOutputs: Record<string, unknown> | undefined;

  if (analysisType === "pricing") {
    const simulatedYears = Math.max(
      100,
      Math.trunc(asNumber(pricingInput?.simulatedYears) ?? asNumber(pricingInput?.sampleYearCount) ?? 10_000)
    );
    const yltRowLimit = Math.max(1, Math.trunc(asNumber(pricingInput?.yltRowLimit) ?? 25));
    const pricingReturnPeriods = uniqueSortedPositiveIntegers(
      asNumberArray(pricingInput?.returnPeriodsYears),
      [10, 20, 50, 100]
    );
    const lossBasis = asString(pricingInput?.lossBasis) ?? "net";
    const includeGrossNetBreakout = asBoolean(pricingInput?.includeGrossNetBreakout) ?? true;
    const includeSummaryPercentiles = asBoolean(pricingInput?.includeSummaryPercentiles) ?? true;

    const perilFactor = catBondPerils.length * 0.015;
    const regionFactor = catBondRegions.length * 0.012;
    const baseElBps = expectedLossBpsInput ?? (260 + (signature % 90) + catBondPerils.length * 12);
    const adjustedElBps = Math.max(
      40,
      roundInt(baseElBps * (0.96 + perilFactor + regionFactor) * (1 + seedTilt * 0.6))
    );
    const expectedLoss = Math.max(10_000, roundInt((notional * adjustedElBps) / 10_000));
    const couponSpreadBps = Math.max(
      adjustedElBps + 40,
      roundInt(couponSpreadBpsInput ?? adjustedElBps * (1.55 + modeledShare * 0.18) + 70 + (signature % 35))
    );
    const riskLoadBps = Math.max(25, couponSpreadBps - adjustedElBps);
    const technicalPremium = roundInt((notional * couponSpreadBps) / 10_000);
    const expectedMargin = Math.max(0, technicalPremium - expectedLoss);

    yearOutcomes = createYearOutcomes({
      yearCount: 10,
      baseGross: expectedLoss * (1.45 + catBondPerils.length * 0.05),
      trendPct: 0.055 + (engineProfile === "full" ? 0.004 : 0),
      eventBase: 1 + Math.min(2, catBondPerils.length - 1),
      eventSwing: 1,
      severitySwingPct: 0.22 + seedUnit * 0.05,
      cededBaseShare: lossBasis === "gross" ? 0.18 : 0.28 + modeledShare * 0.16,
      cededSwingPct: 0.018,
      exhaustionThreshold: Math.max(notional, exhaustionPoint * 0.55),
      seed: signature
    });

    const attachmentProbability = 0.14 + perilFactor + regionFactor + seedUnit * 0.04;
    const exhaustionProbability = 0.02 + attachmentProbability * (0.12 + modeledShare * 0.08);
    riskMetrics = createRiskMetrics({
      currency,
      expectedLoss,
      notional,
      stdDevMultiplier: 0.52 + modeledShare * 0.12,
      attachmentProbability,
      exhaustionProbability,
      varMultiplier: 2.45 + seedUnit * 0.25,
      tvarMultiplier: 1.19 + modeledShare * 0.03,
      returnPeriodsYears: pricingReturnPeriods.slice(0, 4),
      grossCurveMultiplier: 2.15 + catBondPerils.length * 0.06,
      cessionShareBase: 0.18 + modeledShare * 0.16,
      cessionShareSlope: 0.022,
      bondPayoutShareBase: 0.1 + modeledShare * 0.18,
      bondPayoutShareSlope: 0.018,
      seed: signature
    });

    posteriorSampleCount = Math.max(
      1_000,
      Math.min(50_000, roundInt(simulatedYears * (engineProfile === "fast" ? 0.6 : engineProfile === "full" ? 1.2 : 0.9)))
    );

    const yltRows = yearOutcomes.slice(0, Math.min(yearOutcomes.length, yltRowLimit)).map((row) => ({
      yearIndex: row.yearIndex,
      eventCount: row.eventCount,
      aggregateGrossLoss: row.aggregateGrossLoss,
      aggregateCededLoss: row.aggregateCededLoss,
      aggregateNetLoss: row.aggregateNetLoss,
      bondPayout: roundInt(row.aggregateCededLoss * (0.6 + modeledShare * 0.2)),
      attachmentReached: row.aggregateGrossLoss >= attachmentPoint
    }));

    const sortedNetLosses = [...yearOutcomes]
      .map((row) => row.aggregateNetLoss)
      .sort((a, b) => a - b);
    const pickPercentile = (pct: number) =>
      sortedNetLosses[Math.min(sortedNetLosses.length - 1, Math.max(0, Math.floor((pct / 100) * sortedNetLosses.length)))];

    const p50Loss = pickPercentile(50);
    const p90Loss = pickPercentile(90);
    const p99Loss = Math.max(p90Loss, roundInt((yearOutcomes[yearOutcomes.length - 1]?.aggregateNetLoss ?? p90Loss) * 1.08));
    const maxLoss = Math.max(...sortedNetLosses);

    const rateAdequacyCurve = [-0.2, -0.1, 0, 0.1, 0.2].map((shift) => {
      const scenarioCouponBps = Math.max(1, roundInt(couponSpreadBps * (1 + shift)));
      const scenarioPremium = roundInt((notional * scenarioCouponBps) / 10_000);
      const margin = scenarioPremium - expectedLoss;
      return {
        scenario: shift === 0 ? "base" : shift < 0 ? `-${Math.abs(Math.round(shift * 100))}%` : `+${Math.round(shift * 100)}%`,
        couponSpreadBps: scenarioCouponBps,
        premium: scenarioPremium,
        expectedMargin: margin,
        marginPct: roundTo(scenarioPremium > 0 ? margin / scenarioPremium : 0, 4)
      };
    });

    moduleOutputs = {
      propertyCatPricing: {
        currency,
        simulatedYears,
        yltRowLimit,
        rowLimit: yltRowLimit,
        lossBasis,
        includeGrossNetBreakout,
        includeSummaryPercentiles,
        dealTerms: {
          candidateDealId,
          dealName,
          triggerType,
          notional,
          attachmentPoint,
          exhaustionPoint,
          modeledShare: roundTo(modeledShare, 4)
        },
        portfolioSummary: {
          locationCount: propertySummary.locationCount || 125 + (signature % 40),
          totalInsuredValue:
            propertySummary.totalTiv > 0 ? propertySummary.totalTiv : roundInt(notional * (22 + (signature % 8))),
          perils: catBondPerils,
          regions: catBondRegions
        },
        pricingSummary: {
          modeledExpectedLoss: expectedLoss,
          modeledExpectedLossBps: adjustedElBps,
          couponSpreadBps,
          technicalPremium,
          riskLoadBps,
          expectedMargin,
          expectedMarginPct: roundTo(technicalPremium > 0 ? expectedMargin / technicalPremium : 0, 4),
          attachmentProbability: riskMetrics.attachmentProbability,
          exhaustionProbability: riskMetrics.exhaustionProbability
        },
        summary: {
          currency,
          simulatedYears,
          p50Loss,
          p90Loss,
          p99Loss,
          maxLoss,
          percentiles: includeSummaryPercentiles
            ? { p50: p50Loss, p90: p90Loss, p99: p99Loss }
            : undefined
        },
        yearLossTable: {
          rowLimit: yltRowLimit,
          rows: yltRows,
          summary: {
            currency,
            simulatedYears,
            p50Loss,
            p90Loss,
            p99Loss,
            maxLoss
          }
        },
        yltRows,
        rateAdequacyCurve,
        returnPeriodPricing: riskMetrics.oep.map((point) => ({
          returnPeriodYears: point.returnPeriodYears,
          grossLoss: point.grossLoss,
          netLoss: point.netLoss,
          bondPayout: point.bondPayout,
          indicatedSpreadBps: roundInt(adjustedElBps + (point.returnPeriodYears / 10) * (6 + seedUnit * 2))
        }))
      }
    };
  } else if (analysisType === "sensitivity") {
    const triggerIndexName = asString(sensitivityInput?.triggerIndexName) ?? "NOAA_WIND_INDEX";
    const regionCode = asString(sensitivityInput?.regionCode) ?? catBondRegions[0] ?? "US-GULF";
    const perilCode = asString(sensitivityInput?.perilCode) ?? catBondPerils[0] ?? "wind";
    const attachmentThreshold = asNumber(sensitivityInput?.attachmentThreshold) ?? 65;
    const exhaustionThreshold = Math.max(
      attachmentThreshold + 5,
      asNumber(sensitivityInput?.exhaustionThreshold) ?? 110
    );
    const payoutCurve = asString(sensitivityInput?.payoutCurve) ?? "linear";
    const simulationCount = Math.max(100, Math.trunc(asNumber(sensitivityInput?.simulationCount) ?? 2500));
    const includeEventLevelOutcomes = asBoolean(sensitivityInput?.includeEventLevelOutcomes) ?? true;

    const gap = Math.max(1, exhaustionThreshold - attachmentThreshold);
    const easierTriggerFactor = clamp01((95 - attachmentThreshold) / 60);
    const gapFactor = clamp01((55 - Math.min(gap, 55)) / 55);
    const payoutCurveFactor =
      payoutCurve === "binary" ? 1.12 : payoutCurve === "step" ? 1.06 : payoutCurve === "linear" ? 1 : 1.03;
    const expectedLossRate = clamp01(0.012 + easierTriggerFactor * 0.025 + gapFactor * 0.012 + seedUnit * 0.005);
    const expectedLoss = Math.max(
      5_000,
      roundInt(notional * expectedLossRate * (triggerType === "parametric" ? 0.98 : 1.07) * payoutCurveFactor)
    );
    const expectedPayout = roundInt(expectedLoss * (0.88 + modeledShare * 0.1));

    yearOutcomes = createYearOutcomes({
      yearCount: 12,
      baseGross: expectedLoss * (1.6 + easierTriggerFactor * 0.25),
      trendPct: 0.045,
      eventBase: 1.4,
      eventSwing: 1.2,
      severitySwingPct: 0.26 + seedUnit * 0.06,
      cededBaseShare: 0.32 + easierTriggerFactor * 0.15,
      cededSwingPct: 0.024,
      exhaustionThreshold: Math.max(notional * 0.45, expectedLoss * 4.5),
      seed: signature ^ 0x9e3779b9
    });

    const triggerProbability = 0.18 + easierTriggerFactor * 0.26 + seedUnit * 0.03;
    const exhaustionProbability = 0.03 + clamp01(triggerProbability * (0.12 + gapFactor * 0.2));
    riskMetrics = createRiskMetrics({
      currency,
      expectedLoss,
      notional,
      stdDevMultiplier: 0.64 + gapFactor * 0.18,
      attachmentProbability: triggerProbability,
      exhaustionProbability,
      varMultiplier: 2.6 + easierTriggerFactor * 0.25,
      tvarMultiplier: 1.21 + gapFactor * 0.05,
      returnPeriodsYears: [10, 20, 50, 100],
      grossCurveMultiplier: 2.05 + easierTriggerFactor * 0.15,
      cessionShareBase: 0.24 + easierTriggerFactor * 0.18,
      cessionShareSlope: 0.028,
      bondPayoutShareBase: 0.18 + easierTriggerFactor * 0.24,
      bondPayoutShareSlope: 0.03,
      seed: signature ^ 0x85ebca6b
    });

    posteriorSampleCount = Math.max(
      1_000,
      roundInt(simulationCount * (engineProfile === "fast" ? 0.7 : engineProfile === "full" ? 1.35 : 1))
    );

    const scenarioOffsets = [-10, -5, 0, 5, 10];
    const scenarioRows = scenarioOffsets.map((offset) => {
      const threshold = roundTo(attachmentThreshold + offset, 2);
      const scenarioEase = clamp01((95 - threshold) / 60);
      const payoutPct = roundRatio(
        0.18 + scenarioEase * 0.62 + (payoutCurve === "binary" ? 0.08 : 0) - (gap > 40 ? 0.04 : 0)
      );
      const payoutAmount = roundInt(notional * payoutPct);
      return {
        scenario: offset === 0 ? "baseline" : `${offset > 0 ? "+" : ""}${offset} attachment`,
        triggerIndexValue: roundTo(attachmentThreshold + gap * (0.45 + scenarioEase * 0.25), 2),
        threshold,
        payoutPct,
        payoutAmount,
        triggered: payoutPct > 0,
        exhausted: payoutPct >= 1,
        peril: perilCode,
        region: regionCode
      };
    });

    const triggerResponseCurve = Array.from({ length: 7 }, (_, index) => {
      const intensity = roundTo(attachmentThreshold - 10 + index * (gap + 20) / 6, 2);
      const rawPayout = (intensity - attachmentThreshold) / gap;
      const payoutPct =
        payoutCurve === "binary"
          ? rawPayout > 0 ? 1 : 0
          : payoutCurve === "step"
            ? rawPayout <= 0
              ? 0
              : rawPayout >= 1
                ? 1
                : rawPayout < 0.5
                  ? 0.5
                  : 0.8
            : clamp01(rawPayout);
      return {
        triggerIndexValue: intensity,
        payoutPct: roundTo(payoutPct, 4),
        payoutAmount: roundInt(notional * payoutPct),
        triggered: payoutPct > 0,
        exhausted: payoutPct >= 1
      };
    });

    const simulatedEvents = includeEventLevelOutcomes
      ? Array.from({ length: Math.min(8, Math.max(4, Math.round(simulationCount / 500))) }, (_, index) => {
          const baseIntensity = attachmentThreshold + ((index * 17 + (signature % 23)) % Math.max(6, Math.round(gap + 18)));
          const rawPayout = (baseIntensity - attachmentThreshold) / gap;
          const payoutPct =
            payoutCurve === "binary"
              ? rawPayout > 0 ? 1 : 0
              : payoutCurve === "step"
                ? rawPayout <= 0
                  ? 0
                  : rawPayout >= 1
                    ? 1
                    : rawPayout < 0.5
                      ? 0.5
                      : 0.8
                : clamp01(rawPayout);
          return {
            scenario: `evt-${index + 1}`,
            eventId: `evt_${params.runId.slice(-6)}_${index + 1}`,
            peril: perilCode,
            region: regionCode,
            triggerIndexValue: roundTo(baseIntensity, 2),
            attachmentThreshold,
            threshold: attachmentThreshold,
            payoutPct: roundTo(payoutPct, 4),
            payoutAmount: roundInt(notional * payoutPct),
            triggered: payoutPct > 0,
            exhausted: payoutPct >= 1
          };
        })
      : undefined;

    moduleOutputs = {
      ilsParametricTrigger: {
        currency,
        triggerIndexName,
        attachmentThreshold: roundTo(attachmentThreshold, 2),
        exhaustionThreshold: roundTo(exhaustionThreshold, 2),
        payoutCurve,
        simulationCount,
        triggerProbability: riskMetrics.attachmentProbability,
        exhaustionProbability: riskMetrics.exhaustionProbability,
        expectedPayout,
        triggerDefinition: {
          triggerType: "parametric",
          triggerIndexName,
          regionCode,
          perilCode,
          attachmentThreshold: roundTo(attachmentThreshold, 2),
          exhaustionThreshold: roundTo(exhaustionThreshold, 2),
          payoutCurve
        },
        summary: {
          currency,
          simulationCount,
          expectedPayout,
          triggerProbability: riskMetrics.attachmentProbability,
          exhaustionProbability: riskMetrics.exhaustionProbability,
          attachmentThreshold: roundTo(attachmentThreshold, 2),
          exhaustionThreshold: roundTo(exhaustionThreshold, 2)
        },
        rows: scenarioRows,
        scenarios: scenarioRows,
        triggerResponseCurve,
        yearTriggerOutcomes: yearOutcomes.map((row) => {
          const triggerIndexValue = roundTo(
            attachmentThreshold + (row.aggregateGrossLoss / Math.max(1, expectedLoss)) * (gap / 3.2),
            2
          );
          const rawPayout = (triggerIndexValue - attachmentThreshold) / gap;
          const payoutPct = payoutCurve === "binary" ? (rawPayout > 0 ? 1 : 0) : clamp01(rawPayout);
          return {
            yearIndex: row.yearIndex,
            eventCount: row.eventCount,
            triggerIndexValue,
            payoutPct: roundTo(payoutPct, 4),
            payoutAmount: roundInt(notional * payoutPct * 0.35),
            triggered: payoutPct > 0,
            exhausted: payoutPct >= 1
          };
        }),
        ...(simulatedEvents ? { simulatedEvents } : {})
      }
    };
  } else {
    const tailCurve =
      asString(mpiInput?.tailCurve) ??
      ((asString(mpiInput?.tailMetric) === "oep" || asString(mpiInput?.tailMetric) === "aep")
        ? (asString(mpiInput?.tailMetric) as "oep" | "aep")
        : "oep");
    const tailMetric =
      asString(mpiInput?.tailMetric) === "tvar" || asString(mpiInput?.tailMetric) === "var"
        ? (asString(mpiInput?.tailMetric) as "var" | "tvar")
        : "var";
    const requestedReturnPeriod =
      Math.max(
        1,
        Math.trunc(
          asNumber(mpiInput?.tailReturnPeriodYears) ??
            uniqueSortedPositiveIntegers(asNumberArray(mpiInput?.returnPeriodsYears), [100])[0] ??
            100
        )
      );
    const returnPeriods = uniqueSortedPositiveIntegers(asNumberArray(mpiInput?.returnPeriodsYears), [10, 20, 50, 100]);
    const candidateParticipationPct = clamp01((asNumber(mpiInput?.candidateParticipationPct) ?? 100) / 100);
    const includeTailRiskComparison = asBoolean(mpiInput?.includeTailRiskComparison) ?? true;
    const candidateDealLimit = Math.max(
      100_000,
      roundInt(asNumber(mpiInput?.candidateDealLimit) ?? asNumber(catBondTerms?.notional) ?? 5_000_000)
    );

    const riskExpectedLossRate = 0.024 + candidateParticipationPct * 0.012 + seedUnit * 0.006;
    const expectedLoss = Math.max(10_000, roundInt(candidateDealLimit * riskExpectedLossRate));
    yearOutcomes = createYearOutcomes({
      yearCount: 8,
      baseGross: expectedLoss * (2.2 + candidateParticipationPct * 0.3),
      trendPct: 0.06,
      eventBase: 1.1,
      eventSwing: 1.3,
      severitySwingPct: 0.2 + seedUnit * 0.05,
      cededBaseShare: 0.18 + candidateParticipationPct * 0.14,
      cededSwingPct: 0.02,
      exhaustionThreshold: Math.max(candidateDealLimit * 0.22, expectedLoss * 4.2),
      seed: signature ^ 0xc2b2ae35
    });

    riskMetrics = createRiskMetrics({
      currency,
      expectedLoss,
      notional: candidateDealLimit,
      stdDevMultiplier: 0.46 + candidateParticipationPct * 0.14,
      attachmentProbability: 0.22 + candidateParticipationPct * 0.08 + seedUnit * 0.03,
      exhaustionProbability: 0.03 + candidateParticipationPct * 0.05 + seedUnit * 0.01,
      varMultiplier: (tailMetric === "tvar" ? 2.7 : 2.45) + (tailCurve === "aep" ? -0.08 : 0.04),
      tvarMultiplier: tailMetric === "tvar" ? 1.24 : 1.18,
      returnPeriodsYears: uniqueSortedPositiveIntegers([...returnPeriods, requestedReturnPeriod], [10, 20, 50, 100]),
      grossCurveMultiplier: tailCurve === "aep" ? 2.05 : 2.2,
      cessionShareBase: 0.2 + candidateParticipationPct * 0.1,
      cessionShareSlope: 0.026,
      bondPayoutShareBase: 0.08 + candidateParticipationPct * 0.1,
      bondPayoutShareSlope: 0.03,
      seed: signature ^ 0x27d4eb2f
    });

    posteriorSampleCount = roundInt(
      (engineProfile === "fast" ? 900 : engineProfile === "full" ? 2200 : 1400) *
        (1 + candidateParticipationPct * 0.2)
    );

    const comparisonRows = uniqueSortedPositiveIntegers([10, 20, requestedReturnPeriod, ...returnPeriods], [10, 20, 50])
      .map((returnPeriodYears, index) => {
        const before = roundInt(
          (430_000 + returnPeriodYears * 7_200) *
            (1 + seedTilt * 0.4) *
            (tailCurve === "aep" ? 0.95 : 1.03)
        );
        const uplift =
          1 +
          (0.018 + candidateParticipationPct * 0.028) *
            (tailMetric === "tvar" ? 1.15 : 1) *
            (1 + index * 0.18);
        const after = roundInt(before * uplift);
        const delta = after - before;
        return {
          returnPeriodYears,
          metric: `${tailCurve.toUpperCase()} ${tailMetric.toUpperCase()}`,
          before,
          after,
          delta,
          deltaPct: roundTo(before > 0 ? delta / before : 0, 4)
        };
      });

    const metricsColumns = [
      { key: "metric", label: "Metric", format: "label" },
      { key: "returnPeriodYears", label: "Return Period", unit: "years", format: "integer" },
      { key: "amount", label: "Amount", unit: currency, format: "currency" },
      { key: "deltaPct", label: "Delta %", unit: "ratio", format: "percent" }
    ];

    const makeTable = (
      tableId: string,
      title: string,
      rows: Array<{
        metric: string;
        returnPeriodYears: number;
        amount: number;
        deltaPct?: number | null;
      }>
    ) => ({
      tableId,
      title,
      columns: metricsColumns,
      rows: rows.map((row) => ({
        metricKey: `${row.metric.toLowerCase().replace(/\s+/g, "_")}_${row.returnPeriodYears}`,
        metricLabel: `${row.metric} ${row.returnPeriodYears}y`,
        values: {
          metric: row.metric,
          returnPeriodYears: row.returnPeriodYears,
          amount: row.amount,
          deltaPct: row.deltaPct ?? null
        }
      }))
    });

    const mpiOutput: Record<string, unknown> = {
      baselinePortfolioId:
        asString(mpiInput?.baselinePortfolioId) ??
        asString(mpiInput?.referencePortfolioId) ??
        asString(portfolio?.portfolioId) ??
        "pf_demo001",
      candidateDealName: asString(mpiInput?.candidateDealName) ?? dealName ?? "Candidate Deal",
      candidateDealLimit,
      candidateParticipationPct: roundTo(candidateParticipationPct * 100, 2),
      tailSelection: {
        curve: tailCurve,
        metric: tailMetric,
        returnPeriodYears: requestedReturnPeriod
      },
      currency,
      tailMetric: `${tailCurve.toUpperCase()} ${tailMetric.toUpperCase()}`,
      includeTailRiskComparisonRequested: includeTailRiskComparison,
      ...(includeTailRiskComparison
        ? {
            comparisonRows,
            tailRiskComparison: comparisonRows,
            beforeAfterTailRisk: comparisonRows,
            beforeMetricsTable: makeTable(
              "mpi-before",
              "Before (Baseline Portfolio)",
              comparisonRows.map((row) => ({
                metric: row.metric,
                returnPeriodYears: row.returnPeriodYears,
                amount: row.before,
                deltaPct: null
              }))
            ),
            afterMetricsTable: makeTable(
              "mpi-after",
              "After (Baseline + Candidate)",
              comparisonRows.map((row) => ({
                metric: row.metric,
                returnPeriodYears: row.returnPeriodYears,
                amount: row.after,
                deltaPct: null
              }))
            ),
            changeMetricsTable: makeTable(
              "mpi-change",
              "Change (After - Before)",
              comparisonRows.map((row) => ({
                metric: row.metric,
                returnPeriodYears: row.returnPeriodYears,
                amount: row.delta,
                deltaPct: row.deltaPct
              }))
            )
          }
        : {})
    };

    moduleOutputs = {
      marginalPortfolioImpact: mpiOutput
    };
  }

  const diagnostics = createDiagnostics({
    engineProfile,
    posteriorSampleCount,
    seed: signature
  });

  return {
    runId: params.runId,
    workspaceId: params.workspaceId,
    generatedAt: new Date().toISOString(),
    modelVersion: `phase1-demo-model@0.2.0-${analysisType}`,
    priorVersion: `phase1-demo-priors@0.2.0-${analysisType}`,
    posteriorSampleCount,
    riskMetrics,
    yearOutcomes,
    diagnostics,
    ...(moduleOutputs ? { moduleOutputs } : {}),
    artifacts: {
      summaryUri: `s3://canopy-phase1/results/${params.runId}/summary.json`,
      traceUri: `s3://canopy-phase1/results/${params.runId}/trace.json`
    }
  };
}

interface IlsScalaCliInvocationParams {
  command: string;
  cwd: string;
  timeoutMs: number;
  runId: string;
  workspaceId: string;
  jobId: string;
  payload: Record<string, unknown>;
}

interface IlsScalaCliExecutionResult {
  stdout: string;
  stderr: string;
  durationMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}

class IlsScalaCliError extends Error {
  constructor(
    message: string,
    readonly meta: Record<string, unknown>
  ) {
    super(message);
    this.name = "IlsScalaCliError";
  }
}

function truncateForLog(value: string, maxChars = 2000): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, Math.max(0, maxChars - 3))}...`;
}

function isSensitivityRunInput(input: Record<string, unknown>): boolean {
  const moduleParameters = asRecord(input.moduleParameters);
  return (
    coerceAnalysisType({
      raw: input.analysisType,
      moduleParameters
    }) === "sensitivity"
  );
}

function isPricingRunInput(input: Record<string, unknown>): boolean {
  const moduleParameters = asRecord(input.moduleParameters);
  return (
    coerceAnalysisType({
      raw: input.analysisType,
      moduleParameters
    }) === "pricing"
  );
}

function isRiskRunInput(input: Record<string, unknown>): boolean {
  const moduleParameters = asRecord(input.moduleParameters);
  return (
    coerceAnalysisType({
      raw: input.analysisType,
      moduleParameters
    }) === "risk"
  );
}

function buildPropertyPricingScalaCliPayload(params: {
  runId: string;
  workspaceId: string;
  input: Record<string, unknown>;
}): Record<string, unknown> {
  const moduleParameters = asRecord(params.input.moduleParameters);
  const pricingInput =
    asRecord(moduleParameters?.propertyCatPricing) ??
    asRecord(moduleParameters?.propertyCatPricingYlt) ??
    asRecord(moduleParameters?.pricingYlt);
  const randomSeed = asNumber(params.input.randomSeed);
  const candidateDealId = asString(params.input.candidateDealId);
  const candidateDeal = asRecord(params.input.candidateDeal);

  return {
    runId: params.runId,
    workspaceId: params.workspaceId,
    analysisType: "pricing",
    engineProfile: coerceEngineProfile(params.input.engineProfile),
    ...(typeof randomSeed === "number" ? { randomSeed: Math.trunc(randomSeed) } : {}),
    ...(candidateDealId ? { candidateDealId } : {}),
    ...(candidateDeal ? { candidateDeal } : {}),
    moduleParameters: {
      propertyCatPricing: pricingInput ?? {}
    },
    input: params.input
  };
}

function buildMpiScalaCliPayload(params: {
  runId: string;
  workspaceId: string;
  input: Record<string, unknown>;
}): Record<string, unknown> {
  const moduleParameters = asRecord(params.input.moduleParameters);
  const mpiInput = asRecord(moduleParameters?.marginalPortfolioImpact);
  const randomSeed = asNumber(params.input.randomSeed);
  const candidateDealId = asString(params.input.candidateDealId);
  const candidateDeal = asRecord(params.input.candidateDeal);

  return {
    runId: params.runId,
    workspaceId: params.workspaceId,
    analysisType: "risk",
    engineProfile: coerceEngineProfile(params.input.engineProfile),
    ...(typeof randomSeed === "number" ? { randomSeed: Math.trunc(randomSeed) } : {}),
    ...(candidateDealId ? { candidateDealId } : {}),
    ...(candidateDeal ? { candidateDeal } : {}),
    moduleParameters: {
      marginalPortfolioImpact: mpiInput ?? {}
    },
    input: params.input
  };
}

function buildIlsScalaCliPayload(params: {
  runId: string;
  workspaceId: string;
  input: Record<string, unknown>;
}): Record<string, unknown> {
  const moduleParameters = asRecord(params.input.moduleParameters);
  const ilsInput =
    asRecord(moduleParameters?.ilsParametricTrigger) ??
    asRecord(moduleParameters?.ilsParametricTriggerSimulator) ??
    asRecord(moduleParameters?.parametricTriggerSimulation);

  const randomSeed = asNumber(params.input.randomSeed);
  const currency = asString(params.input.currency);
  const hurdat2Path = asString(ilsInput?.hurdat2Path);

  return {
    runId: params.runId,
    workspaceId: params.workspaceId,
    analysisType: "sensitivity",
    engineProfile: coerceEngineProfile(params.input.engineProfile),
    ...(typeof randomSeed === "number" ? { randomSeed: Math.trunc(randomSeed) } : {}),
    ...(currency ? { currency } : {}),
    ...(hurdat2Path ? { hurdat2Path } : {}),
    moduleParameters: {
      ilsParametricTrigger: ilsInput ?? {}
    },
    input: params.input
  };
}

function shouldUseIlsScalaCli(input: Record<string, unknown>): boolean {
  const moduleParameters = asRecord(input.moduleParameters);
  const ilsInput =
    asRecord(moduleParameters?.ilsParametricTrigger) ??
    asRecord(moduleParameters?.ilsParametricTriggerSimulator) ??
    asRecord(moduleParameters?.parametricTriggerSimulation);

  const explicit = asBoolean(ilsInput?.useScalaEngine);
  if (typeof explicit === "boolean") return explicit;

  return isSensitivityRunInput(input);
}

function shouldUsePropertyPricingScalaCli(input: Record<string, unknown>): boolean {
  const moduleParameters = asRecord(input.moduleParameters);
  const pricingInput =
    asRecord(moduleParameters?.propertyCatPricing) ??
    asRecord(moduleParameters?.propertyCatPricingYlt) ??
    asRecord(moduleParameters?.pricingYlt);

  const explicit = asBoolean(pricingInput?.useScalaEngine);
  if (typeof explicit === "boolean") return explicit;

  return isPricingRunInput(input);
}

function shouldUseMpiScalaCli(input: Record<string, unknown>): boolean {
  const moduleParameters = asRecord(input.moduleParameters);
  const mpiInput = asRecord(moduleParameters?.marginalPortfolioImpact);

  const explicit = asBoolean(mpiInput?.useScalaEngine);
  if (typeof explicit === "boolean") return explicit;

  return isRiskRunInput(input);
}

function parseTrailingJsonFromStdout(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    throw new Error("Scala CLI returned empty stdout");
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // Fall through and try to parse the last JSON object/array from mixed logs.
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line) continue;
    if (line[0] !== "{" && line[0] !== "[") continue;
    try {
      return JSON.parse(line) as unknown;
    } catch {
      // Continue scanning.
    }
  }

  for (let index = trimmed.length - 1; index >= 0; index -= 1) {
    const ch = trimmed[index];
    if (ch !== "{" && ch !== "[") continue;
    const candidate = trimmed.slice(index).trim();
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Continue scanning.
    }
  }

  throw new Error(`Unable to parse JSON from Scala CLI stdout: ${truncateForLog(trimmed, 400)}`);
}

function normalizeReturnPeriodCurve(
  value: unknown,
  fallback: RunResultRecord["riskMetrics"]["oep"]
): RunResultRecord["riskMetrics"]["oep"] {
  if (!Array.isArray(value)) return fallback;

  const rows = value.flatMap((item) => {
    const row = asRecord(item);
    const returnPeriodYears = Math.max(
      1,
      Math.trunc(
        asNumber(row?.returnPeriodYears) ??
          asNumber(row?.returnPeriod) ??
          asNumber(row?.rpYears) ??
          Number.NaN
      )
    );
    if (!Number.isFinite(returnPeriodYears)) return [];

    return [
      {
        returnPeriodYears,
        grossLoss: Math.max(0, roundInt(asNumber(row?.grossLoss) ?? asNumber(row?.gross) ?? 0)),
        netLoss: Math.max(0, roundInt(asNumber(row?.netLoss) ?? asNumber(row?.net) ?? 0)),
        bondPayout: Math.max(
          0,
          roundInt(
            asNumber(row?.bondPayout) ??
              asNumber(row?.payoutAmount) ??
              asNumber(row?.recoveryAmount) ??
              0
          )
        )
      }
    ];
  });

  return rows.length > 0 ? rows : fallback;
}

function normalizeRiskMetrics(
  value: Record<string, unknown>,
  fallback: RunResultRecord["riskMetrics"]
): RunResultRecord["riskMetrics"] {
  return {
    currency: (asString(value.currency) ?? fallback.currency).toUpperCase(),
    expectedLoss: Math.max(0, roundInt(asNumber(value.expectedLoss) ?? fallback.expectedLoss)),
    expectedLossRate: roundTo(
      Math.max(0, asNumber(value.expectedLossRate) ?? fallback.expectedLossRate),
      4
    ),
    stdDevLoss: Math.max(0, roundInt(asNumber(value.stdDevLoss) ?? fallback.stdDevLoss)),
    attachmentProbability: roundRatio(
      asNumber(value.attachmentProbability) ??
        asNumber(value.triggerProbability) ??
        asNumber(value.annualTriggerProbability) ??
        fallback.attachmentProbability
    ),
    exhaustionProbability: roundRatio(
      asNumber(value.exhaustionProbability) ?? fallback.exhaustionProbability
    ),
    var99: Math.max(0, roundInt(asNumber(value.var99) ?? fallback.var99)),
    tvar99: Math.max(0, roundInt(asNumber(value.tvar99) ?? fallback.tvar99)),
    oep: normalizeReturnPeriodCurve(value.oep, fallback.oep),
    aep: normalizeReturnPeriodCurve(value.aep, fallback.aep)
  };
}

function normalizeYearOutcomes(
  value: unknown,
  fallback: RunResultRecord["yearOutcomes"]
): RunResultRecord["yearOutcomes"] {
  if (!Array.isArray(value)) return fallback;

  const rows = value.flatMap((item, index) => {
    const row = asRecord(item);
    if (!row) return [];
    const yearIndex = Math.max(1, Math.trunc(asNumber(row.yearIndex) ?? index + 1));
    const eventCount = Math.max(0, Math.trunc(asNumber(row.eventCount) ?? 0));
    const aggregateGrossLoss = Math.max(
      0,
      roundInt(asNumber(row.aggregateGrossLoss) ?? asNumber(row.grossLoss) ?? 0)
    );
    const aggregateCededLoss = Math.max(
      0,
      roundInt(
        asNumber(row.aggregateCededLoss) ??
          asNumber(row.bondPayout) ??
          asNumber(row.payoutAmount) ??
          0
      )
    );
    const aggregateNetLoss = Math.max(
      0,
      roundInt(
        asNumber(row.aggregateNetLoss) ??
          asNumber(row.netLoss) ??
          Math.max(0, aggregateGrossLoss - aggregateCededLoss)
      )
    );

    return [
      {
        yearIndex,
        eventCount,
        aggregateGrossLoss,
        aggregateCededLoss,
        aggregateNetLoss,
        bondExhausted:
          asBoolean(row.bondExhausted) ??
          asBoolean(row.exhausted) ??
          asBoolean(row.exhaustionReached) ??
          false
      }
    ];
  });

  return rows.length > 0 ? rows : fallback;
}

function normalizeDiagnostics(
  value: unknown,
  fallback: RunResultRecord["diagnostics"]
): RunResultRecord["diagnostics"] {
  const record = asRecord(value);
  return {
    rHatMax: roundTo(
      Math.max(1, asNumber(record?.rHatMax) ?? asNumber(record?.rhatMax) ?? fallback.rHatMax),
      4
    ),
    essMin: Math.max(1, roundInt(asNumber(record?.essMin) ?? fallback.essMin))
  };
}

function normalizeArtifacts(
  value: unknown,
  fallback: RunResultRecord["artifacts"]
): RunResultRecord["artifacts"] | undefined {
  const record = asRecord(value);
  const summaryUri = asString(record?.summaryUri) ?? fallback?.summaryUri;
  const rawSamplesUri = asString(record?.rawSamplesUri) ?? fallback?.rawSamplesUri;
  const traceUri = asString(record?.traceUri) ?? fallback?.traceUri;

  if (!summaryUri && !rawSamplesUri && !traceUri) {
    return undefined;
  }

  return {
    ...(summaryUri ? { summaryUri } : {}),
    ...(rawSamplesUri ? { rawSamplesUri } : {}),
    ...(traceUri ? { traceUri } : {})
  };
}

function mergeModuleOutputsFromRaw(
  raw: Record<string, unknown>,
  fallback: RunResultRecord["moduleOutputs"]
): RunResultRecord["moduleOutputs"] | undefined {
  const merged: Record<string, unknown> = { ...(fallback ?? {}) };
  const moduleOutputs = asRecord(raw.moduleOutputs);
  if (moduleOutputs) {
    Object.assign(merged, moduleOutputs);
  }

  for (const key of [
    "marginalPortfolioImpact",
    "propertyCatPricing",
    "propertyCatPricingYlt",
    "pricingYlt",
    "ilsParametricTrigger",
    "ilsParametricTriggerSimulator",
    "parametricTriggerSimulation",
    "triggerSimulation",
    "ilsTriggerSimulation"
  ]) {
    if (raw[key] !== undefined) {
      merged[key] = raw[key];
    }
  }

  const canonicalIls =
    asRecord(merged.ilsParametricTrigger) ??
    asRecord(merged.ilsParametricTriggerSimulator) ??
    asRecord(merged.parametricTriggerSimulation) ??
    asRecord(merged.triggerSimulation) ??
    asRecord(merged.ilsTriggerSimulation);
  if (canonicalIls && merged.ilsParametricTrigger === undefined) {
    merged.ilsParametricTrigger = canonicalIls;
  }

  return Object.keys(merged).length > 0 ? (merged as RunResultRecord["moduleOutputs"]) : undefined;
}

function looksLikeIlsTriggerModuleOutput(value: Record<string, unknown>): boolean {
  for (const key of [
    "rows",
    "scenarios",
    "simulatedEvents",
    "eventScenarios",
    "triggerSimulation",
    "triggerResponseCurve",
    "triggerSummaryTable",
    "triggerDefinition"
  ]) {
    if (value[key] !== undefined) return true;
  }

  return (
    value.triggerProbability !== undefined ||
    value.annualTriggerProbability !== undefined ||
    value.attachmentThreshold !== undefined ||
    value.exhaustionThreshold !== undefined
  );
}

function extractCandidateResultRecords(raw: unknown): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  const seen = new Set<Record<string, unknown>>();
  const push = (value: unknown) => {
    const record = asRecord(value);
    if (!record || seen.has(record)) return;
    seen.add(record);
    records.push(record);
  };

  const root = asRecord(raw);
  push(root);
  if (!root) return records;

  for (const key of ["result", "bundle", "posteriorBundle", "output", "data", "payload"]) {
    push(root[key]);
  }

  return records;
}

function mergeBundleLikeScalaResult(params: {
  raw: Record<string, unknown>;
  runId: string;
  workspaceId: string;
}): RunResultRecord | undefined {
  const generatedAt = asString(params.raw.generatedAt);
  const modelVersion = asString(params.raw.modelVersion);
  const priorVersion = asString(params.raw.priorVersion);
  const posteriorSampleCount = asNumber(params.raw.posteriorSampleCount);
  const riskMetricsRaw = asRecord(params.raw.riskMetrics);
  const diagnostics = asRecord(params.raw.diagnostics);
  const yearOutcomes = params.raw.yearOutcomes;
  if (
    !generatedAt ||
    !modelVersion ||
    !priorVersion ||
    typeof posteriorSampleCount !== "number" ||
    !riskMetricsRaw ||
    !Array.isArray(yearOutcomes) ||
    !diagnostics
  ) {
    return undefined;
  }

  if (
    typeof asNumber(riskMetricsRaw.expectedLoss) !== "number" ||
    typeof asNumber(riskMetricsRaw.attachmentProbability) !== "number" ||
    typeof asNumber(riskMetricsRaw.exhaustionProbability) !== "number"
  ) {
    return undefined;
  }

  const moduleOutputs = mergeModuleOutputsFromRaw(params.raw, undefined);
  const artifacts = normalizeArtifacts(params.raw.artifacts, undefined);

  return {
    runId: params.runId,
    workspaceId: params.workspaceId,
    generatedAt,
    modelVersion,
    priorVersion,
    posteriorSampleCount: Math.max(1, Math.trunc(posteriorSampleCount)),
    riskMetrics: normalizeRiskMetrics(riskMetricsRaw as Record<string, unknown>, {
      currency: "USD", expectedLoss: 0, expectedLossRate: 0, stdDevLoss: 0,
      attachmentProbability: 0, exhaustionProbability: 0, var99: 0, tvar99: 0, oep: [], aep: []
    }),
    yearOutcomes: normalizeYearOutcomes(yearOutcomes, []),
    diagnostics: normalizeDiagnostics(diagnostics, { rHatMax: 1, essMin: 1 }),
    ...(moduleOutputs ? { moduleOutputs } : {}),
    ...(artifacts ? { artifacts } : {})
  };
}

function mergeScalaTriggerOutputIntoFallback(params: {
  raw: Record<string, unknown>;
  fallback: RunResultRecord;
  runId: string;
  workspaceId: string;
}): RunResultRecord | undefined {
  const candidates = [
    asRecord(params.raw.ilsParametricTrigger),
    asRecord(params.raw.ilsParametricTriggerSimulator),
    asRecord(params.raw.parametricTriggerSimulation),
    asRecord(params.raw.triggerSimulation),
    asRecord(params.raw.ilsTriggerSimulation),
    looksLikeIlsTriggerModuleOutput(params.raw) ? params.raw : undefined
  ].filter((value): value is Record<string, unknown> => Boolean(value));

  const triggerOutput = candidates[0];
  if (!triggerOutput) return undefined;

  const summary = asRecord(triggerOutput.summary);
  const riskMetrics = { ...params.fallback.riskMetrics };

  const triggerProbability =
    asNumber(triggerOutput.triggerProbability) ??
    asNumber(triggerOutput.annualTriggerProbability) ??
    asNumber(triggerOutput.attachmentProbability) ??
    asNumber(summary?.triggerProbability) ??
    asNumber(summary?.annualTriggerProbability);
  if (typeof triggerProbability === "number") {
    riskMetrics.attachmentProbability = roundRatio(triggerProbability);
  }

  const exhaustionProbability =
    asNumber(triggerOutput.exhaustionProbability) ?? asNumber(summary?.exhaustionProbability);
  if (typeof exhaustionProbability === "number") {
    riskMetrics.exhaustionProbability = roundRatio(exhaustionProbability);
  }

  const expectedPayout =
    asNumber(triggerOutput.expectedPayout) ??
    asNumber(triggerOutput.averagePayout) ??
    asNumber(summary?.expectedPayout) ??
    asNumber(summary?.averagePayout);
  if (typeof expectedPayout === "number") {
    const normalizedExpectedLoss = Math.max(0, roundInt(expectedPayout));
    const inferredNotional =
      params.fallback.riskMetrics.expectedLossRate > 0
        ? params.fallback.riskMetrics.expectedLoss / params.fallback.riskMetrics.expectedLossRate
        : undefined;
    riskMetrics.expectedLoss = normalizedExpectedLoss;
    if (typeof inferredNotional === "number" && inferredNotional > 0) {
      riskMetrics.expectedLossRate = roundTo(normalizedExpectedLoss / inferredNotional, 4);
    }
  }

  const currency = asString(triggerOutput.currency) ?? asString(summary?.currency);
  if (currency) {
    riskMetrics.currency = currency.toUpperCase();
  }

  const simulationCount =
    asNumber(triggerOutput.simulationCount) ??
    asNumber(triggerOutput.simulatedEventCount) ??
    asNumber(triggerOutput.scenarioCount) ??
    asNumber(summary?.simulationCount) ??
    (Array.isArray(triggerOutput.rows) ? triggerOutput.rows.length : undefined) ??
    (Array.isArray(triggerOutput.scenarios) ? triggerOutput.scenarios.length : undefined);

  const moduleOutputs: Record<string, unknown> = {
    ...(params.fallback.moduleOutputs ?? {}),
    ilsParametricTrigger: triggerOutput
  };

  return {
    ...params.fallback,
    runId: params.runId,
    workspaceId: params.workspaceId,
    generatedAt: new Date().toISOString(),
    modelVersion: `${params.fallback.modelVersion}+scala-ils-cli`,
    posteriorSampleCount:
      typeof simulationCount === "number"
        ? Math.max(1, Math.trunc(simulationCount))
        : params.fallback.posteriorSampleCount,
    riskMetrics,
    moduleOutputs
  };
}

function coerceScalaIlsCliResultToRunResult(params: {
  raw: unknown;
  runId: string;
  workspaceId: string;
}): RunResultRecord {
  const records = extractCandidateResultRecords(params.raw);

  for (const record of records) {
    const bundle = mergeBundleLikeScalaResult({
      raw: record,
      runId: params.runId,
      workspaceId: params.workspaceId
    });
    if (bundle) return bundle;
  }

  // Fallback: try to parse as trigger-only output merged into a minimal result
  const fallback: RunResultRecord = {
    runId: params.runId,
    workspaceId: params.workspaceId,
    generatedAt: new Date().toISOString(),
    modelVersion: "unknown",
    priorVersion: "unknown",
    posteriorSampleCount: 0,
    riskMetrics: {
      currency: "USD", expectedLoss: 0, expectedLossRate: 0, stdDevLoss: 0,
      attachmentProbability: 0, exhaustionProbability: 0, var99: 0, tvar99: 0, oep: [], aep: []
    },
    yearOutcomes: [],
    diagnostics: { rHatMax: 1, essMin: 1 }
  };

  for (const record of records) {
    const triggerResult = mergeScalaTriggerOutputIntoFallback({
      raw: record,
      fallback,
      runId: params.runId,
      workspaceId: params.workspaceId
    });
    if (triggerResult) return triggerResult;
  }

  throw new Error("Scala CLI JSON did not contain a complete PosteriorBundle or trigger payload");
}

function shellQuote(value: string): string {
  return JSON.stringify(value);
}

function buildIlsScalaCliShellCommand(baseCommand: string, inputPath: string): string {
  const trimmed = baseCommand.trim();
  if (trimmed.length === 0) {
    throw new Error("WORKER_ILS_SCALA_CLI_COMMAND is empty");
  }

  if (trimmed.includes("{input}")) {
    return trimmed.replaceAll("{input}", shellQuote(inputPath));
  }

  return `${trimmed} --input ${shellQuote(inputPath)}`;
}

/** Resolve relative file paths in the CLI payload against cwd so the Scala CLI
 *  (which resolves relative paths against the input JSON's parent temp dir) can
 *  find the files. Only touches string-valued keys that look like file paths. */
function resolvePayloadPaths(payload: Record<string, unknown>, cwd: string): Record<string, unknown> {
  const PATH_KEYS = new Set(["propertyPortfolioPath", "hurdat2Path", "portfolioPath", "trackDataPath"]);
  function walk(obj: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (PATH_KEYS.has(key) && typeof value === "string" && value.length > 0 && !isAbsolute(value)) {
        out[key] = resolvePath(cwd, value);
      } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        out[key] = walk(value as Record<string, unknown>);
      } else {
        out[key] = value;
      }
    }
    return out;
  }
  return walk(payload);
}

async function invokeIlsScalaCli(
  params: IlsScalaCliInvocationParams
): Promise<IlsScalaCliExecutionResult> {
  const resolvedPayload = resolvePayloadPaths(params.payload, params.cwd);
  const tempDir = await mkdtemp(joinPath(tmpdir(), "canopy-ils-cli-"));
  const inputPath = joinPath(tempDir, `${params.runId}.json`);
  await writeFile(inputPath, `${JSON.stringify(resolvedPayload, null, 2)}\n`, "utf8");
  const command = buildIlsScalaCliShellCommand(params.command, inputPath);

  try {
    console.log(
      JSON.stringify({
        level: "info",
        msg: "ils scala cli invoke",
        runId: params.runId,
        jobId: params.jobId,
        workspaceId: params.workspaceId,
        command,
        cwd: params.cwd,
        timeoutMs: params.timeoutMs,
        inputPath
      })
    );

    const startedAt = Date.now();
    const child = spawn(command, {
      cwd: params.cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderrChunks.push(chunk);
    });

    let timedOut = false;
    let timeoutHandle: NodeJS.Timeout | undefined;
    if (params.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) {
            child.kill("SIGKILL");
          }
        }, 2_000).unref();
      }, params.timeoutMs);
      timeoutHandle.unref();
    }

    let closeResult: { code: number | null; signal: NodeJS.Signals | null };
    try {
      closeResult = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve, reject) => {
          child.once("error", reject);
          child.once("close", (code, signal) => resolve({ code, signal }));
        }
      );
    } catch (error) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const durationMs = Date.now() - startedAt;
      const stderr = stderrChunks.join("");
      if (stderr.trim().length > 0) {
        console.warn(
          JSON.stringify({
            level: "warn",
            msg: "ils scala cli stderr",
            runId: params.runId,
            jobId: params.jobId,
            durationMs,
            stderrBytes: Buffer.byteLength(stderr),
            stderrPreview: truncateForLog(stderr)
          })
        );
      }
      const message =
        error instanceof Error ? error.message : "Failed to spawn or run Scala CLI process";
      throw new IlsScalaCliError(message, {
        command,
        cwd: params.cwd,
        timeoutMs: params.timeoutMs,
        timedOut,
        durationMs,
        exitCode: null,
        signal: null,
        stderrBytes: Buffer.byteLength(stderr),
        ...(stderr.trim().length > 0 ? { stderrPreview: truncateForLog(stderr) } : {})
      });
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }

    const stdout = stdoutChunks.join("");
    const stderr = stderrChunks.join("");
    const durationMs = Date.now() - startedAt;

    if (stderr.trim().length > 0) {
      console.warn(
        JSON.stringify({
          level: "warn",
          msg: "ils scala cli stderr",
          runId: params.runId,
          jobId: params.jobId,
          durationMs,
          stderrBytes: Buffer.byteLength(stderr),
          stderrPreview: truncateForLog(stderr)
        })
      );
    }

    const execution: IlsScalaCliExecutionResult = {
      stdout,
      stderr,
      durationMs,
      exitCode: closeResult.code,
      signal: closeResult.signal,
      timedOut
    };

    if (timedOut) {
      throw new IlsScalaCliError(`Scala CLI timed out after ${params.timeoutMs}ms`, {
        command,
        cwd: params.cwd,
        timeoutMs: params.timeoutMs,
        timedOut: true,
        durationMs,
        exitCode: closeResult.code,
        signal: closeResult.signal,
        stdoutBytes: Buffer.byteLength(stdout),
        stderrBytes: Buffer.byteLength(stderr),
        ...(stderr.trim().length > 0 ? { stderrPreview: truncateForLog(stderr) } : {})
      });
    }

    if (closeResult.code !== 0) {
      throw new IlsScalaCliError(`Scala CLI exited with code ${closeResult.code ?? "null"}`, {
        command,
        cwd: params.cwd,
        timeoutMs: params.timeoutMs,
        timedOut: false,
        durationMs,
        exitCode: closeResult.code,
        signal: closeResult.signal,
        stdoutBytes: Buffer.byteLength(stdout),
        stderrBytes: Buffer.byteLength(stderr),
        ...(stderr.trim().length > 0 ? { stderrPreview: truncateForLog(stderr) } : {}),
        ...(stdout.trim().length > 0 ? { stdoutPreview: truncateForLog(stdout) } : {})
      });
    }

    console.log(
      JSON.stringify({
        level: "info",
        msg: "ils scala cli completed",
        runId: params.runId,
        jobId: params.jobId,
        workspaceId: params.workspaceId,
        durationMs,
        exitCode: closeResult.code,
        stdoutBytes: Buffer.byteLength(stdout),
        stderrBytes: Buffer.byteLength(stderr)
      })
    );

    return execution;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function scalaCliAttemptMeta(params: {
  command: string;
  cwd: string;
  timeoutMs: number;
  execution?: IlsScalaCliExecutionResult;
  error?: unknown;
  fallback?: boolean;
}): Record<string, unknown> {
  const errorMeta =
    params.error instanceof IlsScalaCliError ? params.error.meta : undefined;
  const errorMessage =
    params.error instanceof Error
      ? params.error.message
      : params.error
        ? String(params.error)
        : undefined;

  return {
    attempted: true,
    command: params.command,
    cwd: params.cwd,
    timeoutMs: params.timeoutMs,
    ...(params.execution
      ? {
          durationMs: params.execution.durationMs,
          exitCode: params.execution.exitCode,
          signal: params.execution.signal,
          timedOut: params.execution.timedOut,
          stdoutBytes: Buffer.byteLength(params.execution.stdout),
          stderrBytes: Buffer.byteLength(params.execution.stderr),
          ...(params.execution.stderr.trim().length > 0
            ? { stderrPreview: truncateForLog(params.execution.stderr) }
            : {})
        }
      : {}),
    ...(errorMeta ?? {}),
    ...(errorMessage ? { error: errorMessage } : {}),
    ...(params.fallback ? { fallback: true } : {})
  };
}

async function hydrateRunInputFromUploads(params: {
  payload: RunJobPayload;
  store: RedisWorkerStateStore;
}): Promise<{ input: Record<string, unknown>; metadata?: Record<string, unknown> }> {
  const bindings = collectRunUploadBindings(params.payload.input ?? {}, params.payload.uploadId);
  if (bindings.length === 0) {
    return { input: params.payload.input ?? {} };
  }

  const uniqueUploadIds = [
    ...new Set(
      bindings.flatMap((binding) => {
        const uploadId = asString(binding.uploadId);
        return uploadId ? [uploadId] : [];
      })
    )
  ];
  if (uniqueUploadIds.length === 0) {
    return { input: params.payload.input ?? {} };
  }

  const uploadRecords = await Promise.all(uniqueUploadIds.map((uploadId) => params.store.getUpload(uploadId)));
  const uploadById = new Map<string, UploadRecord>();
  for (const upload of uploadRecords) {
    if (upload?.id) uploadById.set(upload.id, upload);
  }

  const resolvedUploads: ResolvedRunUpload[] = [];
  for (const binding of bindings) {
    const uploadId = asString(binding.uploadId);
    if (!uploadId) continue;
    const upload = uploadById.get(uploadId);
    if (!upload?.storagePath) continue;
    resolvedUploads.push({
      uploadId,
      role: normalizeUploadRole(binding.role) ?? inferUploadRoleFromFilename(asString(binding.filename) ?? upload.filename),
      filename: asString(binding.filename) ?? upload.filename,
      contentType: upload.contentType,
      bytes: upload.sizeBytes,
      storagePath: upload.storagePath
    });
  }

  if (resolvedUploads.length === 0) {
    return {
      input: params.payload.input ?? {},
      metadata: {
        uploadResolution: {
          requestedUploadCount: uniqueUploadIds.length,
          resolvedUploadCount: 0,
          resolvedUploads: []
        }
      }
    };
  }

  const hydratedInput = deepCloneRecord(params.payload.input ?? {});
  const moduleParameters = ensureObjectPath(hydratedInput, ["moduleParameters"]);
  const analysisType = coerceAnalysisType({
    raw: hydratedInput.analysisType,
    moduleParameters
  });

  const jsonCache = new Map<string, Record<string, unknown> | undefined>();
  const readUploadedJson = async (upload: ResolvedRunUpload): Promise<Record<string, unknown> | undefined> => {
    if (!upload.storagePath.toLowerCase().endsWith(".json")) return undefined;
    if (jsonCache.has(upload.storagePath)) return jsonCache.get(upload.storagePath);
    const parsed = await readJsonObjectFile(upload.storagePath);
    jsonCache.set(upload.storagePath, parsed);
    return parsed;
  };

  const uploadsByRole = new Map<string, ResolvedRunUpload[]>();
  for (const upload of resolvedUploads) {
    const key = upload.role ?? "__untyped__";
    const bucket = uploadsByRole.get(key);
    if (bucket) bucket.push(upload);
    else uploadsByRole.set(key, [upload]);
  }

  const firstByRole = (role: string): ResolvedRunUpload | undefined => uploadsByRole.get(role)?.[0];
  const firstHurdat2 =
    firstByRole("hurdat2") ??
    resolvedUploads.find((upload) => (upload.filename ?? "").toLowerCase().endsWith(".hurdat2"));
  const allJsonUploads = resolvedUploads.filter((upload) => (upload.filename ?? "").toLowerCase().endsWith(".json"));

  if (analysisType === "pricing") {
    const pricingParams = firstModuleParamsObject(hydratedInput, [
      "propertyCatPricing",
      "propertyCatPricingYlt",
      "pricingYlt"
    ]);
    if (!isPathSet(pricingParams.hurdat2Path) && firstHurdat2) {
      pricingParams.hurdat2Path = firstHurdat2.storagePath;
    }

    const propertyUpload =
      firstByRole("propertyPortfolio") ??
      firstByRole("baselinePortfolio") ??
      allJsonUploads.find((upload) => /(property|portfolio)/i.test(upload.filename ?? ""));
    if (!isPathSet(pricingParams.propertyPortfolioPath) && propertyUpload) {
      pricingParams.propertyPortfolioPath = propertyUpload.storagePath;
    }
  }

  if (analysisType === "sensitivity") {
    const ilsParams = firstModuleParamsObject(hydratedInput, [
      "ilsParametricTrigger",
      "ilsParametricTriggerSimulator",
      "parametricTriggerSimulation"
    ]);
    if (!isPathSet(ilsParams.hurdat2Path) && firstHurdat2) {
      ilsParams.hurdat2Path = firstHurdat2.storagePath;
    }

    const catBondUpload = firstByRole("catBondTerms");
    if (catBondUpload) {
      const catBondTerms = extractCatBondTermsObject(await readUploadedJson(catBondUpload));
      if (catBondTerms) {
        const candidateDeal = ensureObjectPath(hydratedInput, ["candidateDeal"]);
        if (!asRecord(candidateDeal.catBondTerms)) {
          candidateDeal.catBondTerms = catBondTerms;
        }
        if (ilsParams.notional === undefined) {
          const notional = asNumber(catBondTerms.notional);
          if (typeof notional === "number") ilsParams.notional = notional;
        }
        if (!isPathSet(ilsParams.currency) && !isPathSet(hydratedInput.currency)) {
          const currency = asString(catBondTerms.currency);
          if (currency) hydratedInput.currency = currency;
        }
      }
    }
  }

  if (analysisType === "risk") {
    const mpiParams = firstModuleParamsObject(hydratedInput, ["marginalPortfolioImpact"]);
    void mpiParams; // ensures moduleParameters.marginalPortfolioImpact exists for downstream consumers

    const baselineUpload =
      firstByRole("baselinePortfolio") ??
      firstByRole("propertyPortfolio") ??
      allJsonUploads.find((upload) => /portfolio/i.test(upload.filename ?? ""));
    if (baselineUpload && !asRecord(hydratedInput.propertyPortfolio)) {
      const baselineJson = await readUploadedJson(baselineUpload);
      const propertyPortfolio = extractPropertyPortfolioObject(baselineJson);
      if (propertyPortfolio) {
        hydratedInput.propertyPortfolio = propertyPortfolio;
      }
    }

    const candidateDealUpload = firstByRole("candidateDeal");
    if (candidateDealUpload) {
      const candidateDealJson = await readUploadedJson(candidateDealUpload);
      const candidateDeal = extractCandidateDealObject(candidateDealJson);
      if (candidateDeal) {
        const existingCandidateDeal = asRecord(hydratedInput.candidateDeal);
        hydratedInput.candidateDeal = existingCandidateDeal
          ? { ...candidateDeal, ...existingCandidateDeal }
          : candidateDeal;
      }
    }

    const catBondUpload = firstByRole("catBondTerms");
    if (catBondUpload) {
      const catBondTermsJson = await readUploadedJson(catBondUpload);
      const catBondTerms = extractCatBondTermsObject(catBondTermsJson);
      if (catBondTerms) {
        const candidateDeal = ensureObjectPath(hydratedInput, ["candidateDeal"]);
        if (!asRecord(candidateDeal.catBondTerms)) {
          candidateDeal.catBondTerms = catBondTerms;
        }
      }
    }
  }

  return {
    input: hydratedInput,
    metadata: {
      uploadResolution: {
        requestedUploadCount: uniqueUploadIds.length,
        resolvedUploadCount: resolvedUploads.length,
        resolvedUploads: resolvedUploads.map((upload) => ({
          uploadId: upload.uploadId,
          role: upload.role ?? "auto",
          filename: upload.filename,
          storagePath: upload.storagePath
        }))
      }
    }
  };
}

async function createRunResultWithIlsHandoff(params: {
  payload: RunJobPayload;
  config: WorkerConfig;
}): Promise<{ result: RunResultRecord; completionMetadata?: Record<string, unknown> }> {
  const input = params.payload.input ?? {};
  if (isPricingRunInput(input)) {
    if (!shouldUsePropertyPricingScalaCli(input)) {
      throw new Error(
        "Property-Cat Pricing requires the Scala engine; disabling useScalaEngine is not allowed."
      );
    }

    const pricingCliPayload = buildPropertyPricingScalaCliPayload({
      runId: params.payload.runId,
      workspaceId: params.payload.workspaceId,
      input
    });

    let pricingExecution: IlsScalaCliExecutionResult | undefined;
    const moduleParameters = asRecord(input.moduleParameters);
    const pricingInput =
      asRecord(moduleParameters?.propertyCatPricing) ??
      asRecord(moduleParameters?.propertyCatPricingYlt) ??
      asRecord(moduleParameters?.pricingYlt);
    const MAX_ENGINE_TIMEOUT_MS = 3_600_000; // 1 hour
    const pricingPerRunTimeoutMs = Math.min(
      MAX_ENGINE_TIMEOUT_MS,
      Math.max(
        1_000,
        Math.trunc(
          asNumber(pricingInput?.scalaEngineTimeoutMs) ?? params.config.propertyPricingScalaCliTimeoutMs
        )
      )
    );

    try {
      pricingExecution = await invokeIlsScalaCli({
        command: params.config.propertyPricingScalaCliCommand,
        cwd: params.config.propertyPricingScalaCliCwd,
        timeoutMs: pricingPerRunTimeoutMs,
        runId: params.payload.runId,
        workspaceId: params.payload.workspaceId,
        jobId: params.payload.jobId,
        payload: pricingCliPayload
      });

      const parsed = parseTrailingJsonFromStdout(pricingExecution.stdout);
      const result = coerceScalaIlsCliResultToRunResult({
        raw: parsed,
        runId: params.payload.runId,
        workspaceId: params.payload.workspaceId
      });

      return {
        result,
        completionMetadata: {
          resultSource: "scala-property-pricing-cli",
          propertyPricingScalaCli: scalaCliAttemptMeta({
            command: params.config.propertyPricingScalaCliCommand,
            cwd: params.config.propertyPricingScalaCliCwd,
            timeoutMs: pricingPerRunTimeoutMs,
            execution: pricingExecution
          })
        }
      };
    } catch (error) {
      const propertyPricingScalaCli = scalaCliAttemptMeta({
        command: params.config.propertyPricingScalaCliCommand,
        cwd: params.config.propertyPricingScalaCliCwd,
        timeoutMs: pricingPerRunTimeoutMs,
        execution: pricingExecution,
        error
      });

      console.error(
        JSON.stringify({
          level: "error",
          msg: "property pricing scala cli failed",
          runId: params.payload.runId,
          jobId: params.payload.jobId,
          workspaceId: params.payload.workspaceId,
          propertyPricingScalaCli
        })
      );

      const message =
        error instanceof Error ? error.message : "Property-Cat Pricing Scala CLI execution failed";
      throw new Error(`Property-Cat Pricing Scala CLI failed: ${message}`);
    }
  }

  if (isRiskRunInput(input)) {
    throw new Error(
      "Marginal Portfolio Impact is disabled because its current engine still relies on synthetic heuristics."
    );
  }

  if (!isSensitivityRunInput(input)) {
    throw new Error(
      "Unsupported analysis type. Only Property-Cat Pricing and ILS Parametric Trigger are available."
    );
  }

  if (!shouldUseIlsScalaCli(input)) {
    throw new Error(
      "ILS Parametric Trigger requires the Scala engine; disabling useScalaEngine is not allowed."
    );
  }

  const cliPayload = buildIlsScalaCliPayload({
    runId: params.payload.runId,
    workspaceId: params.payload.workspaceId,
    input
  });

  let execution: IlsScalaCliExecutionResult | undefined;
  const moduleParameters = asRecord(input.moduleParameters);
  const ilsInput =
    asRecord(moduleParameters?.ilsParametricTrigger) ??
    asRecord(moduleParameters?.ilsParametricTriggerSimulator) ??
    asRecord(moduleParameters?.parametricTriggerSimulation);
  const perRunTimeoutMs = Math.min(
    3_600_000,
    Math.max(
      1_000,
      Math.trunc(asNumber(ilsInput?.scalaEngineTimeoutMs) ?? params.config.ilsScalaCliTimeoutMs)
    )
  );
  try {
    execution = await invokeIlsScalaCli({
      command: params.config.ilsScalaCliCommand,
      cwd: params.config.ilsScalaCliCwd,
      timeoutMs: perRunTimeoutMs,
      runId: params.payload.runId,
      workspaceId: params.payload.workspaceId,
      jobId: params.payload.jobId,
      payload: cliPayload
    });

    const parsed = parseTrailingJsonFromStdout(execution.stdout);
    const result = coerceScalaIlsCliResultToRunResult({
      raw: parsed,
      runId: params.payload.runId,
      workspaceId: params.payload.workspaceId
    });

    return {
      result,
      completionMetadata: {
        resultSource: "scala-ils-cli",
        ilsScalaCli: scalaCliAttemptMeta({
          command: params.config.ilsScalaCliCommand,
          cwd: params.config.ilsScalaCliCwd,
          timeoutMs: perRunTimeoutMs,
          execution
        })
      }
    };
  } catch (error) {
    const ilsScalaCli = scalaCliAttemptMeta({
      command: params.config.ilsScalaCliCommand,
      cwd: params.config.ilsScalaCliCwd,
      timeoutMs: perRunTimeoutMs,
      execution,
      error
    });

    console.error(
      JSON.stringify({
        level: "error",
        msg: "ils scala cli failed",
        runId: params.payload.runId,
        jobId: params.payload.jobId,
        workspaceId: params.payload.workspaceId,
        ilsScalaCli
      })
    );

    const message =
      error instanceof Error ? error.message : "ILS Parametric Trigger Scala CLI execution failed";
    throw new Error(`ILS Parametric Trigger Scala CLI failed: ${message}`);
  }
}

async function main(): Promise<void> {
  const config = readConfig();
  const stateRedis = new IORedis(config.redisUrl);
  const workerRedis = new IORedis(config.redisUrl, {
    maxRetriesPerRequest: null
  });
  const store = await RedisWorkerStateStore.create(stateRedis, config.redisPrefix, {
    databaseUrl: config.databaseUrl,
    serviceName: "@canopy/worker",
    log: (level, message, meta) => {
      const entry = { level, msg: message, ...(meta ?? {}) };
      if (level === "error") {
        console.error(JSON.stringify(entry));
        return;
      }
      console.log(JSON.stringify(entry));
    }
  });

  const metrics = {
    startedAt: Date.now(),
    processed: 0,
    failed: 0
  };

  const worker = new Worker<RunJobPayload>(
    config.runQueueName,
    async (bullJob) => {
      const payload = bullJob.data;
      let lastProgress = 0.05;

      const emitStage = async (params: {
        stage: "validating" | "running" | "post-processing";
        status: "validating" | "running";
        progress: number;
        message: string;
      }) => {
        lastProgress = params.progress;
        await bullJob.updateProgress(Math.round(params.progress * 100));
        await store.updateStatus({
          jobId: payload.jobId,
          runId: payload.runId,
          status: params.status,
          progress: params.progress,
          stage: params.stage,
          message: params.message
        });
        console.log(
          JSON.stringify({
            level: "info",
            msg: "run stage",
            queue: config.runQueueName,
            runId: payload.runId,
            jobId: payload.jobId,
            stage: params.stage,
            status: params.status,
            progress: params.progress
          })
        );
      };

      try {
        await bullJob.updateProgress(5);
        await emitStage({
          stage: "validating",
          status: "validating",
          progress: 0.2,
          message: "Validating inputs"
        });
        await sleep(config.stepDelayMs);

        await emitStage({
          stage: "running",
          status: "running",
          progress: 0.65,
          message: "Running analysis"
        });
        await sleep(config.stepDelayMs);

        await emitStage({
          stage: "post-processing",
          status: "running",
          progress: 0.9,
          message: "Post-processing results"
        });
        await sleep(config.stepDelayMs);

        const { input: hydratedInput, metadata: uploadResolutionMetadata } =
          await hydrateRunInputFromUploads({
            payload,
            store
          });

        const { result, completionMetadata } = await createRunResultWithIlsHandoff({
          payload: {
            ...payload,
            input: hydratedInput
          },
          config
        });

        const mergedCompletionMetadata =
          uploadResolutionMetadata || completionMetadata
            ? {
                ...(uploadResolutionMetadata ?? {}),
                ...(completionMetadata ?? {})
              }
            : undefined;

        await bullJob.updateProgress(100);
        await store.completeWithResult({
          jobId: payload.jobId,
          runId: payload.runId,
          result,
          message: "Run completed",
          ...(mergedCompletionMetadata ? { metadata: mergedCompletionMetadata } : {})
        });
        console.log(
          JSON.stringify({
            level: "info",
            msg: "run stage",
            queue: config.runQueueName,
            runId: payload.runId,
            jobId: payload.jobId,
            stage: "completed",
            status: "succeeded",
            progress: 1,
            ...(mergedCompletionMetadata ? { metadata: mergedCompletionMetadata } : {})
          })
        );

        metrics.processed += 1;
        return { ok: true, runId: payload.runId };
      } catch (error) {
        metrics.failed += 1;
        const message = error instanceof Error ? error.message : "Worker processing failed";
        try {
          await store.updateStatus({
            jobId: payload.jobId,
            runId: payload.runId,
            status: "failed",
            progress: lastProgress,
            errorMessage: message,
            stage: "failed",
            message: "Run failed",
            metadata: { error: message }
          });
        } catch (stateError) {
          console.error(
            JSON.stringify({
              level: "error",
              msg: "failed to update job/run status after processing error",
              runId: payload.runId,
              jobId: payload.jobId,
              stateError: stateError instanceof Error ? stateError.message : String(stateError),
              primaryError: message
            })
          );
        }
        console.error(
          JSON.stringify({
            level: "error",
            msg: "run stage",
            queue: config.runQueueName,
            runId: payload.runId,
            jobId: payload.jobId,
            stage: "failed",
            status: "failed",
            progress: lastProgress,
            error: message
          })
        );
        throw error;
      }
    },
    {
      connection: workerRedis,
      concurrency: config.concurrency
    }
  );

  worker.on("completed", (job) => {
    console.log(
      JSON.stringify({
        level: "info",
        msg: "job completed",
        queue: config.runQueueName,
        jobId: job.id
      })
    );
  });

  worker.on("failed", (job, err) => {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "job failed",
        queue: config.runQueueName,
        jobId: job?.id,
        error: err.message
      })
    );
  });

  worker.on("error", (err) => {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "worker error",
        queue: config.runQueueName,
        error: err.message
      })
    );
  });

  const healthServer = createServer((req, res) => {
    if (!req.url || !req.url.startsWith("/health")) {
      res.statusCode = 404;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "Not Found" }));
      return;
    }

    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        service: "@canopy/worker",
        status: "ok",
        queue: config.runQueueName,
        redis: config.redisUrl,
        uptimeSeconds: Math.floor((Date.now() - metrics.startedAt) / 1000),
        processed: metrics.processed,
        failed: metrics.failed
      })
    );
  });

  await worker.waitUntilReady();

  await new Promise<void>((resolve) => {
    healthServer.listen(config.port, "0.0.0.0", () => resolve());
  });

  console.log(
    JSON.stringify({
      level: "info",
      msg: "worker started",
      queue: config.runQueueName,
      workerPort: config.port,
      concurrency: config.concurrency
    })
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(JSON.stringify({ level: "info", msg: "shutting down", signal }));
    await Promise.allSettled([
      new Promise<void>((resolve, reject) => {
        healthServer.close((err) => (err ? reject(err) : resolve()));
      }),
      worker.close(),
      store.close(),
      stateRedis.quit().catch(() => undefined),
      workerRedis.quit().catch(() => undefined)
    ]);
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
