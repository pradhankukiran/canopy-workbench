import type { RunFormState, IlsParametricTriggerSimulatorFormState } from "@/types/forms";
import type { FormFieldErrors } from "@/hooks/use-workflow";
import { PAYOUT_CURVE_OPTIONS } from "@/lib/constants";
import { HelpTooltip } from "@/components/shared/help-tooltip";
import { FieldError } from "@/components/shared/field-error";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

interface IlsTriggerFormProps {
  form: RunFormState;
  setForm: React.Dispatch<React.SetStateAction<RunFormState>>;
  fieldErrors?: FormFieldErrors;
  clearFieldError?: (path: string) => void;
}

function updateIls(
  setForm: React.Dispatch<React.SetStateAction<RunFormState>>,
  key: keyof IlsParametricTriggerSimulatorFormState,
  value: IlsParametricTriggerSimulatorFormState[keyof IlsParametricTriggerSimulatorFormState]
) {
  setForm((current) => ({
    ...current,
    ilsParametricTriggerSimulator: {
      ...current.ilsParametricTriggerSimulator,
      [key]: value,
    },
  }));
}

export function IlsTriggerForm({ form, setForm, fieldErrors = {}, clearFieldError }: IlsTriggerFormProps) {
  const [overridesOpen, setOverridesOpen] = useState(false);
  const ilsForm = form.ilsParametricTriggerSimulator;
  const err = (field: string) => fieldErrors[`ilsParametricTriggerSimulator.${field}`];
  const errCls = (field: string) => err(field) ? "border-destructive" : "";

  return (
    <section className="mt-4 rounded-lg border border-border bg-muted/30 p-4">
      <h4 className="mb-1 text-sm font-semibold">Trigger Simulation Parameters</h4>
      <p className="mb-3 text-xs text-muted-foreground">
        Configure the parametric trigger model for bond payout simulation.
      </p>

      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        <label className="grid gap-1.5 text-sm">
          <span className="font-semibold text-foreground/80">Trigger Index</span>
          <input
            className={`rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2 ${errCls("triggerIndexName")}`}
            value={ilsForm.triggerIndexName}
            onChange={(e) => { updateIls(setForm, "triggerIndexName", e.target.value); clearFieldError?.("ilsParametricTriggerSimulator.triggerIndexName"); }}
            placeholder="NOAA_WIND_INDEX"
          />
          <FieldError errors={err("triggerIndexName")} />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="font-semibold text-foreground/80">Region</span>
          <input
            className={`rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2 ${errCls("regionCode")}`}
            value={ilsForm.regionCode}
            onChange={(e) => { updateIls(setForm, "regionCode", e.target.value); clearFieldError?.("ilsParametricTriggerSimulator.regionCode"); }}
            placeholder="US-GULF"
          />
          <FieldError errors={err("regionCode")} />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="font-semibold text-foreground/80">Peril</span>
          <input
            className={`rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2 ${errCls("perilCode")}`}
            value={ilsForm.perilCode}
            onChange={(e) => { updateIls(setForm, "perilCode", e.target.value); clearFieldError?.("ilsParametricTriggerSimulator.perilCode"); }}
            placeholder="wind"
          />
          <FieldError errors={err("perilCode")} />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="flex items-center gap-1 font-semibold text-foreground/80">
            Payout Structure
            <HelpTooltip content="Linear Ramp: payout scales linearly between trigger and full payout points. All-or-Nothing: full payout if triggered. Step Function: discrete payout levels." />
          </span>
          <select
            className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
            value={ilsForm.payoutCurve}
            onChange={(e) =>
              updateIls(setForm, "payoutCurve", e.target.value as "linear" | "binary" | "stepped")
            }
          >
            {PAYOUT_CURVE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="flex items-center gap-1 font-semibold text-foreground/80">
            Trigger Point
            <HelpTooltip content="Index value at which the bond begins to pay out." />
          </span>
          <input
            className={`rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2 ${errCls("attachmentThreshold")}`}
            inputMode="decimal"
            value={ilsForm.attachmentThreshold}
            onChange={(e) => { updateIls(setForm, "attachmentThreshold", e.target.value); clearFieldError?.("ilsParametricTriggerSimulator.attachmentThreshold"); }}
            placeholder="65"
          />
          <FieldError errors={err("attachmentThreshold")} />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="flex items-center gap-1 font-semibold text-foreground/80">
            Full Payout Point
            <HelpTooltip content="Index value at which the bond pays out 100% of the notional." />
          </span>
          <input
            className={`rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2 ${errCls("exhaustionThreshold")}`}
            inputMode="decimal"
            value={ilsForm.exhaustionThreshold}
            onChange={(e) => { updateIls(setForm, "exhaustionThreshold", e.target.value); clearFieldError?.("ilsParametricTriggerSimulator.exhaustionThreshold"); }}
            placeholder="110"
          />
          <FieldError errors={err("exhaustionThreshold")} />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="font-semibold text-foreground/80">Simulation Count</span>
          <input
            className={`rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2 ${errCls("simulationCount")}`}
            inputMode="numeric"
            value={ilsForm.simulationCount}
            onChange={(e) => { updateIls(setForm, "simulationCount", e.target.value); clearFieldError?.("ilsParametricTriggerSimulator.simulationCount"); }}
            placeholder="2500"
          />
          <FieldError errors={err("simulationCount")} />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-4 text-sm">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            className="accent-primary"
            checked={ilsForm.includeEventLevelOutcomes}
            onChange={(e) => updateIls(setForm, "includeEventLevelOutcomes", e.target.checked)}
          />
          Include event-level outcomes
        </label>
      </div>

      <div className="mt-3 rounded-lg border border-border bg-card/50">
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2.5 text-xs font-semibold text-foreground/60 hover:text-foreground"
          onClick={() => setOverridesOpen(!overridesOpen)}
        >
          File overrides & engine options
          <ChevronDown className={`ml-auto h-3.5 w-3.5 transition-transform ${overridesOpen ? "rotate-180" : ""}`} />
        </button>
        {overridesOpen && (
          <div className="border-t border-border px-3 py-3">
            <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
              <label className="grid gap-1.5 text-sm">
                <span className="font-semibold text-foreground/80">Hurricane Track Data Path</span>
                <input
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
                  value={ilsForm.hurdat2Path}
                  onChange={(e) => updateIls(setForm, "hurdat2Path", e.target.value)}
                  placeholder="Auto-populated from uploads"
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-semibold text-foreground/80">Engine Timeout (ms)</span>
                <input
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
                  inputMode="numeric"
                  value={ilsForm.scalaEngineTimeoutMs}
                  onChange={(e) => updateIls(setForm, "scalaEngineTimeoutMs", e.target.value)}
                  placeholder="30000"
                />
              </label>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
