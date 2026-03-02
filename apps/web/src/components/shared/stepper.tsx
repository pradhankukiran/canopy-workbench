import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

interface StepperProps {
  steps: Array<{
    label: string;
    status: "complete" | "current" | "pending";
  }>;
}

export function Stepper({ steps }: StepperProps) {
  return (
    <ol
      className="mb-4 grid grid-cols-4 gap-2 max-md:grid-cols-2 max-sm:grid-cols-1"
      aria-label="Workflow progress"
    >
      {steps.map((step, index) => (
        <li
          key={step.label}
          aria-current={step.status === "current" ? "step" : undefined}
          className={cn(
            "flex items-center gap-2.5 rounded-lg border px-3 py-2.5",
            step.status === "complete" &&
              "border-success/20 bg-success/5",
            step.status === "current" &&
              "border-primary/20 bg-primary/5",
            step.status === "pending" &&
              "border-border bg-card"
          )}
        >
          <span
            className={cn(
              "inline-grid h-6 w-6 flex-shrink-0 place-items-center rounded-full text-xs font-bold",
              step.status === "complete" &&
                "bg-success/15 text-success",
              step.status === "current" &&
                "bg-primary/15 text-primary",
              step.status === "pending" &&
                "bg-muted text-muted-foreground"
            )}
            aria-hidden="true"
          >
            {step.status === "complete" ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              index + 1
            )}
          </span>
          <span className="truncate text-sm font-semibold">
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}
