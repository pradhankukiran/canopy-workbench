import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import cors from "@fastify/cors";
import Fastify, { type FastifyReply } from "fastify";
import { Queue } from "bullmq";
import IORedis from "ioredis";

import {
  DEFAULT_REDIS_PREFIX,
  DEFAULT_RUN_QUEUE_NAME,
  type JobRecord,
  type RunEventRecord,
  type RunRecord,
  type UploadRecord,
  RedisStateStore
} from "./state";

interface CreateUploadBody {
  workspaceId?: unknown;
  filename?: unknown;
  contentType?: unknown;
  sizeBytes?: unknown;
  contentText?: unknown;
}

interface CreateRunBody {
  workspaceId?: unknown;
  uploadId?: unknown;
  input?: unknown;
}

interface RunJobPayload {
  jobId: string;
  runId: string;
  workspaceId: string;
  uploadId?: string;
  input: Record<string, unknown>;
}

interface ApiConfig {
  port: number;
  host: string;
  redisUrl: string;
  redisPrefix: string;
  runQueueName: string;
  databaseUrl?: string;
  uploadDir: string;
}

type AnalysisType = "pricing" | "risk" | "sensitivity";

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readConfig(): ApiConfig {
  return {
    port: readIntEnv("API_PORT", readIntEnv("PORT", 3001)),
    host: process.env.API_HOST ?? "0.0.0.0",
    redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
    redisPrefix: process.env.CANOPY_REDIS_PREFIX ?? DEFAULT_REDIS_PREFIX,
    runQueueName: process.env.CANOPY_RUN_QUEUE ?? DEFAULT_RUN_QUEUE_NAME,
    databaseUrl: process.env.DATABASE_URL,
    uploadDir: process.env.CANOPY_UPLOAD_DIR ?? path.resolve(process.cwd(), "target/uploads")
  };
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function apiError(message: string, code = "api_error"): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

function sanitizeFilename(filename: string): string {
  const base = filename
    .trim()
    .replace(/[^\w.\-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base.length > 0 ? base.slice(0, 160) : "upload.dat";
}

function withForcedAnalysisType(
  body: unknown,
  analysisType?: AnalysisType
): Record<string, unknown> {
  const input = asObject(body) ?? {};
  if (!analysisType) {
    return input;
  }

  return {
    ...input,
    analysisType
  };
}

function resolveAnalysisType(input: Record<string, unknown>): AnalysisType | undefined {
  const analysisType = asNonEmptyString(input.analysisType);
  switch (analysisType) {
    case "pricing":
    case "risk":
    case "sensitivity":
      return analysisType;
    default:
      return undefined;
  }
}

function toApiUpload(upload: UploadRecord) {
  return {
    uploadId: upload.id,
    workspaceId: upload.workspaceId,
    filename: upload.filename,
    contentType: upload.contentType,
    bytes: upload.sizeBytes,
    status: upload.status === "ready" ? "uploaded" : "pending",
    storagePath: upload.storagePath,
    createdAt: upload.createdAt
  };
}

function toApiJob(job: JobRecord) {
  return {
    jobId: job.id,
    runId: job.runId,
    workspaceId: job.workspaceId,
    state: job.status,
    progress: typeof job.progress === "number" ? job.progress : undefined,
    submittedAt: job.queuedAt,
    updatedAt: job.updatedAt,
    ...(job.errorMessage
      ? {
          error: {
            code: "job_failed",
            message: job.errorMessage
          }
        }
      : {})
  };
}

function toApiRun(run: RunRecord) {
  const analysisType =
    typeof run.input.analysisType === "string" ? (run.input.analysisType as string) : undefined;
  const candidateDealId =
    typeof run.input.candidateDealId === "string"
      ? (run.input.candidateDealId as string)
      : undefined;

  return {
    runId: run.id,
    workspaceId: run.workspaceId,
    candidateDealId,
    jobId: run.jobId,
    state: run.status,
    analysisType,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    resultAvailable: run.resultReady
  };
}

function toApiRunEvent(event: RunEventRecord) {
  return {
    eventId: event.id,
    runId: event.runId,
    jobId: event.jobId,
    workspaceId: event.workspaceId,
    stage: event.stage,
    state: event.status,
    progress: typeof event.progress === "number" ? event.progress : undefined,
    message: event.message,
    createdAt: event.createdAt,
    ...(event.metadata ? { metadata: event.metadata } : {})
  };
}

async function main(): Promise<void> {
  const config = readConfig();
  const app = Fastify({ logger: true });
  const redis = new IORedis(config.redisUrl);
  const queue = new Queue<RunJobPayload>(config.runQueueName, { connection: redis });
  const store = await RedisStateStore.create(redis, config.redisPrefix, {
    databaseUrl: config.databaseUrl,
    serviceName: "@canopy/api",
    log: (level, message, meta) => {
      if (level === "error") {
        app.log.error(meta ?? {}, message);
        return;
      }
      if (level === "warn") {
        app.log.warn(meta ?? {}, message);
        return;
      }
      app.log.info(meta ?? {}, message);
    }
  });

  await app.register(cors, { origin: true });

  app.get("/health", async () => {
    const redisPing = await redis.ping();
    return {
      service: "@canopy/api",
      status: "ok",
      time: new Date().toISOString(),
      redis: redisPing,
      queue: config.runQueueName
    };
  });

  app.get("/api/v1/me", async () => ({
    userId: "usr_demo001",
    email: "demo@canopy.local",
    displayName: "Canopy Demo User",
    defaultWorkspaceId: "ws_demo001"
  }));

  app.get("/api/v1/workspaces", async () => ({
    items: [
      {
        workspaceId: "ws_demo001",
        name: "Demo Workspace",
        createdAt: "2026-01-01T00:00:00.000Z",
        createdByUserId: "usr_demo001"
      }
    ],
    page: { count: 1 }
  }));

  app.get("/api/v1/uploads", async () => {
    const items = await store.listUploads();
    return { items: items.map(toApiUpload), page: { count: items.length } };
  });

  app.post<{ Body: CreateUploadBody }>("/api/v1/uploads", async (request, reply) => {
    const now = new Date().toISOString();
    const workspaceId = asNonEmptyString(request.body?.workspaceId) ?? "ws_demo001";
    const filename = asNonEmptyString(request.body?.filename) ?? `upload-${randomUUID()}.json`;
    const contentType =
      asNonEmptyString(request.body?.contentType) ?? "application/octet-stream";
    const contentText =
      typeof request.body?.contentText === "string" ? request.body.contentText : undefined;
    const computedSizeBytes =
      typeof contentText === "string" ? Buffer.byteLength(contentText, "utf8") : undefined;
    const sizeBytes =
      typeof request.body?.sizeBytes === "number" && Number.isFinite(request.body.sizeBytes)
        ? Math.max(0, Math.floor(request.body.sizeBytes))
        : computedSizeBytes ?? 0;
    const uploadId = newId("upl");
    let storagePath: string | undefined;

    if (typeof contentText === "string") {
      await fs.mkdir(config.uploadDir, { recursive: true });
      const safeName = sanitizeFilename(filename);
      const filePath = path.resolve(config.uploadDir, `${uploadId}-${safeName}`);
      await fs.writeFile(filePath, contentText, "utf8");
      storagePath = filePath;
    }

    const upload: UploadRecord = {
      id: uploadId,
      workspaceId,
      filename,
      contentType,
      sizeBytes,
      status: "ready",
      storagePath,
      createdAt: now,
      updatedAt: now
    };

    await store.saveUpload(upload);

    return reply.code(201).send(toApiUpload(upload));
  });

  app.get("/api/v1/jobs", async () => {
    const items = await store.listJobs();
    return { items: items.map(toApiJob), page: { count: items.length } };
  });

  app.get<{ Params: { jobId: string } }>("/api/v1/jobs/:jobId", async (request, reply) => {
    const job = await store.getJob(request.params.jobId);
    if (!job) {
      return reply.code(404).send(apiError(`Job ${request.params.jobId} not found`, "not_found"));
    }
    return toApiJob(job);
  });

  app.get("/api/v1/runs", async () => {
    const items = await store.listRuns();
    return { items: items.map(toApiRun), page: { count: items.length } };
  });

  const submitRun = async (
    request: { body?: CreateRunBody },
    reply: FastifyReply,
    options?: { forceAnalysisType?: AnalysisType }
  ) => {
    const now = new Date().toISOString();
    const workspaceId = asNonEmptyString(request.body?.workspaceId) ?? "ws_demo001";
    const uploadId = asNonEmptyString(request.body?.uploadId);
    const input = withForcedAnalysisType(request.body, options?.forceAnalysisType);
    const analysisType = resolveAnalysisType(input);

    if (!analysisType) {
      return reply.code(400).send(
        apiError(
          "A supported analysisType is required. Allowed values: pricing, sensitivity, or risk.",
          "invalid_analysis_type"
        )
      );
    }

    if (analysisType === "risk") {
      return reply.code(400).send(
        apiError(
          "Marginal Portfolio Impact is disabled because its current engine still relies on synthetic heuristics.",
          "unsupported_analysis_type"
        )
      );
    }

    const jobId = newId("job");
    const runId = newId("run");

    const job: JobRecord = {
      id: jobId,
      runId,
      workspaceId,
      queueName: config.runQueueName,
      bullJobId: jobId,
      status: "queued",
      progress: 0,
      createdAt: now,
      updatedAt: now,
      queuedAt: now
    };

    const run: RunRecord = {
      id: runId,
      jobId,
      workspaceId,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      submittedAt: now,
      resultReady: false,
      input
    };

    await store.saveJobAndRun(job, run);
    await store.appendRunEvent({
      runId,
      jobId,
      workspaceId,
      stage: "submitted",
      status: "queued",
      progress: 0,
      message: "Run submitted",
      metadata: uploadId ? { uploadId } : undefined
    });
    app.log.info({ runId, jobId, workspaceId }, "run submitted");

    try {
      await queue.add(
        "run.execute",
        {
          jobId,
          runId,
          workspaceId,
          uploadId,
          input
        },
        {
          jobId,
          removeOnComplete: 500,
          removeOnFail: 500
        }
      );

      job.progress = 0.05;
      job.updatedAt = new Date().toISOString();
      await Promise.all([
        store.saveJob(job),
        store.appendRunEvent({
          runId,
          jobId,
          workspaceId,
          stage: "queued",
          status: "queued",
          progress: job.progress,
          message: "Run queued for worker"
        })
      ]);
      app.log.info({ runId, jobId, queue: config.runQueueName }, "run queued");
    } catch (error) {
      const failedAt = new Date().toISOString();
      const message = error instanceof Error ? error.message : "Failed to enqueue run";
      job.status = "failed";
      job.updatedAt = failedAt;
      job.completedAt = failedAt;
      job.errorMessage = message;
      run.status = "failed";
      run.updatedAt = failedAt;
      run.completedAt = failedAt;
      await Promise.all([store.saveJob(job), store.saveRun(run)]);
      await store.appendRunEvent({
        runId,
        jobId,
        workspaceId,
        stage: "failed",
        status: "failed",
        progress: job.progress,
        message: "Failed to enqueue run",
        metadata: { error: message }
      });
      app.log.error({ runId, jobId, error: message }, "run enqueue failed");
    }

    return reply.code(202).send({
      job: toApiJob(job),
      run: toApiRun(run)
    });
  };

  app.post<{ Body: CreateRunBody }>("/api/v1/runs", async (request, reply) =>
    submitRun(request, reply)
  );

  app.post<{ Body: CreateRunBody }>("/api/v1/property-cat-pricing/runs", async (request, reply) =>
    submitRun(request, reply, { forceAnalysisType: "pricing" })
  );

  app.post<{ Body: CreateRunBody }>("/api/v1/ils-parametric-trigger/runs", async (request, reply) =>
    submitRun(request, reply, { forceAnalysisType: "sensitivity" })
  );

  app.post<{ Body: CreateRunBody }>(
    "/api/v1/marginal-portfolio-impact/runs",
    async (request, reply) => submitRun(request, reply, { forceAnalysisType: "risk" })
  );

  app.get<{ Params: { runId: string } }>("/api/v1/runs/:runId", async (request, reply) => {
    const run = await store.getRun(request.params.runId);
    if (!run) {
      return reply.code(404).send(apiError(`Run ${request.params.runId} not found`, "not_found"));
    }
    return toApiRun(run);
  });

  app.get<{ Params: { runId: string } }>("/api/v1/runs/:runId/events", async (request, reply) => {
    const run = await store.getRun(request.params.runId);
    if (!run) {
      return reply.code(404).send(apiError(`Run ${request.params.runId} not found`, "not_found"));
    }

    const page = await store.getRunEventsPage(request.params.runId);
    return {
      items: page.items.map(toApiRunEvent),
      page: { count: page.count }
    };
  });

  app.get<{ Params: { runId: string } }>(
    "/api/v1/runs/:runId/results",
    async (request, reply) => {
      const run = await store.getRun(request.params.runId);
      if (!run) {
        return reply.code(404).send(apiError(`Run ${request.params.runId} not found`, "not_found"));
      }

      const result = await store.getRunResult(request.params.runId);
      if (!result) {
        return reply
          .code(409)
          .send(apiError(`Results not available for run ${request.params.runId}`, "results_pending"));
      }

      return result;
    }
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "shutting down");
    await Promise.allSettled([
      app.close(),
      store.close(),
      queue.close(),
      redis.quit().catch(() => undefined)
    ]);
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ host: config.host, port: config.port });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
