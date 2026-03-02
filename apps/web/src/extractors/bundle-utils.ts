import type { PosteriorBundle, UploadInputRole } from "@/types/api";
import { isObject } from "@/lib/type-coercion";

export function getBundleField(
  bundle: PosteriorBundle,
  ...keys: string[]
): unknown {
  for (const key of keys) {
    const moduleOutputs = isObject(bundle.moduleOutputs)
      ? (bundle.moduleOutputs as Record<string, unknown>)
      : null;

    if (moduleOutputs && key in moduleOutputs) {
      return moduleOutputs[key];
    }

    const root = bundle as unknown as Record<string, unknown>;
    if (key in root) {
      return root[key];
    }
  }

  return undefined;
}

export function inferUploadRole(filename: string): UploadInputRole | "" {
  const lower = filename.trim().toLowerCase();
  if (!lower) return "";
  if (lower.endsWith(".hurdat2") || lower.includes("hurdat2")) return "hurdat2";
  if (lower.endsWith(".json")) {
    if (lower.includes("candidate")) return "candidateDeal";
    if (
      lower.includes("bond") ||
      lower.includes("catbond") ||
      lower.includes("cat_bond")
    )
      return "catBondTerms";
    if (lower.includes("property") && lower.includes("portfolio"))
      return "propertyPortfolio";
    if (lower.includes("portfolio")) return "baselinePortfolio";
  }
  return "";
}
