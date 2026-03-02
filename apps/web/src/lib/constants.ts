import type { EngineProfile, UploadInputRole } from "@/types/api";
import type { ModuleKey } from "@/types/modules";

export const POLL_INTERVAL_MS = 1500;

export const ENGINE_OPTIONS: EngineProfile[] = ["fast", "standard", "full"];

export const ENGINE_LABELS: Record<EngineProfile, string> = {
  fast: "Quick",
  standard: "Standard",
  full: "Comprehensive",
};

export const TAIL_METRIC_OPTIONS = [
  { value: "oep", label: "OEP (Occurrence)" },
  { value: "aep", label: "AEP (Aggregate)" },
] as const;

export const PRICING_LOSS_BASIS_OPTIONS = [
  { value: "net", label: "Net of Reinsurance" },
  { value: "gross", label: "Gross" },
  { value: "ceded", label: "Ceded" },
] as const;

export const PAYOUT_CURVE_OPTIONS = [
  { value: "linear", label: "Linear Ramp" },
  { value: "binary", label: "All-or-Nothing" },
  { value: "stepped", label: "Step Function" },
] as const;

export const TERMINAL_STATES = new Set<string>(["succeeded", "failed", "canceled"]);

export const MODULE_ROUTE_BY_KEY: Record<ModuleKey, string> = {
  pricing: "/property-cat-pricing",
  sensitivity: "/ils-parametric-trigger",
  risk: "/marginal-portfolio-impact",
};

export const UPLOAD_ROLE_OPTIONS: Array<{
  value: UploadInputRole | "";
  label: string;
}> = [
  { value: "", label: "Auto (infer)" },
  { value: "hurdat2", label: "Hurricane Track Data" },
  { value: "propertyPortfolio", label: "Property Portfolio" },
  { value: "baselinePortfolio", label: "Baseline Portfolio" },
  { value: "candidateDeal", label: "Candidate Deal" },
  { value: "catBondTerms", label: "Cat Bond Terms" },
];
