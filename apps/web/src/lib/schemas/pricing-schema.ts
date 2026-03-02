import { z } from "zod";
import { sharedFormSchema } from "./shared-schema";

const pricingFieldsSchema = z
  .object({
    simulatedYears: z
      .string()
      .refine(
        (v) => v.trim() === "" || /^\d+$/.test(v.trim()),
        "Must be a positive integer"
      )
      .refine(
        (v) => {
          const n = parseInt(v.trim(), 10);
          return v.trim() === "" || (n >= 100 && n <= 1_000_000);
        },
        "Must be between 100 and 1,000,000"
      ),
    returnPeriodsYearsCsv: z.string(),
    yltRowLimit: z
      .string()
      .refine(
        (v) => v.trim() === "" || /^\d+$/.test(v.trim()),
        "Must be a positive integer"
      ),
    lossBasis: z.enum(["net", "gross", "ceded"]),
    includeGrossNetBreakout: z.boolean(),
    includeSummaryPercentiles: z.boolean(),
    propertyPortfolioPath: z.string(),
    hurdat2Path: z.string(),
    useScalaEngine: z.boolean(),
    scalaEngineTimeoutMs: z
      .string()
      .refine(
        (v) => v.trim() === "" || /^\d+$/.test(v.trim()),
        "Must be a positive integer"
      ),
  });

export const pricingFormSchema = sharedFormSchema.extend({
  propertyCatPricingYlt: pricingFieldsSchema,
});

export type PricingFormErrors = Partial<
  Record<string, string[] | undefined> & {
    propertyCatPricingYlt: Partial<Record<string, string[] | undefined>>;
  }
>;
