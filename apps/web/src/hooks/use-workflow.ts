import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { ZodError } from "zod";
import type {
  JobRecord,
  PosteriorBundle,
  RunEventRecord,
  RunRecord,
  RunUploadBinding,
  UploadInputRole,
} from "@/types/api";
import type { RunFormState, UploadRegistrationItem } from "@/types/forms";
import type { ModuleDefinition, ModuleKey } from "@/types/modules";
import type {
  PricingYltDisplay,
  IlsTriggerSimulationDisplay,
  TailRiskComparisonDisplay,
  MpiRainierCalibrationDisplay,
} from "@/types/display";
import { MODULES } from "@/types/modules";
import {
  ApiHttpError,
  createUpload,
  getJob,
  getRun,
  getRunEvents,
  getRunResults,
  submitModuleRun,
} from "@/api/client";
import { POLL_INTERVAL_MS, TERMINAL_STATES } from "@/lib/constants";
import { buildDefaultForm, buildRunPayload } from "@/lib/form-builders";
import { clampProgress, toErrorMessage } from "@/lib/format";
import { inferUploadRole } from "@/extractors/bundle-utils";
import { extractPricingYlt } from "@/extractors/pricing-ylt";
import { extractIlsTriggerSimulation } from "@/extractors/ils-trigger";
import { extractTailRiskComparison } from "@/extractors/tail-risk";
import { extractMpiRainierCalibration } from "@/extractors/mpi-calibration";
import { pricingFormSchema } from "@/lib/schemas/pricing-schema";
import { ilsTriggerFormSchema } from "@/lib/schemas/ils-trigger-schema";

type ResultsStatus = "idle" | "loading" | "ready" | "unavailable" | "error";
type EventsStatus = "idle" | "loading" | "ready" | "unavailable" | "error";

function isTerminalState(state: string | undefined): boolean {
  return typeof state === "string" && TERMINAL_STATES.has(state);
}

export type FormFieldErrors = Record<string, string[] | undefined>;

export interface WorkflowState {
  // Module
  selectedModuleKey: ModuleKey | null;
  selectedModule: ModuleDefinition | null;
  form: RunFormState;
  setForm: React.Dispatch<React.SetStateAction<RunFormState>>;

  // Validation
  fieldErrors: FormFieldErrors;
  clearFieldError: (path: string) => void;

  // Submission
  isSubmitting: boolean;
  submitError: string | null;

  // Polling
  pollingActive: boolean;
  runRecord: RunRecord | null;
  jobRecord: JobRecord | null;
  pollError: string | null;
  lastPolledAt: string | null;
  jobProgress: number | null;
  runTerminal: boolean;
  runSucceeded: boolean;

  // Events
  eventsStatus: EventsStatus;
  runEvents: RunEventRecord[];
  eventsMessage: string | null;

  // Results
  resultsStatus: ResultsStatus;
  resultsBundle: PosteriorBundle | null;
  resultsMessage: string | null;
  pricingYlt: PricingYltDisplay | null;
  ilsTriggerSimulation: IlsTriggerSimulationDisplay | null;
  tailRiskComparison: TailRiskComparisonDisplay | null;
  mpiRainierCalibration: MpiRainierCalibrationDisplay | null;

  // Uploads
  uploadItems: UploadRegistrationItem[];
  uploadRegistering: boolean;
  uploadMessage: string | null;
  registeredUploadBindings: RunUploadBinding[];
  primaryUploadId: string | undefined;

  // Review payload
  reviewPayload: ReturnType<typeof buildRunPayload> | null;

  // Actions
  selectModule: (module: ModuleDefinition) => void;
  backToModules: () => void;
  resetWorkflow: () => void;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  handleManualRefresh: () => Promise<void>;
  handleUploadFileSelection: (event: ChangeEvent<HTMLInputElement>) => void;
  handleRegisterUploads: () => Promise<void>;
  applyUploadedPathsToModule: () => void;
  clearUploadItems: () => void;
  setUploadItemRole: (localId: string, role: UploadInputRole | "") => void;

  // Scroll refs
  runStatusRef: (node: HTMLDivElement | null) => void;
  resultsRef: (node: HTMLDivElement | null) => void;

  // Steps
  steps: Array<{
    label: string;
    status: "complete" | "current" | "pending";
  }>;
}

export function useWorkflow(
  initialModuleKey: ModuleKey | null
): WorkflowState {
  const [selectedModuleKey, setSelectedModuleKey] =
    useState<ModuleKey | null>(initialModuleKey);
  const [form, setForm] = useState<RunFormState>(() => {
    const module =
      MODULES.find((m) => m.key === initialModuleKey) ?? MODULES[0];
    return buildDefaultForm(module);
  });
  const [fieldErrors, setFieldErrors] = useState<FormFieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pollingActive, setPollingActive] = useState(false);
  const [runRecord, setRunRecord] = useState<RunRecord | null>(null);
  const [jobRecord, setJobRecord] = useState<JobRecord | null>(null);
  const [pollTarget, setPollTarget] = useState<{
    runId: string;
    jobId: string;
  } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [lastPolledAt, setLastPolledAt] = useState<string | null>(null);
  const [eventsStatus, setEventsStatus] = useState<EventsStatus>("idle");
  const [runEvents, setRunEvents] = useState<RunEventRecord[]>([]);
  const [eventsMessage, setEventsMessage] = useState<string | null>(null);
  const [eventsLastPolledAt, setEventsLastPolledAt] = useState<string | null>(
    null
  );
  const [resultsStatus, setResultsStatus] =
    useState<ResultsStatus>("idle");
  const [resultsBundle, setResultsBundle] =
    useState<PosteriorBundle | null>(null);
  const [resultsMessage, setResultsMessage] = useState<string | null>(null);
  const [uploadItems, setUploadItems] = useState<UploadRegistrationItem[]>(
    []
  );
  const [uploadRegistering, setUploadRegistering] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const unsupportedEventsRunsRef = useRef<Set<string>>(new Set());
  const runStatusNodeRef = useRef<HTMLDivElement | null>(null);
  const resultsNodeRef = useRef<HTMLDivElement | null>(null);
  const runStatusRef = useCallback((node: HTMLDivElement | null) => { runStatusNodeRef.current = node; }, []);
  const resultsRef = useCallback((node: HTMLDivElement | null) => { resultsNodeRef.current = node; }, []);

  const selectedModule =
    MODULES.find((m) => m.key === selectedModuleKey) ?? null;

  const currentRunState = runRecord?.state ?? undefined;
  const currentJobState = jobRecord?.state ?? undefined;
  const runTerminal =
    isTerminalState(currentRunState) || isTerminalState(currentJobState);
  const runSucceeded =
    currentRunState === "succeeded" || currentJobState === "succeeded";
  const jobProgress = clampProgress(jobRecord?.progress);

  const registeredUploadBindings: RunUploadBinding[] = uploadItems
    .filter(
      (item) =>
        item.status === "registered" && Boolean(item.upload?.uploadId)
    )
    .flatMap((item) => {
      const uploadId = item.upload?.uploadId;
      if (!uploadId) return [];
      const role =
        item.role && item.role.length > 0 ? item.role : undefined;
      return [
        {
          uploadId,
          ...(role ? { role } : {}),
          ...(item.filename.trim().length > 0
            ? { filename: item.filename.trim() }
            : {}),
        },
      ];
    });
  const primaryUploadId = registeredUploadBindings[0]?.uploadId;

  const reviewPayload = selectedModule
    ? buildRunPayload(
        selectedModule,
        form,
        false,
        primaryUploadId,
        registeredUploadBindings
      )
    : null;

  const pricingYlt = useMemo(
    () => (resultsBundle ? extractPricingYlt(resultsBundle) : null),
    [resultsBundle]
  );
  const ilsTriggerSimulation = useMemo(
    () =>
      resultsBundle
        ? extractIlsTriggerSimulation(resultsBundle)
        : null,
    [resultsBundle]
  );
  const tailRiskComparison = useMemo(
    () =>
      resultsBundle ? extractTailRiskComparison(resultsBundle) : null,
    [resultsBundle]
  );
  const mpiRainierCalibration = useMemo(
    () =>
      resultsBundle
        ? extractMpiRainierCalibration(resultsBundle)
        : null,
    [resultsBundle]
  );

  function flattenZodErrors(error: ZodError): FormFieldErrors {
    const flat: FormFieldErrors = {};
    for (const issue of error.issues) {
      const path = issue.path.join(".");
      if (!flat[path]) flat[path] = [];
      flat[path]!.push(issue.message);
    }
    return flat;
  }

  function validateForm(): boolean {
    const schema =
      selectedModuleKey === "pricing"
        ? pricingFormSchema
        : selectedModuleKey === "sensitivity"
          ? ilsTriggerFormSchema
          : null;

    if (!schema) {
      setFieldErrors({});
      return true;
    }

    const result = schema.safeParse(form);
    if (result.success) {
      setFieldErrors({});
      return true;
    }

    setFieldErrors(flattenZodErrors(result.error));
    return false;
  }

  const clearFieldError = useCallback((path: string) => {
    setFieldErrors((current) => {
      if (!current[path]) return current;
      const next = { ...current };
      delete next[path];
      return next;
    });
  }, []);

  function resetExecutionState(): void {
    setFieldErrors({});
    setIsSubmitting(false);
    setPollingActive(false);
    setRunRecord(null);
    setJobRecord(null);
    setPollTarget(null);
    setSubmitError(null);
    setPollError(null);
    setLastPolledAt(null);
    setEventsStatus("idle");
    setRunEvents([]);
    setEventsMessage(null);
    setEventsLastPolledAt(null);
    setResultsStatus("idle");
    setResultsBundle(null);
    setResultsMessage(null);
    unsupportedEventsRunsRef.current.clear();
  }

  const selectModule = useCallback((module: ModuleDefinition) => {
    setSelectedModuleKey(module.key);
    setForm(buildDefaultForm(module));
    resetExecutionState();
  }, []);

  const backToModules = useCallback(() => {
    setSelectedModuleKey(null);
    resetExecutionState();
  }, []);

  const resetWorkflow = useCallback(() => {
    if (selectedModule) {
      setForm(buildDefaultForm(selectedModule));
      resetExecutionState();
    }
  }, [selectedModule]);

  async function loadResults(runId: string): Promise<void> {
    setResultsStatus("loading");
    setResultsMessage(null);
    try {
      const bundle = await getRunResults(runId);
      setResultsBundle(bundle);
      setResultsStatus("ready");
      setResultsMessage(null);
      setTimeout(() => resultsNodeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    } catch (error) {
      if (
        error instanceof ApiHttpError &&
        (error.status === 404 || error.status === 409)
      ) {
        setResultsBundle(null);
        setResultsStatus("unavailable");
        setResultsMessage(
          error.message ||
            "Run completed but results are not available yet."
        );
        return;
      }
      setResultsBundle(null);
      setResultsStatus("error");
      setResultsMessage(toErrorMessage(error));
    }
  }

  async function refreshRunEvents(
    runId: string,
    options?: { markLoading?: boolean }
  ): Promise<void> {
    if (!runId || unsupportedEventsRunsRef.current.has(runId)) return;
    if (options?.markLoading) {
      setEventsStatus("loading");
      setEventsMessage(null);
    }
    try {
      const response = await getRunEvents(runId);
      setRunEvents(response.items);
      setEventsStatus("ready");
      setEventsMessage(null);
      setEventsLastPolledAt(new Date().toISOString());
    } catch (error) {
      if (
        error instanceof ApiHttpError &&
        (error.status === 404 || error.status === 405)
      ) {
        unsupportedEventsRunsRef.current.add(runId);
        setRunEvents([]);
        setEventsStatus("unavailable");
        setEventsMessage(
          "Run events endpoint is not available yet for this backend."
        );
        return;
      }
      setEventsStatus("error");
      setEventsMessage(toErrorMessage(error));
    }
  }

  async function refreshRunAndJob(ids: {
    runId: string;
    jobId: string;
  }): Promise<{
    terminal: boolean;
    succeeded: boolean;
    run: RunRecord;
    job: JobRecord;
  }> {
    const [run, job] = await Promise.all([
      getRun(ids.runId),
      getJob(ids.jobId),
    ]);
    setRunRecord(run);
    setJobRecord(job);
    setLastPolledAt(new Date().toISOString());
    setPollError(null);

    const terminal =
      isTerminalState(run.state) && isTerminalState(job.state);
    const succeeded =
      run.state === "succeeded" || job.state === "succeeded";

    await refreshRunEvents(run.runId);

    if (terminal) {
      setPollingActive(false);
      if (succeeded) {
        await loadResults(run.runId);
      } else if (job.error?.message) {
        setPollError(job.error.message);
      }
    }

    return { terminal, succeeded, run, job };
  }

  useEffect(() => {
    if (!pollTarget) return;
    let cancelled = false;
    let timerId: number | null = null;

    const tick = async (): Promise<void> => {
      let scheduleNext = true;
      try {
        setPollingActive(true);
        const result = await refreshRunAndJob(pollTarget);
        if (result.terminal) scheduleNext = false;
      } catch (error) {
        if (cancelled) return;
        setPollError(toErrorMessage(error));
      } finally {
        if (!cancelled && scheduleNext) {
          timerId = window.setTimeout(tick, POLL_INTERVAL_MS);
        } else if (!cancelled) {
          setPollingActive(false);
        }
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timerId !== null) window.clearTimeout(timerId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollTarget]);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ): Promise<void> {
    event.preventDefault();
    if (!selectedModule) return;
    if (!validateForm()) return;
    resetExecutionState();
    setIsSubmitting(true);

    try {
      const payload = buildRunPayload(
        selectedModule,
        form,
        true,
        primaryUploadId,
        registeredUploadBindings
      );
      const submission = await submitModuleRun(payload);
      setRunRecord(submission.run);
      setJobRecord(submission.job);

      const runId = submission.run.runId;
      const jobId = submission.job.jobId || submission.run.jobId;
      if (!runId || !jobId) {
        throw new Error(
          "Run submission response did not include runId/jobId"
        );
      }

      void refreshRunEvents(runId, { markLoading: true });
      setTimeout(() => runStatusNodeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);

      if (
        isTerminalState(submission.run.state) ||
        isTerminalState(submission.job.state)
      ) {
        if (
          submission.run.state === "succeeded" ||
          submission.job.state === "succeeded"
        ) {
          await loadResults(runId);
        }
      } else {
        setPollTarget({ runId, jobId });
      }
    } catch (error) {
      setSubmitError(toErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleManualRefresh(): Promise<void> {
    if (!pollTarget) return;
    try {
      await refreshRunAndJob(pollTarget);
    } catch (error) {
      setPollError(toErrorMessage(error));
    }
  }

  function handleUploadFileSelection(
    event: ChangeEvent<HTMLInputElement>
  ): void {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const nextItems = Array.from(files).map((file, index) => ({
      localId: `uplocal-${Date.now()}-${index}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      sizeBytes: Number.isFinite(file.size)
        ? Math.max(0, file.size)
        : 0,
      file,
      role: inferUploadRole(file.name),
      status: "selected" as const,
    }));

    setUploadItems((current) => [...current, ...nextItems]);
    setUploadMessage(null);
    event.target.value = "";
  }

  async function handleRegisterUploads(): Promise<void> {
    const pending = uploadItems.filter(
      (item) => item.status === "selected" || item.status === "error"
    );
    if (pending.length === 0 || uploadRegistering) return;

    setUploadRegistering(true);
    setUploadMessage(null);

    let successCount = 0;
    let failureCount = 0;

    for (const item of pending) {
      setUploadItems((current) =>
        current.map((row) =>
          row.localId === item.localId
            ? { ...row, status: "registering", errorMessage: undefined }
            : row
        )
      );

      try {
        const contentText = item.file
          ? await item.file.text()
          : undefined;
        const upload = await createUpload({
          workspaceId: form.workspaceId.trim() || undefined,
          filename: item.filename,
          contentType: item.contentType || "application/octet-stream",
          sizeBytes: item.sizeBytes,
          ...(typeof contentText === "string" ? { contentText } : {}),
        });

        successCount += 1;
        setUploadItems((current) =>
          current.map((row) =>
            row.localId === item.localId
              ? {
                  ...row,
                  status: "registered",
                  upload,
                  errorMessage: undefined,
                }
              : row
          )
        );
      } catch (error) {
        failureCount += 1;
        setUploadItems((current) =>
          current.map((row) =>
            row.localId === item.localId
              ? {
                  ...row,
                  status: "error",
                  errorMessage: toErrorMessage(error),
                }
              : row
          )
        );
      }
    }

    if (failureCount === 0) {
      setUploadMessage(
        `Registered ${successCount} upload${successCount === 1 ? "" : "s"}.`
      );
    } else if (successCount === 0) {
      setUploadMessage(
        `Failed to register ${failureCount} upload${failureCount === 1 ? "" : "s"}.`
      );
    } else {
      setUploadMessage(
        `Registered ${successCount}, ${failureCount} failed.`
      );
    }

    setUploadRegistering(false);
  }

  function applyUploadedPathsToModule(): void {
    const registered = uploadItems
      .filter((item) => item.status === "registered")
      .flatMap((item) => {
        const upload = item.upload;
        if (!upload?.uploadId) return [];
        if (
          typeof upload.storagePath !== "string" ||
          upload.storagePath.length === 0
        )
          return [];
        return [{ upload, role: item.role }];
      });

    if (registered.length === 0) {
      setUploadMessage("No registered uploads with stored paths available.");
      return;
    }

    const byName = [...registered].sort((a, b) =>
      (a.upload.filename ?? "").localeCompare(b.upload.filename ?? "")
    );
    const byRole = (role: UploadInputRole) =>
      byName.find((row) => row.role === role)?.upload;
    const hurdat2 =
      byRole("hurdat2") ??
      byName.find((row) =>
        (row.upload.filename ?? "").toLowerCase().endsWith(".hurdat2")
      )?.upload;
    const jsonFiles = byName
      .map((row) => row.upload)
      .filter((upload) =>
        (upload.filename ?? "").toLowerCase().endsWith(".json")
      );

    if (selectedModuleKey === "pricing") {
      const propertyJson =
        byRole("propertyPortfolio") ??
        byRole("baselinePortfolio") ??
        jsonFiles.find((upload) =>
          /(property|portfolio)/i.test(upload.filename ?? "")
        ) ??
        jsonFiles[0];

      setForm((current) => ({
        ...current,
        propertyCatPricingYlt: {
          ...current.propertyCatPricingYlt,
          hurdat2Path:
            hurdat2?.storagePath ??
            current.propertyCatPricingYlt.hurdat2Path,
          propertyPortfolioPath:
            propertyJson?.storagePath ??
            current.propertyCatPricingYlt.propertyPortfolioPath,
        },
      }));
      setUploadMessage("Applied uploaded file paths to pricing inputs.");
      return;
    }

    if (selectedModuleKey === "sensitivity") {
      setForm((current) => ({
        ...current,
        ilsParametricTriggerSimulator: {
          ...current.ilsParametricTriggerSimulator,
          hurdat2Path:
            hurdat2?.storagePath ??
            current.ilsParametricTriggerSimulator.hurdat2Path,
        },
      }));
      setUploadMessage(
        "Applied uploaded hurricane track data path to trigger simulation inputs."
      );
      return;
    }

    setUploadMessage(
      "Uploaded file paths are only auto-applied for Pricing and Trigger Simulation."
    );
  }

  function clearUploadItems(): void {
    if (uploadRegistering) return;
    setUploadItems([]);
    setUploadMessage(null);
  }

  function setUploadItemRole(
    localId: string,
    role: UploadInputRole | ""
  ): void {
    setUploadItems((current) =>
      current.map((row) =>
        row.localId === localId ? { ...row, role } : row
      )
    );
  }

  const steps: WorkflowState["steps"] = [
    { label: "Configure", status: "complete" },
    {
      label: "Review",
      status: runRecord || isSubmitting ? "complete" : "current",
    },
    {
      label: "Run",
      status:
        isSubmitting || pollingActive
          ? "current"
          : runRecord || jobRecord
            ? runTerminal
              ? "complete"
              : "current"
            : "pending",
    },
    {
      label: "Results",
      status:
        resultsStatus === "ready"
          ? "complete"
          : resultsStatus === "loading" || (runTerminal && runSucceeded)
            ? "current"
            : "pending",
    },
  ];

  return {
    selectedModuleKey,
    selectedModule,
    form,
    setForm,
    fieldErrors,
    clearFieldError,
    isSubmitting,
    submitError,
    pollingActive,
    runRecord,
    jobRecord,
    pollError,
    lastPolledAt,
    jobProgress,
    runTerminal,
    runSucceeded,
    eventsStatus,
    runEvents,
    eventsMessage,
    resultsStatus,
    resultsBundle,
    resultsMessage,
    pricingYlt,
    ilsTriggerSimulation,
    tailRiskComparison,
    mpiRainierCalibration,
    uploadItems,
    uploadRegistering,
    uploadMessage,
    registeredUploadBindings,
    primaryUploadId,
    reviewPayload,
    runStatusRef,
    resultsRef,
    selectModule,
    backToModules,
    resetWorkflow,
    handleSubmit,
    handleManualRefresh,
    handleUploadFileSelection,
    handleRegisterUploads,
    applyUploadedPathsToModule,
    clearUploadItems,
    setUploadItemRole,
    steps,
  };
}
