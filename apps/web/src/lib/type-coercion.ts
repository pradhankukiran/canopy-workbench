export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function maybeRatio(value: unknown): number | undefined {
  const numeric = asFiniteNumber(value);
  if (typeof numeric !== "number") {
    return undefined;
  }
  return numeric > 1 ? numeric / 100 : numeric;
}
