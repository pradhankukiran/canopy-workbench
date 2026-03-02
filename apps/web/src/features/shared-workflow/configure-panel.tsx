import type { ReactNode } from "react";
import type { RunFormState } from "@/types/forms";
import type { EngineProfile } from "@/types/api";
import type { FormFieldErrors } from "@/hooks/use-workflow";
import { ENGINE_LABELS } from "@/lib/constants";
import { HelpTooltip } from "@/components/shared/help-tooltip";
import { FieldError } from "@/components/shared/field-error";
import { SummaryStrip } from "@/components/shared/summary-strip";
import { ChevronDown, Settings } from "lucide-react";
import { useState } from "react";

interface ConfigurePanelProps {
  form: RunFormState;
  updateField: <K extends keyof RunFormState>(
    key: K,
    value: RunFormState[K]
  ) => void;
  highlights: Array<{ label: string; value: string; help?: string }>;
  moduleFields: ReactNode;
  uploadSection: ReactNode;
  fieldErrors?: FormFieldErrors;
  clearFieldError?: (path: string) => void;
}

export function ConfigurePanel({
  form,
  updateField,
  highlights,
  moduleFields,
  uploadSection,
  fieldErrors = {},
  clearFieldError,
}: ConfigurePanelProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="mb-4">
        <h3 className="text-base font-semibold">Configure Inputs</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Set the business inputs for this analysis.
        </p>
      </div>

      <SummaryStrip items={highlights} className="mb-4" />

      <div className="mb-4">
        <label className="grid gap-1.5 text-sm">
          <span className="flex items-center gap-1 font-semibold text-foreground/80">
            Deal Identifier
            <HelpTooltip content="Unique identifier for the candidate deal being analyzed. Used to track and retrieve results." />
          </span>
          <input
            className={`w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring transition-shadow focus:ring-2 ${fieldErrors.candidateDealId ? "border-destructive" : ""}`}
            value={form.candidateDealId}
            onChange={(e) => { updateField("candidateDealId", e.target.value); clearFieldError?.("candidateDealId"); }}
            placeholder="deal_demo001"
            required
          />
          <FieldError errors={fieldErrors.candidateDealId} />
        </label>
      </div>

      {moduleFields}

      <div className="mt-4 rounded-lg border border-border bg-muted/30">
        <button
          type="button"
          className="flex w-full items-center gap-2 px-4 py-3 text-sm font-semibold text-foreground/70 hover:text-foreground"
          onClick={() => setAdvancedOpen(!advancedOpen)}
        >
          <Settings className="h-4 w-4" />
          Advanced Settings
          <ChevronDown
            className={`ml-auto h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
          />
        </button>
        {advancedOpen && (
          <div className="border-t border-border px-4 py-4">
            <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
              <label className="grid gap-1.5 text-sm">
                <span className="font-semibold text-foreground/80">
                  Workspace ID
                </span>
                <input
                  className={`rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2 ${fieldErrors.workspaceId ? "border-destructive" : ""}`}
                  value={form.workspaceId}
                  onChange={(e) => { updateField("workspaceId", e.target.value); clearFieldError?.("workspaceId"); }}
                  placeholder="ws_demo"
                  required
                />
                <FieldError errors={fieldErrors.workspaceId} />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="flex items-center gap-1 font-semibold text-foreground/80">
                  Analysis Speed
                  <HelpTooltip content="Quick runs fast with reduced accuracy. Standard balances speed and precision. Comprehensive uses the full model." />
                </span>
                <select
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
                  value={form.engineProfile}
                  onChange={(e) =>
                    updateField(
                      "engineProfile",
                      e.target.value as EngineProfile
                    )
                  }
                >
                  {(
                    Object.entries(ENGINE_LABELS) as [
                      EngineProfile,
                      string,
                    ][]
                  ).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-semibold text-foreground/80">
                  Random Seed
                </span>
                <input
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
                  inputMode="numeric"
                  value={form.randomSeed}
                  onChange={(e) =>
                    updateField("randomSeed", e.target.value)
                  }
                  placeholder="42"
                />
              </label>
            </div>

            <div className="mt-4 flex flex-wrap gap-4 text-sm">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={form.includeYearOutcomes}
                  onChange={(e) =>
                    updateField("includeYearOutcomes", e.target.checked)
                  }
                />
                Include year outcomes
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={form.includeEventOutcomes}
                  onChange={(e) =>
                    updateField("includeEventOutcomes", e.target.checked)
                  }
                />
                Include event outcomes
              </label>
            </div>

            <div className="mt-4">{uploadSection}</div>
          </div>
        )}
      </div>
    </section>
  );
}
