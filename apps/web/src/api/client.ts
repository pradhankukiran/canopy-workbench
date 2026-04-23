import type {
  ApiErrorEnvelope,
  CreateUploadRequest,
  JobRecord,
  PosteriorBundle,
  RunEventRecord,
  RunEventsResponse,
  RunRecord,
  RunRequest,
  RunSubmission,
  UploadRecord,
} from "@/types/api";
import { isObject, asString, asFiniteNumber } from "@/lib/type-coercion";

const DEFAULT_API_BASE_URL = "http://localhost:3001";

function normalizeBaseUrl(raw: string | undefined): string {
  const value = raw?.trim() ?? "";
  const base = value.length > 0 ? value : DEFAULT_API_BASE_URL;
  return base.replace(/\/+$/, "");
}

export const API_BASE_URL = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
const API_PREFIX = `${API_BASE_URL}/api/v1`;

export class ApiHttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly body: unknown;

  constructor(
    message: string,
    options: { status: number; statusText: string; body?: unknown }
  ) {
    super(message);
    this.name = "ApiHttpError";
    this.status = options.status;
    this.statusText = options.statusText;
    this.body = options.body;
  }
}

function normalizeRunEventRecord(value: unknown): RunEventRecord | null {
  if (!isObject(value)) return null;

  const message =
    asString(value.message) ??
    asString(value.msg) ??
    asString(value.description) ??
    asString(value.detail);

  const details = isObject(value.details)
    ? value.details
    : isObject(value.data)
      ? value.data
      : undefined;

  return {
    eventId: asString(value.eventId) ?? asString(value.id),
    runId: asString(value.runId),
    jobId: asString(value.jobId),
    type:
      asString(value.type) ?? asString(value.eventType) ?? asString(value.kind),
    stage: asString(value.stage) ?? asString(value.step),
    state: asString(value.state) ?? asString(value.status),
    level: asString(value.level) ?? asString(value.severity),
    message: message ?? "Run event",
    progress: asFiniteNumber(value.progress),
    sequence:
      asFiniteNumber(value.sequence) ??
      asFiniteNumber(value.index) ??
      asFiniteNumber(value.order),
    createdAt:
      asString(value.createdAt) ??
      asString(value.timestamp) ??
      asString(value.time) ??
      asString(value.at),
    details,
  };
}

function normalizeRunEventsResponse(body: unknown): RunEventsResponse {
  const rawItems = Array.isArray(body)
    ? body
    : isObject(body) && Array.isArray(body.items)
      ? body.items
      : isObject(body) && Array.isArray(body.events)
        ? body.events
        : [];

  const items = rawItems
    .map((item) => normalizeRunEventRecord(item))
    .filter((item): item is RunEventRecord => item !== null)
    .sort((a, b) => {
      const aSeq =
        typeof a.sequence === "number" ? a.sequence : Number.POSITIVE_INFINITY;
      const bSeq =
        typeof b.sequence === "number" ? b.sequence : Number.POSITIVE_INFINITY;
      if (aSeq !== bSeq) return aSeq - bSeq;

      const aTime = a.createdAt ? Date.parse(a.createdAt) : Number.NaN;
      const bTime = b.createdAt ? Date.parse(b.createdAt) : Number.NaN;
      const aTimeSafe = Number.isFinite(aTime)
        ? aTime
        : Number.POSITIVE_INFINITY;
      const bTimeSafe = Number.isFinite(bTime)
        ? bTime
        : Number.POSITIVE_INFINITY;
      if (aTimeSafe !== bTimeSafe) return aTimeSafe - bTimeSafe;

      return (a.message ?? "").localeCompare(b.message ?? "");
    });

  return { items };
}

function readApiErrorMessage(body: unknown): string | null {
  if (!isObject(body)) return null;
  const maybeEnvelope = body as ApiErrorEnvelope;
  const message = maybeEnvelope.error?.message;
  return typeof message === "string" && message.length > 0 ? message : null;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return response.json();
  const text = await response.text();
  return text.length > 0 ? text : null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (init?.body && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");

  const response = await fetch(`${API_PREFIX}${path}`, { ...init, headers });
  const body = await parseResponseBody(response);

  if (!response.ok) {
    const message =
      readApiErrorMessage(body) ??
      `Request failed (${response.status} ${response.statusText})`;
    throw new ApiHttpError(message, {
      status: response.status,
      statusText: response.statusText,
      body,
    });
  }

  return body as T;
}

export function submitRun(payload: RunRequest): Promise<RunSubmission> {
  return request<RunSubmission>("/runs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

function submitPathForAnalysisType(
  analysisType: RunRequest["analysisType"]
): string {
  switch (analysisType) {
    case "pricing":
      return "/property-cat-pricing/runs";
    case "sensitivity":
      return "/ils-parametric-trigger/runs";
    case "risk":
      throw new Error(
        "Marginal Portfolio Impact is disabled because its current engine still relies on synthetic heuristics."
      );
    default:
      return "/runs";
  }
}

export function submitModuleRun(payload: RunRequest): Promise<RunSubmission> {
  return request<RunSubmission>(
    submitPathForAnalysisType(payload.analysisType),
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
}

export function createUpload(
  payload: CreateUploadRequest
): Promise<UploadRecord> {
  return request<UploadRecord>("/uploads", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getRun(runId: string): Promise<RunRecord> {
  return request<RunRecord>(`/runs/${encodeURIComponent(runId)}`);
}

export function getJob(jobId: string): Promise<JobRecord> {
  return request<JobRecord>(`/jobs/${encodeURIComponent(jobId)}`);
}

export function getRunResults(runId: string): Promise<PosteriorBundle> {
  return request<PosteriorBundle>(
    `/runs/${encodeURIComponent(runId)}/results`
  );
}

export async function getRunEvents(
  runId: string
): Promise<RunEventsResponse> {
  const body = await request<unknown>(
    `/runs/${encodeURIComponent(runId)}/events`
  );
  return normalizeRunEventsResponse(body);
}

export interface DataArtifactStatus {
  id: string;
  kind: string;
  state: "ready" | "missing" | "unavailable";
  description: string;
  url: string;
  license: string;
  approximateMb: number;
  path?: string;
  sizeBytes?: number;
  sha256?: string;
  reason?: string;
}

export interface DataSourcesSummary {
  cacheDir: string;
  artifacts: DataArtifactStatus[];
}

export function getDataSources(): Promise<DataSourcesSummary> {
  return request<DataSourcesSummary>("/data-sources");
}
