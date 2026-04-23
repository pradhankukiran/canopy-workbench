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
import {
  extractBearerToken,
  generateApiKey,
  hashApiKey,
  looksLikeApiKey,
  prefixOf,
  verifyApiKey,
  type Principal
} from "./auth";
import {
  extractEmbeddedPropertyPortfolio,
  validatePropertyPortfolio,
  type ValidationFailure
} from "./validation";
import { summarizeDataSources } from "./data-sources";

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
  allowAnonymous: boolean;
  demoWorkspaceId: string;
  demoUserId: string;
  bootstrapApiKey?: string;
  bootstrapWorkspaceId?: string;
  bootstrapUserId?: string;
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
  const allowAnonymousEnv = process.env.CANOPY_ALLOW_ANONYMOUS;
  // Default: allow anonymous in development (demo) mode. Set to "false"/"0"
  // in production to force every request through API-key auth.
  const allowAnonymous = allowAnonymousEnv
    ? !["0", "false", "no"].includes(allowAnonymousEnv.toLowerCase())
    : true;

  return {
    port: readIntEnv("API_PORT", readIntEnv("PORT", 3001)),
    host: process.env.API_HOST ?? "0.0.0.0",
    redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
    redisPrefix: process.env.CANOPY_REDIS_PREFIX ?? DEFAULT_REDIS_PREFIX,
    runQueueName: process.env.CANOPY_RUN_QUEUE ?? DEFAULT_RUN_QUEUE_NAME,
    databaseUrl: process.env.DATABASE_URL,
    uploadDir: process.env.CANOPY_UPLOAD_DIR ?? path.resolve(process.cwd(), "target/uploads"),
    allowAnonymous,
    demoWorkspaceId: process.env.CANOPY_DEMO_WORKSPACE_ID ?? "ws_demo001",
    demoUserId: process.env.CANOPY_DEMO_USER_ID ?? "usr_demo001",
    bootstrapApiKey: process.env.CANOPY_BOOTSTRAP_API_KEY,
    bootstrapWorkspaceId: process.env.CANOPY_BOOTSTRAP_WORKSPACE_ID,
    bootstrapUserId: process.env.CANOPY_BOOTSTRAP_USER_ID
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

function summarizeViolations(
  errors: ValidationFailure[],
  maxReported = 20
): Array<{ path: string; message: string; keyword: string }> {
  return errors.slice(0, maxReported).map((e) => ({
    path: e.path,
    message: e.message,
    keyword: e.keyword
  }));
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

  // Optional one-time seed of a bootstrap API key so a fresh deployment can
  // make authenticated calls without running a separate migration step.
  // Set CANOPY_BOOTSTRAP_API_KEY to a ck_-prefixed string in the environment;
  // it is upserted (idempotent) against the supplied workspace/user ids.
  if (config.bootstrapApiKey && looksLikeApiKey(config.bootstrapApiKey)) {
    try {
      const workspaceId = config.bootstrapWorkspaceId ?? config.demoWorkspaceId;
      const userId = config.bootstrapUserId ?? config.demoUserId;
      const { hash, salt } = hashApiKey(config.bootstrapApiKey);
      await store.upsertApiKey({
        keyId: `key_bootstrap_${prefixOf(config.bootstrapApiKey).replace(/[^a-zA-Z0-9_]/g, "")}`,
        workspaceId,
        userId,
        name: "bootstrap",
        keyPrefix: prefixOf(config.bootstrapApiKey),
        keyHash: hash,
        keySalt: salt,
        createdAt: new Date().toISOString()
      });
      app.log.info({ workspaceId, userId, keyPrefix: prefixOf(config.bootstrapApiKey) }, "bootstrap api key upserted");
    } catch (error) {
      app.log.warn({ err: error instanceof Error ? error.message : String(error) }, "bootstrap api key upsert failed");
    }
  }

  // Populate request.principal on every request. Paths in AUTH_EXEMPT are
  // skipped. When a token is present it must validate; when absent, we fall
  // back to an anonymous demo principal if allowAnonymous=true, or 401
  // otherwise. The principal is the authoritative source of workspaceId /
  // userId in downstream handlers.
  const AUTH_EXEMPT = new Set<string>(["/health"]);
  app.decorateRequest("principal", null);
  app.addHook("preHandler", async (request, reply) => {
    if (AUTH_EXEMPT.has(request.routeOptions.url ?? request.url)) return;

    const token = extractBearerToken(request.headers as Record<string, string | string[] | undefined>);

    if (token && looksLikeApiKey(token)) {
      const prefix = prefixOf(token);
      const candidates = await store.findApiKeysByPrefix(prefix);
      for (const candidate of candidates) {
        if (candidate.revokedAt) continue;
        if (candidate.expiresAt && new Date(candidate.expiresAt) < new Date()) continue;
        if (verifyApiKey(token, candidate.keyHash, candidate.keySalt)) {
          (request as { principal?: Principal }).principal = {
            userId: candidate.userId,
            workspaceId: candidate.workspaceId,
            keyId: candidate.keyId,
            keyName: candidate.name ?? undefined,
            source: "api_key"
          };
          void store.touchApiKeyLastUsed(candidate.keyId, new Date().toISOString());
          return;
        }
      }
      return reply.code(401).send(apiError("Invalid or revoked API key", "invalid_api_key"));
    }

    if (token) {
      // Provided a token but it didn't look like one of our keys.
      return reply.code(401).send(apiError("Malformed API key", "invalid_api_key"));
    }

    if (!config.allowAnonymous) {
      return reply.code(401).send(apiError("Authentication required", "auth_required"));
    }

    (request as { principal?: Principal }).principal = {
      userId: config.demoUserId,
      workspaceId: config.demoWorkspaceId,
      keyId: "anonymous",
      source: "anonymous"
    };
  });

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

  app.get("/api/v1/data-sources", async () => {
    return summarizeDataSources();
  });

  app.get("/api/v1/me", async (request) => {
    const principal = (request as { principal?: Principal }).principal;
    return {
      userId: principal?.userId ?? config.demoUserId,
      email: principal?.source === "api_key" ? undefined : "demo@canopy.local",
      displayName: principal?.source === "api_key" ? principal.keyName ?? "API key" : "Canopy Demo User",
      defaultWorkspaceId: principal?.workspaceId ?? config.demoWorkspaceId,
      authSource: principal?.source ?? "anonymous"
    };
  });

  app.get("/api/v1/workspaces", async (request) => {
    const principal = (request as { principal?: Principal }).principal;
    const workspaceId = principal?.workspaceId ?? config.demoWorkspaceId;
    return {
      items: [
        {
          workspaceId,
          name: workspaceId === config.demoWorkspaceId ? "Demo Workspace" : workspaceId,
          createdAt: "2026-01-01T00:00:00.000Z",
          createdByUserId: principal?.userId ?? config.demoUserId
        }
      ],
      page: { count: 1 }
    };
  });

  app.get("/api/v1/uploads", async () => {
    const items = await store.listUploads();
    return { items: items.map(toApiUpload), page: { count: items.length } };
  });

  app.post<{ Body: CreateUploadBody }>("/api/v1/uploads", async (request, reply) => {
    const now = new Date().toISOString();
    const principal = (request as { principal?: Principal }).principal;
    const workspaceId =
      principal?.workspaceId ?? asNonEmptyString(request.body?.workspaceId) ?? config.demoWorkspaceId;
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

    if (typeof contentText === "string" && storagePath) {
      await fs.writeFile(storagePath, contentText, "utf8");
    }

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
    request: { body?: CreateRunBody; principal?: Principal },
    reply: FastifyReply,
    options?: { forceAnalysisType?: AnalysisType }
  ) => {
    const now = new Date().toISOString();
    // The principal is always set by the preHandler (either from a valid
    // API key or the anonymous fallback). Handlers trust principal.workspaceId
    // unconditionally; body.workspaceId is ignored to prevent tenant spoofing.
    const workspaceId = request.principal?.workspaceId ?? config.demoWorkspaceId;
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

    if (analysisType === "pricing") {
      const embeddedPortfolio = extractEmbeddedPropertyPortfolio(input);
      if (embeddedPortfolio !== undefined) {
        const result = validatePropertyPortfolio(embeddedPortfolio);
        if (!result.ok) {
          return reply.code(400).send({
            error: {
              code: "invalid_property_portfolio",
              message: "Embedded property portfolio did not validate against the v2 schema.",
              violations: summarizeViolations(result.errors)
            }
          });
        }
      }
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
