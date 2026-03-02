import { useNavigate } from "react-router-dom";
import { useWorkflow } from "@/hooks/use-workflow";
import { PAYOUT_CURVE_OPTIONS } from "@/lib/constants";
import { WorkflowLayout } from "@/features/shared-workflow/workflow-layout";
import { ConfigurePanel } from "@/features/shared-workflow/configure-panel";
import { ReviewPanel } from "@/features/shared-workflow/review-panel";
import { RunStatusPanel } from "@/features/shared-workflow/run-status-panel";
import { DiagnosticsPanel } from "@/features/shared-workflow/diagnostics-panel";
import { ResultsLayout } from "@/features/shared-workflow/results-layout";
import { UploadPanel } from "@/features/shared-workflow/upload-panel";
import { IlsTriggerForm } from "./components/ils-trigger-form";
import { IlsTriggerResults } from "./components/ils-trigger-results";

export function IlsTriggerPage() {
  const navigate = useNavigate();
  const w = useWorkflow("sensitivity");

  const payoutLabel =
    PAYOUT_CURVE_OPTIONS.find(
      (o) => o.value === w.form.ilsParametricTriggerSimulator.payoutCurve
    )?.label ?? w.form.ilsParametricTriggerSimulator.payoutCurve;

  const outputSelections = [
    w.form.includeYearOutcomes ? "Year outcomes" : null,
    w.form.includeEventOutcomes ? "Event detail" : null,
  ].filter(Boolean);
  const outputLabel =
    outputSelections.length > 0
      ? outputSelections.join(" + ")
      : "Core metrics only";

  const uploadLabel =
    w.registeredUploadBindings.length > 0
      ? `${w.registeredUploadBindings.length} file${w.registeredUploadBindings.length === 1 ? "" : "s"}`
      : "Inline inputs only";

  const highlights = [
    { label: "Module", value: "Bond Trigger Sim" },
    {
      label: "Scenario",
      value: `${w.form.ilsParametricTriggerSimulator.regionCode.trim() || "Region"} \u00B7 ${w.form.ilsParametricTriggerSimulator.perilCode.trim() || "Peril"} \u00B7 ${payoutLabel}`,
    },
    { label: "Inputs", value: uploadLabel },
    { label: "Outputs", value: outputLabel },
  ];

  const reviewHighlights = [
    { label: "Outputs", value: outputLabel },
    {
      label: "Thresholds",
      value: `${w.form.ilsParametricTriggerSimulator.attachmentThreshold.trim() || "65"} / ${w.form.ilsParametricTriggerSimulator.exhaustionThreshold.trim() || "110"}`,
    },
    {
      label: "Scenarios",
      value:
        w.form.ilsParametricTriggerSimulator.simulationCount.trim() ||
        "2,500",
    },
    { label: "Engine", value: "Trigger Simulation Engine" },
  ];

  if (!w.selectedModule) return null;

  return (
    <WorkflowLayout
      module={w.selectedModule}
      steps={w.steps}
      onBack={() => navigate("/")}
      onReset={w.resetWorkflow}
    >
      <form
        className="grid grid-cols-1 gap-4"
        onSubmit={(e) => void w.handleSubmit(e)}
      >
        <ConfigurePanel
          form={w.form}
          updateField={(key, value) =>
            w.setForm((curr) => ({ ...curr, [key]: value }))
          }
          highlights={highlights}
          fieldErrors={w.fieldErrors}
          clearFieldError={w.clearFieldError}
          moduleFields={
            <IlsTriggerForm form={w.form} setForm={w.setForm} fieldErrors={w.fieldErrors} clearFieldError={w.clearFieldError} />
          }
          uploadSection={
            <UploadPanel
              items={w.uploadItems}
              registering={w.uploadRegistering}
              message={w.uploadMessage}
              registeredBindings={w.registeredUploadBindings}
              onFileSelection={w.handleUploadFileSelection}
              onRegister={() => void w.handleRegisterUploads()}
              onApplyPaths={w.applyUploadedPathsToModule}
              onClear={w.clearUploadItems}
              onRoleChange={w.setUploadItemRole}
            />
          }
        />

        <ReviewPanel
          reviewPayload={w.reviewPayload}
          reviewHighlights={reviewHighlights}
          isSubmitting={w.isSubmitting}
          pollingActive={w.pollingActive}
          submitError={w.submitError}
          hasPollTarget={Boolean(w.runRecord)}
          onManualRefresh={() => void w.handleManualRefresh()}
        />

        <div ref={w.runStatusRef}>
          <RunStatusPanel
            runRecord={w.runRecord}
            jobRecord={w.jobRecord}
            pollingActive={w.pollingActive}
            lastPolledAt={w.lastPolledAt}
            jobProgress={w.jobProgress}
            pollError={w.pollError}
          />
        </div>

        <DiagnosticsPanel
          eventsStatus={w.eventsStatus}
          runEvents={w.runEvents}
          eventsMessage={w.eventsMessage}
          pollingActive={w.pollingActive}
        />

        <div ref={w.resultsRef}>
          <ResultsLayout
            resultsStatus={w.resultsStatus}
            resultsBundle={w.resultsBundle}
            resultsMessage={w.resultsMessage}
          >
            {w.ilsTriggerSimulation && w.resultsBundle && (
              <IlsTriggerResults
                simulation={w.ilsTriggerSimulation}
                bundle={w.resultsBundle}
              />
            )}
          </ResultsLayout>
        </div>
      </form>
    </WorkflowLayout>
  );
}
