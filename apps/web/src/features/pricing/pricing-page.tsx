import { useNavigate, useParams } from "react-router-dom";
import { useWorkflow } from "@/hooks/use-workflow";
import { PRICING_LOSS_BASIS_OPTIONS } from "@/lib/constants";
import { WorkflowLayout } from "@/features/shared-workflow/workflow-layout";
import { ConfigurePanel } from "@/features/shared-workflow/configure-panel";
import { ReviewPanel } from "@/features/shared-workflow/review-panel";
import { RunStatusPanel } from "@/features/shared-workflow/run-status-panel";
import { DiagnosticsPanel } from "@/features/shared-workflow/diagnostics-panel";
import { ResultsLayout } from "@/features/shared-workflow/results-layout";
import { UploadPanel } from "@/features/shared-workflow/upload-panel";
import { PricingForm } from "./components/pricing-form";
import { PricingResults } from "./components/pricing-results";

export function PricingPage() {
  const navigate = useNavigate();
  const w = useWorkflow("pricing");

  const lossBasisLabel =
    PRICING_LOSS_BASIS_OPTIONS.find(
      (o) => o.value === w.form.propertyCatPricingYlt.lossBasis
    )?.label ?? w.form.propertyCatPricingYlt.lossBasis;

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
    { label: "Module", value: "Catastrophe Pricing" },
    {
      label: "Scope",
      value: `${w.form.propertyCatPricingYlt.simulatedYears.trim() || "10,000"} years \u00B7 ${lossBasisLabel}`,
    },
    { label: "Inputs", value: uploadLabel },
    { label: "Outputs", value: outputLabel },
  ];

  const reviewHighlights = [
    { label: "Outputs", value: outputLabel },
    {
      label: "Return Periods",
      value:
        w.form.propertyCatPricingYlt.returnPeriodsYearsCsv.trim() ||
        "Default curve",
    },
    {
      label: "Max Rows",
      value: w.form.propertyCatPricingYlt.yltRowLimit.trim() || "25",
    },
    { label: "Engine", value: "HURDAT2 Pricing Engine" },
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
          moduleFields={<PricingForm form={w.form} setForm={w.setForm} fieldErrors={w.fieldErrors} clearFieldError={w.clearFieldError} />}
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
          {w.pricingYlt && w.resultsBundle && (
            <PricingResults
              pricingYlt={w.pricingYlt}
              bundle={w.resultsBundle}
            />
          )}
        </ResultsLayout>
        </div>
      </form>
    </WorkflowLayout>
  );
}
