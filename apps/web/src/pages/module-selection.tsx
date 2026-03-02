import type { CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { MODULES } from "@/types/modules";
import { MODULE_ROUTE_BY_KEY } from "@/lib/constants";
import { ArrowRight, BarChart3, Zap } from "lucide-react";

const moduleIcons: Record<string, React.ElementType> = {
  pricing: BarChart3,
  sensitivity: Zap,
};

export function ModuleSelectionPage() {
  const navigate = useNavigate();

  return (
    <div>
      <section className="mb-6 rounded-lg border border-border bg-card p-5 shadow-sm">
        <p className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground">
          Canopy Workbench
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">
          Analytics Workbench
        </h1>
        <p className="mt-2 max-w-[72ch] text-sm text-muted-foreground">
          Enterprise workbench for catastrophe pricing and ILS trigger simulation
          with asynchronous runs and audit-friendly results.
        </p>
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold">Choose a Module</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Select an analytics module to begin your analysis workflow.
        </p>

        <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
          {MODULES.map((module) => {
            const Icon = moduleIcons[module.key] ?? BarChart3;
            return (
              <button
                key={module.key}
                type="button"
                className="group relative grid gap-3 overflow-hidden rounded-lg border border-border bg-card p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-border hover:shadow-md"
                style={
                  {
                    "--card-accent": module.accent,
                  } as CSSProperties
                }
                onClick={() =>
                  navigate(MODULE_ROUTE_BY_KEY[module.key])
                }
              >
                <div
                  className="absolute inset-x-0 top-0 h-0.5"
                  style={{ background: module.accent }}
                />
                <div className="flex items-center gap-2">
                  <Icon
                    className="h-5 w-5"
                    style={{ color: module.accent }}
                  />
                  <span className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground">
                    {module.shortLabel}
                  </span>
                </div>
                <strong className="text-base">{module.clientTitle}</strong>
                <p className="text-sm text-muted-foreground">
                  {module.description}
                </p>
                <span className="text-xs text-muted-foreground/70">
                  {module.detail}
                </span>
                <span className="inline-flex items-center gap-1 text-sm font-semibold text-primary">
                  Open analysis
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
