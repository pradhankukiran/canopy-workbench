#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/target/smoke"
mkdir -p "$LOG_DIR"

API_PID=""
WORKER_PID=""

cleanup() {
  local exit_code=$?
  if [[ -n "${API_PID}" ]] && kill -0 "${API_PID}" 2>/dev/null; then
    kill "${API_PID}" 2>/dev/null || true
  fi
  if [[ -n "${WORKER_PID}" ]] && kill -0 "${WORKER_PID}" 2>/dev/null; then
    kill "${WORKER_PID}" 2>/dev/null || true
  fi
  wait "${API_PID}" 2>/dev/null || true
  wait "${WORKER_PID}" 2>/dev/null || true
  exit "${exit_code}"
}
trap cleanup EXIT

load_env_file() {
  local file_path="$1"
  while IFS= read -r line || [[ -n "$line" ]]; do
    # Trim leading/trailing whitespace for comment/blank detection.
    local trimmed="${line#"${line%%[![:space:]]*}"}"
    trimmed="${trimmed%"${trimmed##*[![:space:]]}"}"
    [[ -z "$trimmed" ]] && continue
    [[ "${trimmed:0:1}" == "#" ]] && continue
    [[ "$trimmed" != *=* ]] && continue

    local key="${trimmed%%=*}"
    local value="${trimmed#*=}"
    key="${key%"${key##*[![:space:]]}"}"
    key="${key#"${key%%[![:space:]]*}"}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue

    export "$key=$value"
  done < "$file_path"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 2
  fi
}

require_cmd docker
require_cmd curl
require_cmd jq
require_cmd pnpm

if ! docker info >/dev/null 2>&1; then
  echo "docker daemon is not available; cannot run worker/API smoke test" >&2
  exit 2
fi

cd "$ROOT_DIR"

if [[ -f ".env" ]]; then
  load_env_file ".env"
elif [[ -f ".env.example" ]]; then
  load_env_file ".env.example"
fi

API_PORT="${API_PORT:-3001}"
REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
DATABASE_URL="${DATABASE_URL:-postgresql://canopy:canopy_dev_password@localhost:5432/canopy}"
CANOPY_RUN_QUEUE="${CANOPY_RUN_QUEUE:-canopy_phase1_runs}"
if [[ "$CANOPY_RUN_QUEUE" == *:* ]]; then
  CANOPY_RUN_QUEUE="${CANOPY_RUN_QUEUE//:/_}"
fi

echo "Starting infra (postgres, redis, minio) via docker compose..."
docker compose up -d postgres redis minio >/dev/null

echo "Building API and worker..."
pnpm --filter @canopy/api build >/dev/null
pnpm --filter @canopy/worker build >/dev/null

echo "Starting API and worker..."
(
  export REDIS_URL DATABASE_URL API_PORT CANOPY_RUN_QUEUE
  node apps/api/dist/index.js
) >"$LOG_DIR/api.log" 2>&1 &
API_PID=$!

(
  export REDIS_URL DATABASE_URL CANOPY_RUN_QUEUE
  node services/worker/dist/index.js
) >"$LOG_DIR/worker.log" 2>&1 &
WORKER_PID=$!

echo "Waiting for API health..."
for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:${API_PORT}/health" >/dev/null; then
    break
  fi
  sleep 1
done

if ! curl -sf "http://127.0.0.1:${API_PORT}/health" >/dev/null; then
  echo "API did not become healthy. API log tail:" >&2
  tail -n 80 "$LOG_DIR/api.log" >&2 || true
  exit 1
fi

HURDAT2_PATH="${ROOT_DIR}/test-data/hurdat2/sample_atlantic_subset.hurdat2"
PROPERTY_PORTFOLIO_PATH="${ROOT_DIR}/test-data/property/sample_property_portfolio.json"

submit_and_wait_run() {
  local label="$1"
  local payload_file="$2"
  local result_filter="$3"
  local validation_filter="$4"

  local submit_json="$LOG_DIR/${label}_submit.json"
  local run_json="$LOG_DIR/${label}_run.json"
  local job_json="$LOG_DIR/${label}_job.json"
  local events_json="$LOG_DIR/${label}_events.json"
  local result_json="$LOG_DIR/${label}_results.json"

  echo "Submitting ${label} smoke run..."
  curl -sf \
    -X POST \
    -H "Content-Type: application/json" \
    --data @"$payload_file" \
    "http://127.0.0.1:${API_PORT}/api/v1/runs" >"$submit_json"

  local run_id
  local job_id
  run_id="$(jq -r '.run.runId // empty' "$submit_json")"
  job_id="$(jq -r '.job.jobId // empty' "$submit_json")"

  if [[ -z "$run_id" || -z "$job_id" ]]; then
    echo "[$label] Failed to parse run/job IDs from submit response:" >&2
    cat "$submit_json" >&2
    exit 1
  fi

  echo "Polling ${label} run ${run_id} / job ${job_id} ..."
  local terminal_state=""
  for _ in $(seq 1 240); do
    curl -sf "http://127.0.0.1:${API_PORT}/api/v1/runs/${run_id}" >"$run_json"
    curl -sf "http://127.0.0.1:${API_PORT}/api/v1/jobs/${job_id}" >"$job_json"
    curl -sf "http://127.0.0.1:${API_PORT}/api/v1/runs/${run_id}/events" >"$events_json"
    terminal_state="$(jq -r '.state // empty' "$run_json")"
    if [[ "$terminal_state" == "succeeded" || "$terminal_state" == "failed" || "$terminal_state" == "canceled" ]]; then
      break
    fi
    sleep 2
  done

  if [[ "$terminal_state" != "succeeded" ]]; then
    echo "[$label] Smoke run did not succeed (state=${terminal_state:-unknown})." >&2
    echo "Recent API log:" >&2
    tail -n 120 "$LOG_DIR/api.log" >&2 || true
    echo "Recent worker log:" >&2
    tail -n 240 "$LOG_DIR/worker.log" >&2 || true
    echo "Run snapshot:" >&2
    cat "$run_json" >&2 || true
    echo "Job snapshot:" >&2
    cat "$job_json" >&2 || true
    echo "Events snapshot:" >&2
    cat "$events_json" >&2 || true
    exit 1
  fi

  curl -sf "http://127.0.0.1:${API_PORT}/api/v1/runs/${run_id}/results" >"$result_json"

  if ! jq -e "$validation_filter" "$result_json" >/dev/null; then
    echo "[$label] Result validation failed." >&2
    echo "Validation jq filter: $validation_filter" >&2
    echo "Result summary:" >&2
    jq -r "$result_filter" "$result_json" >&2 || true
    echo "Full result path: $result_json" >&2
    exit 1
  fi

  echo "${label} smoke run succeeded. Key result fields:"
  jq -r "$result_filter" "$result_json"
  echo "Recent ${label} run events:"
  jq -r '.items[-8:]' "$events_json"
}

MPI_PAYLOAD="$LOG_DIR/mpi-run-request.json"
cat >"$MPI_PAYLOAD" <<JSON
{
  "workspaceId": "ws_demo001",
  "candidateDealId": "deal_smoke_mpi",
  "analysisType": "risk",
  "engineProfile": "fast",
  "randomSeed": 42,
  "moduleParameters": {
    "marginalPortfolioImpact": {
      "referencePortfolioId": "pf_smoke001",
      "tailMetric": "oep",
      "returnPeriodsYears": [10, 20, 50, 100],
      "candidateParticipationPct": 20,
      "includeTailRiskComparison": true,
      "useScalaEngine": true,
      "scalaEngineTimeoutMs": 180000
    }
  }
}
JSON

PRICING_PAYLOAD="$LOG_DIR/pricing-run-request.json"
cat >"$PRICING_PAYLOAD" <<JSON
{
  "workspaceId": "ws_demo001",
  "candidateDealId": "deal_smoke_pricing",
  "analysisType": "pricing",
  "engineProfile": "standard",
  "randomSeed": 42,
  "moduleParameters": {
    "propertyCatPricing": {
      "simulatedYears": 250,
      "returnPeriodsYears": [10, 20, 50, 100],
      "yltRowLimit": 12,
      "lossBasis": "net",
      "includeGrossNetBreakout": true,
      "includeSummaryPercentiles": true,
      "propertyPortfolioPath": "${PROPERTY_PORTFOLIO_PATH}",
      "hurdat2Path": "${HURDAT2_PATH}",
      "useScalaEngine": true,
      "scalaEngineTimeoutMs": 240000
    }
  }
}
JSON

ILS_PAYLOAD="$LOG_DIR/ils-run-request.json"
cat >"$ILS_PAYLOAD" <<JSON
{
  "workspaceId": "ws_demo001",
  "candidateDealId": "deal_smoke_ils",
  "analysisType": "sensitivity",
  "engineProfile": "fast",
  "randomSeed": 42,
  "moduleParameters": {
    "ilsParametricTrigger": {
      "triggerIndexName": "maxWindKt",
      "regionCode": "NA",
      "perilCode": "TC",
      "attachmentThreshold": 70,
      "exhaustionThreshold": 120,
      "payoutCurve": "linear",
      "simulationCount": 200,
      "includeEventLevelOutcomes": false,
      "hurdat2Path": "${HURDAT2_PATH}",
      "useScalaEngine": true,
      "scalaEngineTimeoutMs": 180000
    }
  }
}
JSON

submit_and_wait_run \
  "mpi" \
  "$MPI_PAYLOAD" \
  '{
    runId,
    modelVersion,
    priorVersion,
    posteriorSampleCount,
    state: "succeeded",
    resultSource: (.moduleOutputs.marginalPortfolioImpact and "scala-mpi-cli"),
    mpiCalibrationStatus: (.moduleOutputs.marginalPortfolioImpact.rainierCalibration.status // "missing"),
    mpiCalibrationScaleFactor: (.moduleOutputs.marginalPortfolioImpact.rainierCalibration.scaleFactor // null),
    diagnostics,
    riskMetrics: {
      expectedLoss: .riskMetrics.expectedLoss,
      expectedLossRate: .riskMetrics.expectedLossRate
    }
  }' \
  '(.modelVersion | contains("+rainier"))
   and (.moduleOutputs.marginalPortfolioImpact.rainierCalibration.status == "applied")
   and (.yearOutcomes | length > 0)'

submit_and_wait_run \
  "pricing" \
  "$PRICING_PAYLOAD" \
  '{
    runId,
    modelVersion,
    priorVersion,
    posteriorSampleCount,
    pricingCalibrationStatus: (.moduleOutputs.propertyCatPricing.rainierCalibration.status // "missing"),
    pricingCalibrationScaleFactor: (.moduleOutputs.propertyCatPricing.rainierCalibration.scaleFactor // null),
    p99Loss: (.moduleOutputs.propertyCatPricing.summary.p99Loss // .moduleOutputs.propertyCatPricing.p99Loss // null),
    yltRowCount: (
      (.moduleOutputs.propertyCatPricing.yearLossTable.rows // .moduleOutputs.propertyCatPricing.rows // []) | length
    ),
    diagnostics
  }' \
  '(.modelVersion | contains("+rainier"))
   and (.moduleOutputs.propertyCatPricing.rainierCalibration.status == "applied")
   and (((.moduleOutputs.propertyCatPricing.yearLossTable.rows // .moduleOutputs.propertyCatPricing.rows // []) | length) > 0)
   and (.yearOutcomes | length > 0)'

submit_and_wait_run \
  "ils" \
  "$ILS_PAYLOAD" \
  '{
    runId,
    modelVersion,
    priorVersion,
    posteriorSampleCount,
    annualTriggerProbability: (.moduleOutputs.ilsParametricTrigger.annualTriggerProbability // null),
    annualExhaustionProbability: (.moduleOutputs.ilsParametricTrigger.annualExhaustionProbability // null),
    ilsCalibrationStatus: (.moduleOutputs.ilsParametricTrigger.rainierCalibration.status // "missing"),
    ilsCalibrationScaleFactor: (.moduleOutputs.ilsParametricTrigger.rainierCalibration.scaleFactor // null),
    simulationCount: (.moduleOutputs.ilsParametricTrigger.simulationCount // null),
    triggerRows: ((.moduleOutputs.ilsParametricTrigger.triggerSimulation // []) | length),
    riskMetrics: {
      expectedLoss: .riskMetrics.expectedLoss,
      expectedLossRate: .riskMetrics.expectedLossRate
    }
  }' \
  '(.modelVersion | contains("+rainier"))
   and (.moduleOutputs.ilsParametricTrigger.rainierCalibration.status == "applied")
   and ((.moduleOutputs.ilsParametricTrigger.simulationCount // 0) > 0)
   and (((.moduleOutputs.ilsParametricTrigger.triggerSimulation // []) | length) > 0)
   and (.yearOutcomes | length > 0)'

echo "All module smoke runs succeeded (MPI, Property-Cat Pricing, ILS Trigger)."
