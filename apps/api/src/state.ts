import { randomUUID } from "node:crypto";

import type Redis from "ioredis";
import { Pool } from "pg";

export const DEFAULT_REDIS_PREFIX = "canopy:phase1";
export const DEFAULT_RUN_QUEUE_NAME = "canopy_phase1_runs";

export type LifecycleStatus =
  | "queued"
  | "validating"
  | "running"
  | "succeeded"
  | "failed";

export type RunEventStage =
  | "submitted"
  | "queued"
  | "validating"
  | "running"
  | "post-processing"
  | "completed"
  | "failed";

export interface JobRecord {
  id: string;
  runId: string;
  workspaceId: string;
  queueName: string;
  bullJobId: string;
  status: LifecycleStatus;
  progress?: number;
  createdAt: string;
  updatedAt: string;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
}

export interface RunRecord {
  id: string;
  jobId: string;
  workspaceId: string;
  status: LifecycleStatus;
  createdAt: string;
  updatedAt: string;
  submittedAt: string;
  startedAt?: string;
  completedAt?: string;
  resultReady: boolean;
  resultKey?: string;
  input: Record<string, unknown>;
}

export interface UploadRecord {
  id: string;
  workspaceId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  status: "pending" | "ready";
  storagePath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunEventRecord {
  id: string;
  runId: string;
  jobId: string;
  workspaceId: string;
  stage: RunEventStage;
  status: LifecycleStatus;
  createdAt: string;
  message?: string;
  progress?: number;
  metadata?: Record<string, unknown>;
}

export interface RunModuleOutputsRecord extends Record<string, unknown> {
  marginalPortfolioImpact?: Record<string, unknown>;
  propertyCatPricing?: Record<string, unknown>;
  propertyCatPricingYlt?: Record<string, unknown>;
  ilsParametricTrigger?: Record<string, unknown>;
  ilsParametricTriggerSimulator?: Record<string, unknown>;
}

export interface RunResultRecord {
  runId: string;
  workspaceId: string;
  generatedAt: string;
  modelVersion: string;
  priorVersion: string;
  posteriorSampleCount: number;
  riskMetrics: {
    currency: string;
    expectedLoss: number;
    expectedLossRate: number;
    stdDevLoss: number;
    attachmentProbability: number;
    exhaustionProbability: number;
    var99: number;
    tvar99: number;
    oep: Array<{
      returnPeriodYears: number;
      grossLoss: number;
      netLoss: number;
      bondPayout: number;
    }>;
    aep: Array<{
      returnPeriodYears: number;
      grossLoss: number;
      netLoss: number;
      bondPayout: number;
    }>;
  };
  yearOutcomes: Array<{
    yearIndex: number;
    eventCount: number;
    aggregateGrossLoss: number;
    aggregateRetainedLoss: number;
    aggregateNetLoss: number;
    bondExhausted?: boolean;
  }>;
  diagnostics: {
    status?: "converged" | "skipped" | "no_mcmc_diagnostics" | "failed";
    rHatMax?: number;
    essMin?: number;
    reason?: string;
    source?: string;
  };
  moduleOutputs?: RunModuleOutputsRecord;
  artifacts?: {
    summaryUri?: string;
    rawSamplesUri?: string;
    traceUri?: string;
  };
}

type LogLevel = "info" | "warn" | "error";
type LogFn = (level: LogLevel, message: string, meta?: Record<string, unknown>) => void;

export interface RedisStateStoreOptions {
  databaseUrl?: string;
  serviceName?: string;
  log?: LogFn;
}

interface RunEventsPage {
  items: RunEventRecord[];
  count: number;
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function parsePgJson<T>(value: unknown): T | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  if (typeof value === "object") return value as T;
  return null;
}

function clampProgress(progress: number | undefined): number | undefined {
  if (typeof progress !== "number" || Number.isNaN(progress)) return undefined;
  return Math.max(0, Math.min(1, progress));
}

function eventId(): string {
  return `evt_${randomUUID().replace(/-/g, "")}`;
}

class PostgresPersistence {
  private constructor(
    private readonly pool: Pool,
    private readonly log: LogFn
  ) {}

  static async create(options: RedisStateStoreOptions = {}): Promise<PostgresPersistence | null> {
    const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
    if (!databaseUrl) return null;

    const log = options.log ?? (() => undefined);
    const serviceName = options.serviceName ?? "@canopy/api";
    const pool = new Pool({ connectionString: databaseUrl });
    const persistence = new PostgresPersistence(pool, log);

    try {
      await persistence.pool.query("select 1");
      await persistence.migrate();
      log("info", "postgres persistence enabled", { service: serviceName });
      return persistence;
    } catch (error) {
      log("warn", "postgres persistence unavailable; continuing with redis only", {
        service: serviceName,
        error: error instanceof Error ? error.message : String(error)
      });
      await pool.end().catch(() => undefined);
      return null;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async migrate(): Promise<void> {
    await this.pool.query(`
      create table if not exists canopy_phase1_jobs (
        job_id text primary key,
        run_id text not null,
        workspace_id text not null,
        status text not null,
        created_at timestamptz not null,
        updated_at timestamptz not null,
        data jsonb not null
      )
    `);
    await this.pool.query(
      "create index if not exists canopy_phase1_jobs_created_at_idx on canopy_phase1_jobs (created_at desc)"
    );

    await this.pool.query(`
      create table if not exists canopy_phase1_runs (
        run_id text primary key,
        job_id text not null,
        workspace_id text not null,
        status text not null,
        created_at timestamptz not null,
        updated_at timestamptz not null,
        data jsonb not null
      )
    `);
    await this.pool.query(
      "create index if not exists canopy_phase1_runs_created_at_idx on canopy_phase1_runs (created_at desc)"
    );

    await this.pool.query(`
      create table if not exists canopy_phase1_run_events (
        event_id text primary key,
        run_id text not null,
        job_id text not null,
        workspace_id text not null,
        stage text not null,
        status text not null,
        created_at timestamptz not null,
        data jsonb not null
      )
    `);
    await this.pool.query(
      "create index if not exists canopy_phase1_run_events_run_created_idx on canopy_phase1_run_events (run_id, created_at asc, event_id asc)"
    );

    await this.pool.query(`
      create table if not exists canopy_phase1_run_results (
        run_id text primary key,
        workspace_id text not null,
        generated_at timestamptz not null,
        data jsonb not null
      )
    `);
  }

  async upsertJob(job: JobRecord): Promise<void> {
    await this.pool.query(
      `
        insert into canopy_phase1_jobs (
          job_id,
          run_id,
          workspace_id,
          status,
          created_at,
          updated_at,
          data
        )
        values ($1, $2, $3, $4, $5, $6, $7::jsonb)
        on conflict (job_id)
        do update set
          run_id = excluded.run_id,
          workspace_id = excluded.workspace_id,
          status = excluded.status,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          data = excluded.data
      `,
      [
        job.id,
        job.runId,
        job.workspaceId,
        job.status,
        job.createdAt,
        job.updatedAt,
        JSON.stringify(job)
      ]
    );
  }

  async upsertRun(run: RunRecord): Promise<void> {
    await this.pool.query(
      `
        insert into canopy_phase1_runs (
          run_id,
          job_id,
          workspace_id,
          status,
          created_at,
          updated_at,
          data
        )
        values ($1, $2, $3, $4, $5, $6, $7::jsonb)
        on conflict (run_id)
        do update set
          job_id = excluded.job_id,
          workspace_id = excluded.workspace_id,
          status = excluded.status,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          data = excluded.data
      `,
      [
        run.id,
        run.jobId,
        run.workspaceId,
        run.status,
        run.createdAt,
        run.updatedAt,
        JSON.stringify(run)
      ]
    );
  }

  async upsertRunResult(runId: string, result: RunResultRecord): Promise<void> {
    await this.pool.query(
      `
        insert into canopy_phase1_run_results (run_id, workspace_id, generated_at, data)
        values ($1, $2, $3, $4::jsonb)
        on conflict (run_id)
        do update set
          workspace_id = excluded.workspace_id,
          generated_at = excluded.generated_at,
          data = excluded.data
      `,
      [runId, result.workspaceId, result.generatedAt, JSON.stringify(result)]
    );
  }

  async appendRunEvent(event: RunEventRecord): Promise<void> {
    await this.pool.query(
      `
        insert into canopy_phase1_run_events (
          event_id,
          run_id,
          job_id,
          workspace_id,
          stage,
          status,
          created_at,
          data
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        on conflict (event_id) do nothing
      `,
      [
        event.id,
        event.runId,
        event.jobId,
        event.workspaceId,
        event.stage,
        event.status,
        event.createdAt,
        JSON.stringify(event)
      ]
    );
  }

  async getJob(jobId: string): Promise<JobRecord | null> {
    const result = await this.pool.query<{ data: unknown }>(
      "select data from canopy_phase1_jobs where job_id = $1 limit 1",
      [jobId]
    );
    return parsePgJson<JobRecord>(result.rows[0]?.data ?? null);
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    const result = await this.pool.query<{ data: unknown }>(
      "select data from canopy_phase1_runs where run_id = $1 limit 1",
      [runId]
    );
    return parsePgJson<RunRecord>(result.rows[0]?.data ?? null);
  }

  async listJobs(limit: number): Promise<JobRecord[]> {
    const result = await this.pool.query<{ data: unknown }>(
      "select data from canopy_phase1_jobs order by created_at desc, job_id desc limit $1",
      [Math.max(1, limit)]
    );
    return result.rows.flatMap((row) => {
      const parsed = parsePgJson<JobRecord>(row.data);
      return parsed ? [parsed] : [];
    });
  }

  async listRuns(limit: number): Promise<RunRecord[]> {
    const result = await this.pool.query<{ data: unknown }>(
      "select data from canopy_phase1_runs order by created_at desc, run_id desc limit $1",
      [Math.max(1, limit)]
    );
    return result.rows.flatMap((row) => {
      const parsed = parsePgJson<RunRecord>(row.data);
      return parsed ? [parsed] : [];
    });
  }

  async getRunResult(runId: string): Promise<RunResultRecord | null> {
    const result = await this.pool.query<{ data: unknown }>(
      "select data from canopy_phase1_run_results where run_id = $1 limit 1",
      [runId]
    );
    return parsePgJson<RunResultRecord>(result.rows[0]?.data ?? null);
  }

  async listRunEventsPage(runId: string, limit: number): Promise<RunEventsPage> {
    const boundedLimit = Math.max(1, limit);
    const [itemsResult, countResult] = await Promise.all([
      this.pool.query<{ data: unknown }>(
        `
          select data
          from canopy_phase1_run_events
          where run_id = $1
          order by created_at asc, event_id asc
          limit $2
        `,
        [runId, boundedLimit]
      ),
      this.pool.query<{ count: string }>(
        "select count(*)::text as count from canopy_phase1_run_events where run_id = $1",
        [runId]
      )
    ]);

    return {
      items: itemsResult.rows.flatMap((row) => {
        const parsed = parsePgJson<RunEventRecord>(row.data);
        return parsed ? [parsed] : [];
      }),
      count: Number.parseInt(countResult.rows[0]?.count ?? "0", 10) || 0
    };
  }
}

export class RedisStateStore {
  private readonly log: LogFn;
  private readonly postgres: PostgresPersistence | null;

  static async create(
    redis: Redis,
    prefix = DEFAULT_REDIS_PREFIX,
    options: RedisStateStoreOptions = {}
  ): Promise<RedisStateStore> {
    const postgres = await PostgresPersistence.create(options);
    return new RedisStateStore(redis, prefix, postgres, options.log);
  }

  constructor(
    private readonly redis: Redis,
    private readonly prefix = DEFAULT_REDIS_PREFIX,
    postgres: PostgresPersistence | null = null,
    log?: LogFn
  ) {
    this.postgres = postgres;
    this.log = log ?? (() => undefined);
  }

  private key = {
    job: (jobId: string) => `${this.prefix}:jobs:${jobId}`,
    run: (runId: string) => `${this.prefix}:runs:${runId}`,
    runResult: (runId: string) => `${this.prefix}:runs:${runId}:result`,
    runEvents: (runId: string) => `${this.prefix}:runs:${runId}:events`,
    upload: (uploadId: string) => `${this.prefix}:uploads:${uploadId}`,
    jobsIndex: () => `${this.prefix}:jobs:index`,
    runsIndex: () => `${this.prefix}:runs:index`,
    uploadsIndex: () => `${this.prefix}:uploads:index`
  };

  async close(): Promise<void> {
    if (!this.postgres) return;
    await this.postgres.close().catch(() => undefined);
  }

  private async mirrorWrite(
    operationName: string,
    fn: (postgres: PostgresPersistence) => Promise<void>
  ): Promise<void> {
    if (!this.postgres) return;
    try {
      await fn(this.postgres);
    } catch (error) {
      this.log("warn", "postgres mirror write failed; continuing with redis", {
        operation: operationName,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async readFromPostgres<T>(
    operationName: string,
    fn: (postgres: PostgresPersistence) => Promise<T>
  ): Promise<T | null> {
    if (!this.postgres) return null;
    try {
      return await fn(this.postgres);
    } catch (error) {
      this.log("warn", "postgres read failed; falling back to redis", {
        operation: operationName,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  async saveJobAndRun(job: JobRecord, run: RunRecord): Promise<void> {
    const score = Date.parse(run.createdAt);
    if (!Number.isFinite(score)) {
      throw new Error(`Invalid createdAt timestamp: ${run.createdAt}`);
    }
    const tx = this.redis.multi();
    tx.set(this.key.job(job.id), JSON.stringify(job));
    tx.zadd(this.key.jobsIndex(), score, job.id);
    tx.set(this.key.run(run.id), JSON.stringify(run));
    tx.zadd(this.key.runsIndex(), score, run.id);
    await tx.exec();

    await this.mirrorWrite("saveJobAndRun", async (postgres) => {
      await Promise.all([postgres.upsertJob(job), postgres.upsertRun(run)]);
    });
  }

  async saveJob(job: JobRecord): Promise<void> {
    await this.redis.set(this.key.job(job.id), JSON.stringify(job));
    await this.mirrorWrite("saveJob", (postgres) => postgres.upsertJob(job));
  }

  async saveRun(run: RunRecord): Promise<void> {
    await this.redis.set(this.key.run(run.id), JSON.stringify(run));
    await this.mirrorWrite("saveRun", (postgres) => postgres.upsertRun(run));
  }

  async getJob(jobId: string): Promise<JobRecord | null> {
    const postgresJob = await this.readFromPostgres("getJob", (postgres) => postgres.getJob(jobId));
    if (postgresJob) return postgresJob;
    return parseJson<JobRecord>(await this.redis.get(this.key.job(jobId)));
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    const postgresRun = await this.readFromPostgres("getRun", (postgres) => postgres.getRun(runId));
    if (postgresRun) return postgresRun;
    return parseJson<RunRecord>(await this.redis.get(this.key.run(runId)));
  }

  async listJobs(limit = 100): Promise<JobRecord[]> {
    const postgresJobs = await this.readFromPostgres("listJobs", (postgres) => postgres.listJobs(limit));
    if (postgresJobs && postgresJobs.length > 0) return postgresJobs;
    return this.listByIndex<JobRecord>(this.key.jobsIndex(), (id) => this.key.job(id), limit);
  }

  async listRuns(limit = 100): Promise<RunRecord[]> {
    const postgresRuns = await this.readFromPostgres("listRuns", (postgres) => postgres.listRuns(limit));
    if (postgresRuns && postgresRuns.length > 0) return postgresRuns;
    return this.listByIndex<RunRecord>(this.key.runsIndex(), (id) => this.key.run(id), limit);
  }

  async saveUpload(upload: UploadRecord): Promise<void> {
    const score = Date.parse(upload.createdAt);
    if (!Number.isFinite(score)) {
      throw new Error(`Invalid createdAt timestamp: ${upload.createdAt}`);
    }
    const tx = this.redis.multi();
    tx.set(this.key.upload(upload.id), JSON.stringify(upload));
    tx.zadd(this.key.uploadsIndex(), score, upload.id);
    await tx.exec();
  }

  async listUploads(limit = 100): Promise<UploadRecord[]> {
    return this.listByIndex<UploadRecord>(
      this.key.uploadsIndex(),
      (id) => this.key.upload(id),
      limit
    );
  }

  async getRunResult(runId: string): Promise<RunResultRecord | null> {
    const postgresResult = await this.readFromPostgres("getRunResult", (postgres) =>
      postgres.getRunResult(runId)
    );
    if (postgresResult) return postgresResult;
    return parseJson<RunResultRecord>(await this.redis.get(this.key.runResult(runId)));
  }

  async saveRunResult(runId: string, result: RunResultRecord): Promise<void> {
    await this.redis.set(this.key.runResult(runId), JSON.stringify(result));
    await this.mirrorWrite("saveRunResult", (postgres) => postgres.upsertRunResult(runId, result));
  }

  async appendRunEvent(
    event: Omit<RunEventRecord, "id" | "createdAt" | "progress"> & {
      id?: string;
      createdAt?: string;
      progress?: number;
    }
  ): Promise<RunEventRecord> {
    const record: RunEventRecord = {
      ...event,
      id: event.id ?? eventId(),
      createdAt: event.createdAt ?? new Date().toISOString(),
      progress: clampProgress(event.progress)
    };

    await this.redis.rpush(this.key.runEvents(record.runId), JSON.stringify(record));
    await this.mirrorWrite("appendRunEvent", (postgres) => postgres.appendRunEvent(record));
    return record;
  }

  async getRunEventsPage(runId: string, limit = 200): Promise<RunEventsPage> {
    const postgresPage = await this.readFromPostgres("listRunEventsPage", (postgres) =>
      postgres.listRunEventsPage(runId, limit)
    );
    if (postgresPage && postgresPage.count > 0) return postgresPage;

    const boundedLimit = Math.max(1, limit);
    const [count, values] = await Promise.all([
      this.redis.llen(this.key.runEvents(runId)),
      this.redis.lrange(this.key.runEvents(runId), 0, boundedLimit - 1)
    ]);

    return {
      items: values.flatMap((value) => {
        const parsed = parseJson<RunEventRecord>(value);
        return parsed ? [parsed] : [];
      }),
      count: Number(count)
    };
  }

  runResultKey(runId: string): string {
    return this.key.runResult(runId);
  }

  private async listByIndex<T>(
    indexKey: string,
    keyForId: (id: string) => string,
    limit: number
  ): Promise<T[]> {
    const ids = await this.redis.zrevrange(indexKey, 0, Math.max(0, limit - 1));
    if (ids.length === 0) return [];
    const values = await this.redis.mget(ids.map((id) => keyForId(id)));
    return values.flatMap((value) => {
      const parsed = parseJson<T>(value);
      return parsed ? [parsed] : [];
    });
  }
}
