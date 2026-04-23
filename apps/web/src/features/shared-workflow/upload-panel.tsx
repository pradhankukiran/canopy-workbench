import type { UploadRegistrationItem } from "@/types/forms";
import type { UploadInputRole, RunUploadBinding } from "@/types/api";
import type { ChangeEvent } from "react";
import { useEffect, useState } from "react";
import { UPLOAD_ROLE_OPTIONS } from "@/lib/constants";
import { formatBytes } from "@/lib/format";
import { StatusBadge } from "@/components/shared/status-badge";
import { Upload, Trash2, ArrowRight, AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  checkPortfolioFile,
  type PortfolioCheckResult,
} from "@/lib/portfolio-schema-check";

interface UploadPanelProps {
  items: UploadRegistrationItem[];
  registering: boolean;
  message: string | null;
  registeredBindings: RunUploadBinding[];
  onFileSelection: (event: ChangeEvent<HTMLInputElement>) => void;
  onRegister: () => void;
  onApplyPaths: () => void;
  onClear: () => void;
  onRoleChange: (localId: string, role: UploadInputRole | "") => void;
}

export function UploadPanel({
  items,
  registering,
  message,
  registeredBindings,
  onFileSelection,
  onRegister,
  onApplyPaths,
  onClear,
  onRoleChange,
}: UploadPanelProps) {
  // Phase 5.2: run the local portfolio-schema check for each selected
  // JSON file whose role is portfolio-ish. Results are keyed by localId
  // and cleared when items are removed so a fresh selection starts clean.
  const [checks, setChecks] = useState<Record<string, PortfolioCheckResult>>(
    {}
  );

  useEffect(() => {
    const currentIds = new Set(items.map((i) => i.localId));
    setChecks((prev) => {
      const next: Record<string, PortfolioCheckResult> = {};
      for (const [id, v] of Object.entries(prev)) {
        if (currentIds.has(id)) next[id] = v;
      }
      return next;
    });

    items.forEach((item) => {
      if (!item.file) return;
      if (checks[item.localId]) return;
      const name = (item.filename ?? "").toLowerCase();
      const looksPortfolio =
        name.endsWith(".json") &&
        (item.role === "baselinePortfolio" ||
          item.role === "candidatePortfolio" ||
          /portfolio/.test(name) ||
          /property/.test(name));
      if (!looksPortfolio) return;
      void checkPortfolioFile(item.file).then((result) => {
        setChecks((prev) => ({ ...prev, [item.localId]: result }));
      });
    });
  }, [items, checks]);

  return (
    <div>
      <h4 className="mb-1 text-sm font-semibold">Data Uploads</h4>
      <p className="mb-3 text-xs text-muted-foreground">
        Register hurricane track data and portfolio files for the analysis engine.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="grid min-w-[240px] flex-1 gap-1.5 text-sm">
          <span className="font-semibold text-foreground/80">Select files</span>
          <input
            type="file"
            multiple
            accept=".json,.csv,.hurdat2,application/json,text/csv"
            onChange={onFileSelection}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm file:mr-2 file:rounded file:border-0 file:bg-primary/10 file:px-2 file:py-1 file:text-xs file:font-semibold file:text-primary"
          />
        </label>

        <div className="flex gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            onClick={onRegister}
            disabled={registering || items.length === 0}
          >
            <Upload className="h-3.5 w-3.5" />
            {registering ? "Registering..." : "Register"}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            onClick={onApplyPaths}
            disabled={registering || items.length === 0}
          >
            <ArrowRight className="h-3.5 w-3.5" />
            Use Paths
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            onClick={onClear}
            disabled={registering || items.length === 0}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </button>
        </div>
      </div>

      {message && (
        <p className="mt-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
          {message}
        </p>
      )}

      {registeredBindings.length > 0 && (
        <p className="mt-2 rounded-md border border-success/20 bg-success/5 px-3 py-2 text-xs text-success">
          {registeredBindings.length} file{registeredBindings.length === 1 ? "" : "s"} attached
        </p>
      )}

      {items.length > 0 && (
        <div className="mt-3 overflow-auto rounded-lg border border-border bg-card">{
      /* Per-row schema-check summary rendered inline; see SchemaCheckSummary below. */
    }
          <table className="w-full min-w-[600px] border-collapse text-sm">
            <thead>
              <tr className="bg-muted/40">
                <th className="border-b border-border px-3 py-2 text-left text-[0.7rem] font-bold uppercase tracking-wider text-muted-foreground">
                  File
                </th>
                <th className="border-b border-border px-3 py-2 text-left text-[0.7rem] font-bold uppercase tracking-wider text-muted-foreground">
                  Role
                </th>
                <th className="border-b border-border px-3 py-2 text-left text-[0.7rem] font-bold uppercase tracking-wider text-muted-foreground">
                  Size
                </th>
                <th className="border-b border-border px-3 py-2 text-left text-[0.7rem] font-bold uppercase tracking-wider text-muted-foreground">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.localId} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2 font-mono text-xs">{item.filename}</td>
                  <td className="px-3 py-2">
                    <select
                      className="rounded border border-input bg-background px-2 py-1 text-xs"
                      value={item.role ?? ""}
                      onChange={(e) =>
                        onRoleChange(
                          item.localId,
                          e.target.value as UploadInputRole | ""
                        )
                      }
                      disabled={registering || item.status === "registering"}
                    >
                      {UPLOAD_ROLE_OPTIONS.map((option) => (
                        <option
                          key={option.value || "auto"}
                          value={option.value}
                        >
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {formatBytes(item.sizeBytes)}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge label={item.status} />
                    {item.errorMessage && (
                      <p className="mt-1 text-xs text-destructive">
                        {item.errorMessage}
                      </p>
                    )}
                    {checks[item.localId] && (
                      <SchemaCheckSummary result={checks[item.localId]} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SchemaCheckSummary({ result }: { result: PortfolioCheckResult }) {
  if (result.ok) {
    return (
      <p className="mt-1 flex items-center gap-1 text-xs text-success">
        <CheckCircle2 size={12} />
        Schema check passed ({result.locationCount} location
        {result.locationCount === 1 ? "" : "s"}).
      </p>
    );
  }
  const preview = result.issues.slice(0, 4);
  return (
    <div className="mt-1 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
      <p className="flex items-center gap-1 text-amber-300">
        <AlertTriangle size={12} />
        Schema check found {result.issues.length} issue
        {result.issues.length === 1 ? "" : "s"} (local check; server still
        validates).
      </p>
      <ul className="mt-1 list-disc pl-4">
        {preview.map((issue, idx) => (
          <li key={idx} className="font-mono text-[0.7rem] text-amber-300/80">
            <span className="opacity-80">{issue.path}</span>: {issue.message}
          </li>
        ))}
      </ul>
      {result.issues.length > preview.length && (
        <p className="mt-1 text-[0.7rem] text-muted-foreground">
          +{result.issues.length - preview.length} more
        </p>
      )}
    </div>
  );
}
