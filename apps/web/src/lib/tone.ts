import { asString } from "./type-coercion";

export type StatusTone = "neutral" | "running" | "success" | "error";
export type EventTone = "neutral" | "running" | "success" | "warn" | "error";

export function statusTone(state: string | undefined): StatusTone {
  if (state === "succeeded" || state === "registered") return "success";
  if (state === "failed" || state === "canceled") return "error";
  if (
    state === "running" ||
    state === "validating" ||
    state === "queued" ||
    state === "registering"
  )
    return "running";
  return "neutral";
}

export function eventTone(level: string | undefined): EventTone {
  const normalized = level?.toLowerCase();
  if (!normalized) return "neutral";
  if (normalized === "error" || normalized === "fatal") return "error";
  if (normalized === "warn" || normalized === "warning") return "warn";
  if (
    normalized === "success" ||
    normalized === "completed" ||
    normalized === "succeeded"
  )
    return "success";
  if (
    normalized === "info" ||
    normalized === "debug" ||
    normalized === "queued" ||
    normalized === "running" ||
    normalized === "validating"
  )
    return "running";
  return "neutral";
}

export function normalizeTailMetricLabel(value: unknown): string | undefined {
  const metric = asString(value)?.trim();
  if (!metric) return undefined;
  return metric.toUpperCase();
}
