import type { RunFormState, PropertyCatPricingYltFormState } from "@/types/forms";
import type { FormFieldErrors } from "@/hooks/use-workflow";
import { PRICING_LOSS_BASIS_OPTIONS } from "@/lib/constants";
import { HelpTooltip } from "@/components/shared/help-tooltip";
import { FieldError } from "@/components/shared/field-error";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

interface PricingFormProps {
  form: RunFormState;
  setForm: React.Dispatch<React.SetStateAction<RunFormState>>;
  fieldErrors?: FormFieldErrors;
  clearFieldError?: (path: string) => void;
}

function updatePricing(
  setForm: React.Dispatch<React.SetStateAction<RunFormState>>,
  key: keyof PropertyCatPricingYltFormState,
  value: PropertyCatPricingYltFormState[keyof PropertyCatPricingYltFormState]
) {
  setForm((current) => ({
    ...current,
    propertyCatPricingYlt: {
      ...current.propertyCatPricingYlt,
      [key]: value,
    },
  }));
}

export function PricingForm({ form, setForm, fieldErrors = {}, clearFieldError }: PricingFormProps) {
  const [overridesOpen, setOverridesOpen] = useState(false);
  const pf = form.propertyCatPricingYlt;
  const err = (field: string) => fieldErrors[`propertyCatPricingYlt.${field}`];
  const errCls = (field: string) => err(field) ? "border-destructive" : "";

  return (
    <section className="mt-4 rounded-lg border border-border bg-muted/30 p-4">
      <h4 className="mb-1 text-sm font-semibold">
        Pricing Parameters
      </h4>
      <p className="mb-3 text-xs text-muted-foreground">
        Configure the catastrophe pricing model inputs.
      </p>

      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        <label className="grid gap-1.5 text-sm">
          <span className="flex items-center gap-1 font-semibold text-foreground/80">
            Simulated Years
            <HelpTooltip content="Number of years to simulate. More years improve statistical confidence but increase runtime." />
          </span>
          <input
            className={`rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2 ${errCls("simulatedYears")}`}
            inputMode="numeric"
            value={pf.simulatedYears}
            onChange={(e) => {
              updatePricing(setForm, "simulatedYears", e.target.value);
              clearFieldError?.("propertyCatPricingYlt.simulatedYears");
            }}
            placeholder="10000"
          />
          <FieldError errors={err("simulatedYears")} />
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="flex items-center gap-1 font-semibold text-foreground/80">
            Maximum Results Rows
            <HelpTooltip content="Limits the number of rows returned in the Year Loss Table output." />
          </span>
          <input
            className={`rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2 ${errCls("yltRowLimit")}`}
            inputMode="numeric"
            value={pf.yltRowLimit}
            onChange={(e) => {
              updatePricing(setForm, "yltRowLimit", e.target.value);
              clearFieldError?.("propertyCatPricingYlt.yltRowLimit");
            }}
            placeholder="25"
          />
          <FieldError errors={err("yltRowLimit")} />
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="flex items-center gap-1 font-semibold text-foreground/80">
            Return Periods (years)
            <HelpTooltip content="Comma-separated list of return periods for the loss exceedance curve (e.g., 10, 50, 100, 250)." />
          </span>
          <input
            className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
            value={pf.returnPeriodsYearsCsv}
            onChange={(e) =>
              updatePricing(
                setForm,
                "returnPeriodsYearsCsv",
                e.target.value
              )
            }
            placeholder="10, 20, 50, 100"
          />
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="flex items-center gap-1 font-semibold text-foreground/80">
            Loss Perspective
            <HelpTooltip content="Net: after reinsurance. Gross: before reinsurance. Ceded: amount transferred to reinsurers." />
          </span>
          <select
            className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
            value={pf.lossBasis}
            onChange={(e) =>
              updatePricing(
                setForm,
                "lossBasis",
                e.target.value as "net" | "gross" | "ceded"
              )
            }
          >
            {PRICING_LOSS_BASIS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-4 text-sm">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            className="accent-primary"
            checked={pf.includeGrossNetBreakout}
            onChange={(e) =>
              updatePricing(
                setForm,
                "includeGrossNetBreakout",
                e.target.checked
              )
            }
          />
          Include gross/net breakout
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            className="accent-primary"
            checked={pf.includeSummaryPercentiles}
            onChange={(e) =>
              updatePricing(
                setForm,
                "includeSummaryPercentiles",
                e.target.checked
              )
            }
          />
          Include summary percentiles
        </label>
      </div>

      <div className="mt-3 rounded-lg border border-border bg-card/50">
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2.5 text-xs font-semibold text-foreground/60 hover:text-foreground"
          onClick={() => setOverridesOpen(!overridesOpen)}
        >
          File overrides & engine options
          <ChevronDown
            className={`ml-auto h-3.5 w-3.5 transition-transform ${overridesOpen ? "rotate-180" : ""}`}
          />
        </button>
        {overridesOpen && (
          <div className="border-t border-border px-3 py-3">
            <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
              <label className="grid gap-1.5 text-sm">
                <span className="font-semibold text-foreground/80">
                  Property Portfolio Path
                </span>
                <input
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
                  value={pf.propertyPortfolioPath}
                  onChange={(e) =>
                    updatePricing(
                      setForm,
                      "propertyPortfolioPath",
                      e.target.value
                    )
                  }
                  placeholder="Auto-populated from uploads"
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-semibold text-foreground/80">
                  Hurricane Track Data Path
                </span>
                <input
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
                  value={pf.hurdat2Path}
                  onChange={(e) =>
                    updatePricing(setForm, "hurdat2Path", e.target.value)
                  }
                  placeholder="Auto-populated from uploads"
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-semibold text-foreground/80">
                  Engine Timeout (ms)
                </span>
                <input
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
                  inputMode="numeric"
                  value={pf.scalaEngineTimeoutMs}
                  onChange={(e) =>
                    updatePricing(
                      setForm,
                      "scalaEngineTimeoutMs",
                      e.target.value
                    )
                  }
                  placeholder="120000"
                />
              </label>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
