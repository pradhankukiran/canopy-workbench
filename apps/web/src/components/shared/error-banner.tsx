import { cn } from "@/lib/utils";
import { AlertTriangle, XCircle } from "lucide-react";

interface ErrorBannerProps {
  message: string;
  variant?: "error" | "warn";
  className?: string;
}

export function ErrorBanner({
  message,
  variant = "error",
  className,
}: ErrorBannerProps) {
  return (
    <div
      className={cn(
        "mt-3 flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm",
        variant === "error" &&
          "border-destructive/20 bg-destructive/5 text-destructive",
        variant === "warn" &&
          "border-warning/20 bg-warning/5 text-warning",
        className
      )}
    >
      {variant === "error" ? (
        <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      ) : (
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      )}
      <span>{message}</span>
    </div>
  );
}
