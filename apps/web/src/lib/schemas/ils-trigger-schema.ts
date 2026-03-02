import { z } from "zod";
import { sharedFormSchema } from "./shared-schema";

const ilsTriggerFieldsSchema = z
  .object({
    triggerIndexName: z
      .string()
      .min(1, "Trigger index is required"),
    regionCode: z
      .string()
      .min(1, "Region is required"),
    perilCode: z
      .string()
      .min(1, "Peril is required"),
    attachmentThreshold: z
      .string()
      .refine(
        (v) => v.trim() !== "" && !isNaN(Number(v.trim())),
        "Trigger point must be a number"
      ),
    exhaustionThreshold: z
      .string()
      .refine(
        (v) => v.trim() !== "" && !isNaN(Number(v.trim())),
        "Full payout point must be a number"
      ),
    payoutCurve: z.enum(["linear", "binary", "stepped"]),
    simulationCount: z
      .string()
      .refine(
        (v) => v.trim() === "" || /^\d+$/.test(v.trim()),
        "Must be a positive integer"
      ),
    includeEventLevelOutcomes: z.boolean(),
    hurdat2Path: z.string(),
    useScalaEngine: z.boolean(),
    scalaEngineTimeoutMs: z
      .string()
      .refine(
        (v) => v.trim() === "" || /^\d+$/.test(v.trim()),
        "Must be a positive integer"
      ),
  })
  .refine(
    (data) => {
      const att = Number(data.attachmentThreshold.trim());
      const exh = Number(data.exhaustionThreshold.trim());
      if (isNaN(att) || isNaN(exh)) return true;
      return exh > att;
    },
    {
      message: "Full payout point must be greater than trigger point",
      path: ["exhaustionThreshold"],
    }
  );

export const ilsTriggerFormSchema = sharedFormSchema.extend({
  ilsParametricTriggerSimulator: ilsTriggerFieldsSchema,
});
