import type { AnalysisType, EngineProfile } from "./api";

export type ModuleKey = "pricing" | "risk" | "sensitivity";

export interface ModuleDefinition {
  key: ModuleKey;
  title: string;
  clientTitle: string;
  shortLabel: string;
  analysisType: AnalysisType;
  description: string;
  detail: string;
  accent: string;
  defaultEngineProfile: EngineProfile;
}

export const MODULES: ModuleDefinition[] = [
  {
    key: "pricing",
    title: "Property-Cat Pricing YLT",
    clientTitle: "Catastrophe Pricing Analysis",
    shortLabel: "Pricing",
    analysisType: "pricing",
    description:
      "Run catastrophe pricing models to generate Year Loss Tables and key risk metrics for property-cat deal review.",
    detail:
      "Configure pricing assumptions, upload portfolio data, and receive loss distributions with summary percentiles.",
    accent: "#18a27a",
    defaultEngineProfile: "standard",
  },
  {
    key: "sensitivity",
    title: "ILS Parametric Trigger Simulator",
    clientTitle: "Bond Trigger Simulation",
    shortLabel: "Trigger Sim",
    analysisType: "sensitivity",
    description:
      "Simulate parametric trigger scenarios for ILS structures and analyze trigger probabilities and payout distributions.",
    detail:
      "Set trigger thresholds, select payout structures, and view event-level simulation outcomes.",
    accent: "#2f76d2",
    defaultEngineProfile: "full",
  },
];
