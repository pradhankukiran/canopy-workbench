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


interface IlsScalaCliInvocationParams {
  command: string;
  cwd: string;
  timeoutMs: number;
  runId: string;
  workspaceId: string;
  jobId: string;
  payload: Record<string, unknown>;
  onProgress?: (event: EngineProgressEvent) => void | Promise<void>;
}

export interface EngineProgressEvent {
  fraction?: number;
  phase?: string;
  simulatorFraction?: number;
}

/** Parse a single stderr line as an engine heartbeat. Returns undefined for
  * lines that are not NDJSON-shaped `{"kind":"progress", ...}` events, so
  * plain-text log lines pass through silently. Exported for unit tests.
  */
export function parseHeartbeatLine(line: string): EngineProgressEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || parsed.kind !== "progress") return undefined;
    return {
      fraction: typeof parsed.fraction === "number" ? parsed.fraction : undefined,
      phase: typeof parsed.phase === "string" ? parsed.phase : undefined,
      simulatorFraction:
        typeof parsed.simulatorFraction === "number" ? parsed.simulatorFraction : undefined
    };
  } catch {
    return undefined;
  }
}

/** Split buffered stderr chunks on newlines, parse each line as a heartbeat,
  * and return the leftover (a trailing line fragment) to feed into the next
  * chunk. Exported for unit tests. */
export function scanHeartbeats(
  chunk: string,
  remainder: string
): { events: EngineProgressEvent[]; remainder: string } {
  const combined = remainder + chunk;
  const parts = combined.split("\n");
  const leftover = parts.pop() ?? "";
  const events: EngineProgressEvent[] = [];
  for (const line of parts) {
    const parsed = parseHeartbeatLine(line);
    if (parsed) events.push(parsed);
  }
  return { events, remainder: leftover };
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
    const aggregateRetainedLoss = Math.max(
      0,
      roundInt(
        asNumber(row.aggregateRetainedLoss) ??
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
          Math.max(0, aggregateGrossLoss - aggregateRetainedLoss)
      )
    );

    // bondExhausted is only set when the engine emits a real layer-tower
    // flag. Until phase 3 lands the tower, the pricing engine omits it and
    // we leave it undefined here rather than synthesizing false.
    const bondExhausted =
      asBoolean(row.bondExhausted) ??
      asBoolean(row.exhausted) ??
      asBoolean(row.exhaustionReached);

    return [
      {
        yearIndex,
        eventCount,
        aggregateGrossLoss,
        aggregateRetainedLoss,
        aggregateNetLoss,
        ...(bondExhausted !== undefined ? { bondExhausted } : {})
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
  if (!record) {
    return fallback;
  }

  const status = asString(record.status);
  const reason = asString(record.reason);
  const source = asString(record.source);
  const rHatRaw = asNumber(record.rHatMax) ?? asNumber(record.rhatMax);
  const essRaw = asNumber(record.essMin);

  const diagnostics: RunResultRecord["diagnostics"] = {};
  if (status) diagnostics.status = status as RunResultRecord["diagnostics"]["status"];
  if (reason) diagnostics.reason = reason;
  if (source) diagnostics.source = source;
  if (rHatRaw !== undefined && Number.isFinite(rHatRaw)) {
    diagnostics.rHatMax = roundTo(Math.max(1, rHatRaw), 4);
  }
  if (essRaw !== undefined && Number.isFinite(essRaw)) {
    diagnostics.essMin = Math.max(1, roundInt(essRaw));
  }

  return diagnostics;
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
    diagnostics: normalizeDiagnostics(diagnostics, {
      status: "skipped",
      reason: "engine output did not include a diagnostics object"
    }),
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
    diagnostics: { status: "skipped", reason: "fallback skeleton before engine output" }
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

    // Parse stderr line-by-line so we can extract NDJSON heartbeats from the
    // engine and translate them to worker progress events. Non-JSON lines
    // (regular log output) are still buffered and forwarded to the caller
    // exactly as before.
    let stderrRemainder = "";
    child.stderr.on("data", (chunk: string) => {
      stderrChunks.push(chunk);
      if (!params.onProgress) return;
      const scanned = scanHeartbeats(chunk, stderrRemainder);
      stderrRemainder = scanned.remainder;
      for (const event of scanned.events) {
        void Promise.resolve(params.onProgress(event)).catch(() => {
          /* swallow: progress is best-effort */
        });
      }
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
  onProgress?: (event: EngineProgressEvent) => void | Promise<void>;
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
        payload: pricingCliPayload,
        onProgress: params.onProgress
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
      payload: cliPayload,
      onProgress: params.onProgress
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
        // Real progress: validating fires when we actually start hydrating
        // the uploaded input (the only real validation the worker does).
        // The engine later emits stderr NDJSON heartbeats that map onto
        // `running` / `post-processing` in the onProgress callback below.
        await bullJob.updateProgress(5);
        await emitStage({
          stage: "validating",
          status: "validating",
          progress: 0.1,
          message: "Hydrating uploaded inputs"
        });

        const { input: hydratedInput, metadata: uploadResolutionMetadata } =
          await hydrateRunInputFromUploads({
            payload,
            store
          });

        // Phase mapping for the engine's NDJSON heartbeats. Each engine
        // phase emits a `fraction` in [0, 1] representing overall CLI
        // progress; we clamp into [0.15, 0.95] in the worker's progress
        // window so the UI never jumps backwards and the final completion
        // event still corresponds to progress=1.0.
        let lastHeartbeatAt = 0;
        const throttleMs = 200;
        const mapPhaseToStage = (
          phase?: string
        ): { stage: "validating" | "running" | "post-processing"; status: "validating" | "running" } => {
          switch (phase) {
            case "parsing-args":
            case "loading-input":
            case "loading-hurdat2":
              return { stage: "validating", status: "validating" };
            case "post-processing":
            case "writing-output":
            case "done":
              return { stage: "post-processing", status: "running" };
            case "simulating":
            default:
              return { stage: "running", status: "running" };
          }
        };

        const onEngineProgress = async (event: EngineProgressEvent) => {
          const now = Date.now();
          if (now - lastHeartbeatAt < throttleMs) return;
          lastHeartbeatAt = now;

          const raw = typeof event.fraction === "number" ? event.fraction : undefined;
          if (raw === undefined || !Number.isFinite(raw)) return;
          const clamped = Math.max(0, Math.min(1, raw));
          // Keep engine progress in the [0.15, 0.95] window.
          const mapped = 0.15 + clamped * 0.8;
          if (mapped <= lastProgress) return;
          const { stage, status } = mapPhaseToStage(event.phase);
          await emitStage({
            stage,
            status,
            progress: mapped,
            message: event.phase ? `engine: ${event.phase}` : "engine running"
          });
        };

        const { result, completionMetadata } = await createRunResultWithIlsHandoff({
          payload: {
            ...payload,
            input: hydratedInput
          },
          config,
          onProgress: onEngineProgress
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
