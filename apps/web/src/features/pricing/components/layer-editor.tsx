import { useCallback } from "react";
import { HelpTooltip } from "@/components/shared/help-tooltip";
import type {
  LayerFormState,
  PremiumTermsFormState,
  PropertyCatPricingYltFormState,
  RunFormState,
} from "@/types/forms";
import { Plus, Trash2 } from "lucide-react";

function genLocalId() {
  return `layer_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;
}

function defaultLayer(index: number): LayerFormState {
  return {
    localId: genLocalId(),
    name: `Layer ${index + 1}`,
    attachment: "",
    limit: "",
    share: "1.0",
    basis: "occurrence",
    reinstatements: "0",
  };
}

interface LayerEditorProps {
  form: RunFormState;
  setForm: React.Dispatch<React.SetStateAction<RunFormState>>;
}

/**
 * Reinsurance layer tower editor. Emits layers + premium terms that the
 * form-builder later packs into `moduleParameters.propertyCatPricing`
 * and the Scala CLI parses back into a LayerTower / PremiumTerms case
 * class. Empty tower (no rows) = no cession; the engine emits
 * deterministic risk metrics only, no layerPremiums.
 */
export function LayerEditor({ form, setForm }: LayerEditorProps) {
  const pf = form.propertyCatPricingYlt;

  const updatePricing = useCallback(
    (partial: Partial<PropertyCatPricingYltFormState>) =>
      setForm((current) => ({
        ...current,
        propertyCatPricingYlt: { ...current.propertyCatPricingYlt, ...partial },
      })),
    [setForm]
  );

  const addLayer = useCallback(() => {
    updatePricing({ layers: [...pf.layers, defaultLayer(pf.layers.length)] });
  }, [pf.layers, updatePricing]);

  const removeLayer = useCallback(
    (localId: string) => {
      updatePricing({ layers: pf.layers.filter((l) => l.localId !== localId) });
    },
    [pf.layers, updatePricing]
  );

  const patchLayer = useCallback(
    (localId: string, patch: Partial<LayerFormState>) => {
      updatePricing({
        layers: pf.layers.map((l) =>
          l.localId === localId ? { ...l, ...patch } : l
        ),
      });
    },
    [pf.layers, updatePricing]
  );

  const patchTerms = useCallback(
    (patch: Partial<PremiumTermsFormState>) => {
      updatePricing({ premiumTerms: { ...pf.premiumTerms, ...patch } });
    },
    [pf.premiumTerms, updatePricing]
  );

  const numInputClass =
    "w-full rounded-md border border-input bg-background px-2 py-1 text-xs outline-none ring-ring focus:ring-2";

  return (
    <section className="mt-4 rounded-lg border border-border bg-muted/30 p-4">
      <header className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold">
            Reinsurance Layer Tower{" "}
            <HelpTooltip content="Optional. Each layer is an independent cession with its own attachment, limit, share, and reinstatements. Empty tower = no reinsurance (gross-loss pricing only)." />
          </h4>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Phase 3 financial pipeline. Layers apply independently to per-event
            net losses; premium is computed separately per layer.
          </p>
        </div>
        <button
          type="button"
          onClick={addLayer}
          className="flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-xs hover:bg-muted/50"
        >
          <Plus size={12} /> Add layer
        </button>
      </header>

      {pf.layers.length === 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          No layers configured. Add one to compute per-layer technical premium
          and rate-on-line.
        </p>
      )}

      {pf.layers.length > 0 && (
        <table className="mt-3 w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="px-1 pb-1 font-medium">Name</th>
              <th className="px-1 pb-1 font-medium">Attachment</th>
              <th className="px-1 pb-1 font-medium">Limit</th>
              <th className="px-1 pb-1 font-medium">Share</th>
              <th className="px-1 pb-1 font-medium">Basis</th>
              <th className="px-1 pb-1 font-medium">Reinst.</th>
              <th className="px-1 pb-1" />
            </tr>
          </thead>
          <tbody>
            {pf.layers.map((l) => (
              <tr key={l.localId}>
                <td className="px-1 py-1">
                  <input
                    className={numInputClass}
                    value={l.name}
                    onChange={(e) =>
                      patchLayer(l.localId, { name: e.target.value })
                    }
                    placeholder="Layer 1"
                  />
                </td>
                <td className="px-1 py-1">
                  <input
                    className={numInputClass}
                    inputMode="numeric"
                    value={l.attachment}
                    onChange={(e) =>
                      patchLayer(l.localId, { attachment: e.target.value })
                    }
                    placeholder="e.g. 1000000"
                  />
                </td>
                <td className="px-1 py-1">
                  <input
                    className={numInputClass}
                    inputMode="numeric"
                    value={l.limit}
                    onChange={(e) =>
                      patchLayer(l.localId, { limit: e.target.value })
                    }
                    placeholder="e.g. 2000000"
                  />
                </td>
                <td className="px-1 py-1">
                  <input
                    className={numInputClass}
                    inputMode="decimal"
                    value={l.share}
                    onChange={(e) =>
                      patchLayer(l.localId, { share: e.target.value })
                    }
                    placeholder="1.0"
                  />
                </td>
                <td className="px-1 py-1">
                  <select
                    className={numInputClass}
                    value={l.basis}
                    onChange={(e) =>
                      patchLayer(l.localId, {
                        basis: e.target.value as LayerFormState["basis"],
                      })
                    }
                  >
                    <option value="occurrence">occurrence</option>
                    <option value="aggregate">aggregate</option>
                  </select>
                </td>
                <td className="px-1 py-1">
                  <input
                    className={numInputClass}
                    inputMode="numeric"
                    value={l.reinstatements}
                    onChange={(e) =>
                      patchLayer(l.localId, { reinstatements: e.target.value })
                    }
                    placeholder="0"
                  />
                </td>
                <td className="px-1 py-1">
                  <button
                    type="button"
                    onClick={() => removeLayer(l.localId)}
                    className="rounded-md border border-border/60 p-1 hover:bg-muted/50"
                    aria-label="Remove layer"
                  >
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {pf.layers.length > 0 && (
        <section className="mt-4 grid grid-cols-2 gap-3 border-t border-border/40 pt-3 max-sm:grid-cols-1">
          <label className="grid gap-1 text-xs">
            <span className="font-semibold text-foreground/80">
              Risk-load shape
            </span>
            <select
              className={numInputClass}
              value={pf.premiumTerms.riskLoadShape}
              onChange={(e) =>
                patchTerms({
                  riskLoadShape: e.target
                    .value as PremiumTermsFormState["riskLoadShape"],
                })
              }
            >
              <option value="additive">additive (pure + k · σ)</option>
              <option value="multiplicative">
                multiplicative (pure · (1 + k))
              </option>
            </select>
          </label>
          <label className="grid gap-1 text-xs">
            <span className="font-semibold text-foreground/80">
              Risk-load k{" "}
              <HelpTooltip content="Standard-deviation multiplier (additive) or expected-loss multiplier (multiplicative)." />
            </span>
            <input
              className={numInputClass}
              inputMode="decimal"
              value={pf.premiumTerms.riskLoadCoefficient}
              onChange={(e) =>
                patchTerms({ riskLoadCoefficient: e.target.value })
              }
              placeholder="0.25"
            />
          </label>
          <label className="grid gap-1 text-xs">
            <span className="font-semibold text-foreground/80">Brokerage</span>
            <input
              className={numInputClass}
              inputMode="decimal"
              value={pf.premiumTerms.brokerageRate}
              onChange={(e) => patchTerms({ brokerageRate: e.target.value })}
              placeholder="0.05"
            />
          </label>
          <label className="grid gap-1 text-xs">
            <span className="font-semibold text-foreground/80">
              Profit commission
            </span>
            <input
              className={numInputClass}
              inputMode="decimal"
              value={pf.premiumTerms.profitCommissionRate}
              onChange={(e) =>
                patchTerms({ profitCommissionRate: e.target.value })
              }
              placeholder="0"
            />
          </label>
        </section>
      )}
    </section>
  );
}
