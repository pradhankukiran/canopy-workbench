import { z } from "zod";

export const sharedFormSchema = z.object({
  workspaceId: z
    .string()
    .min(1, "Workspace ID is required")
    .max(128, "Workspace ID is too long"),
  candidateDealId: z
    .string()
    .min(1, "Deal Identifier is required")
    .max(128, "Deal Identifier is too long"),
  engineProfile: z.enum(["fast", "standard", "full"]),
  randomSeed: z
    .string()
    .refine(
      (v) => v.trim() === "" || /^\d+$/.test(v.trim()),
      "Random seed must be a positive integer"
    ),
  includeYearOutcomes: z.boolean(),
  includeEventOutcomes: z.boolean(),
});
