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

export interface RedisWorkerStateStoreOptions {
  databaseUrl?: string;
  serviceName?: string;
  log?: LogFn;
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function clampProgress(progress: number | undefined): number | undefined {
  if (typeof progress !== "number" || Number.isNaN(progress)) return undefined;
  return Math.max(0, Math.min(1, progress));
}

function eventId(): string {
  return `evt_${randomUUID().replace(/-/g, "")}`;
}

class PostgresPersistence {
  private constructor(private readonly pool: Pool) {}

  static async create(options: RedisWorkerStateStoreOptions = {}): Promise<PostgresPersistence | null> {
    const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
    if (!databaseUrl) return null;

    const log = options.log ?? (() => undefined);
    const serviceName = options.serviceName ?? "@canopy/worker";
    const pool = new Pool({ connectionString: databaseUrl });
    const persistence = new PostgresPersistence(pool);

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
    const row = result.rows[0];
    if (!row) return null;
    return typeof row.data === "string" ? (JSON.parse(row.data) as JobRecord) : (row.data as JobRecord);
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    const result = await this.pool.query<{ data: unknown }>(
      "select data from canopy_phase1_runs where run_id = $1 limit 1",
      [runId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return typeof row.data === "string" ? (JSON.parse(row.data) as RunRecord) : (row.data as RunRecord);
  }
}

export class RedisWorkerStateStore {
  private readonly log: LogFn;
  private readonly postgres: PostgresPersistence | null;

  static async create(
    redis: Redis,
    prefix = DEFAULT_REDIS_PREFIX,
    options: RedisWorkerStateStoreOptions = {}
  ): Promise<RedisWorkerStateStore> {
    const postgres = await PostgresPersistence.create(options);
    return new RedisWorkerStateStore(redis, prefix, postgres, options.log);
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
    runEvents: (runId: string) => `${this.prefix}:runs:${runId}:events`,
    runResult: (runId: string) => `${this.prefix}:runs:${runId}:result`,
    upload: (uploadId: string) => `${this.prefix}:uploads:${uploadId}`
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

  async getJob(jobId: string): Promise<JobRecord | null> {
    const redisJob = parseJson<JobRecord>(await this.redis.get(this.key.job(jobId)));
    if (redisJob) return redisJob;
    return this.readFromPostgres("getJob", (postgres) => postgres.getJob(jobId));
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    const redisRun = parseJson<RunRecord>(await this.redis.get(this.key.run(runId)));
    if (redisRun) return redisRun;
    return this.readFromPostgres("getRun", (postgres) => postgres.getRun(runId));
  }

  async getUpload(uploadId: string): Promise<UploadRecord | null> {
    return parseJson<UploadRecord>(await this.redis.get(this.key.upload(uploadId)));
  }

  async updateStatus(params: {
    jobId: string;
    runId: string;
    status: LifecycleStatus;
    progress?: number;
    errorMessage?: string;
    stage?: RunEventStage;
    message?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const [job, run] = await Promise.all([this.getJob(params.jobId), this.getRun(params.runId)]);
    if (!job || !run) {
      throw new Error(`Missing job/run state for ${params.jobId}/${params.runId}`);
    }

    const now = new Date().toISOString();
    job.status = params.status;
    job.updatedAt = now;
    const progress = clampProgress(params.progress);
    if (typeof progress === "number") {
      job.progress = progress;
    }
    if (params.status === "running" && !job.startedAt) job.startedAt = now;
    if (params.status === "succeeded" || params.status === "failed") job.completedAt = now;
    if (params.errorMessage) {
      job.errorMessage = params.errorMessage;
    } else if (params.status !== "failed") {
      delete job.errorMessage;
    }

    run.status = params.status;
    run.updatedAt = now;
    if (params.status === "running" && !run.startedAt) run.startedAt = now;
    if (params.status === "succeeded" || params.status === "failed") run.completedAt = now;

    const event: RunEventRecord | null = params.stage
      ? {
          id: eventId(),
          runId: run.id,
          jobId: job.id,
          workspaceId: run.workspaceId,
          stage: params.stage,
          status: params.status,
          createdAt: now,
          message: params.message,
          progress,
          metadata: params.metadata
        }
      : null;

    const tx = this.redis.multi();
    tx.set(this.key.job(job.id), JSON.stringify(job));
    tx.set(this.key.run(run.id), JSON.stringify(run));
    if (event) {
      tx.rpush(this.key.runEvents(run.id), JSON.stringify(event));
    }
    await tx.exec();

    await this.mirrorWrite("updateStatus", async (postgres) => {
      await Promise.all([
        postgres.upsertJob(job),
        postgres.upsertRun(run),
        event ? postgres.appendRunEvent(event) : Promise.resolve()
      ]);
    });
  }

  async completeWithResult(params: {
    jobId: string;
    runId: string;
    result: RunResultRecord;
    message?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const [job, run] = await Promise.all([this.getJob(params.jobId), this.getRun(params.runId)]);
    if (!job || !run) {
      throw new Error(`Missing job/run state for ${params.jobId}/${params.runId}`);
    }

    const now = new Date().toISOString();
    job.status = "succeeded";
    job.updatedAt = now;
    job.completedAt = now;
    job.progress = 1;
    if (!job.startedAt) job.startedAt = now;
    delete job.errorMessage;

    run.status = "succeeded";
    run.updatedAt = now;
    run.completedAt = now;
    if (!run.startedAt) run.startedAt = now;
    run.resultReady = true;
    run.resultKey = this.key.runResult(params.runId);

    const completionEvent: RunEventRecord = {
      id: eventId(),
      runId: run.id,
      jobId: job.id,
      workspaceId: run.workspaceId,
      stage: "completed",
      status: "succeeded",
      createdAt: now,
      message: params.message ?? "Run completed",
      progress: 1,
      metadata: params.metadata
    };

    const tx = this.redis.multi();
    tx.set(this.key.job(job.id), JSON.stringify(job));
    tx.set(this.key.run(run.id), JSON.stringify(run));
    tx.set(this.key.runResult(params.runId), JSON.stringify(params.result));
    tx.rpush(this.key.runEvents(run.id), JSON.stringify(completionEvent));
    await tx.exec();

    await this.mirrorWrite("completeWithResult", async (postgres) => {
      await Promise.all([
        postgres.upsertJob(job),
        postgres.upsertRun(run),
        postgres.upsertRunResult(params.runId, params.result),
        postgres.appendRunEvent(completionEvent)
      ]);
    });
  }
}
