import type { ReactNode } from "react";
import type { ModuleDefinition } from "@/types/modules";
import { Stepper } from "@/components/shared/stepper";
import { ArrowLeft, RotateCcw } from "lucide-react";

interface WorkflowLayoutProps {
  module: ModuleDefinition;
  steps: Array<{
    label: string;
    status: "complete" | "current" | "pending";
  }>;
  onBack: () => void;
  onReset: () => void;
  children: ReactNode;
}

export function WorkflowLayout({
  module,
  steps,
  onBack,
  onReset,
  children,
}: WorkflowLayoutProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="min-w-0">
          <p className="text-[0.65rem] font-bold uppercase tracking-widest text-muted-foreground">
            Module
          </p>
          <h2 className="text-xl font-semibold tracking-tight">
            {module.clientTitle}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {module.description}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Modules
          </button>
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
        </div>
      </div>

      <Stepper steps={steps} />

      {children}
    </div>
  );
}
