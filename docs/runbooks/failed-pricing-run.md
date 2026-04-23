# Runbook — Failed Property Cat Pricing Run

## Symptoms

- User reports "my run is stuck" or "my run says failed".
- API returns `state: "failed"` on `GET /api/v1/runs/:runId`.
- Worker logs emit `{"level":"error","msg":"property pricing scala cli failed"}`.

## First checks (2 minutes)

1. **Is the stack up?**
   ```
   curl -s http://localhost:3001/health   # API
   curl -s http://localhost:4001/health   # worker
   docker compose ps                      # postgres / redis / minio
   ```
   All three services must respond. If not, restart the stack with
   `make dev-up` (local) or restart the containers (prod).

2. **Did the run make it to the worker?**
   ```
   curl -s http://localhost:3001/api/v1/runs/<runId> | jq .
   ```
   State progression: `queued` → `validating` → `running` → `post-processing` → `succeeded` | `failed`.

3. **Fetch the run events for the full timeline.**
   ```
   curl -s http://localhost:3001/api/v1/runs/<runId>/events | jq '.items[] | {stage, status, message}'
   ```

## Failure modes (most common first)

### 1. Engine stdout is empty / non-JSON (malformed input)

Worker error message: `Scala CLI exited with code 1`.
Worker logs include `stdoutPreview` with a Scala exception, usually
`java.nio.file.NoSuchFileException` or `ujson.IncompleteParseException`.

**Cause:** A path referenced in the request (hurdat2Path or
propertyPortfolioPath) doesn't exist relative to the CLI's working
directory, or the uploaded file is not JSON.

**Fix:** Verify the upload registered, apply paths from the upload
panel (the "Use Paths" button copies the resolved storagePath into
the form), and re-submit.

### 2. Portfolio validation failure (phase 1.1)

API returns 400 with `error.code == "invalid_property_portfolio"` and
a list of JSON-Pointer violations.

**Cause:** Request body carries a portfolio that fails the ajv schema
check.

**Fix:** Paste the portfolio into a validator. The web upload panel
does a local schema check (phase 5.2) that catches 90% of these; the
server's ajv is authoritative.

### 3. sbt port collision

Worker stderr: `java.io.IOException: org.scalasbt.ipcsocket.NativeErrorException: [98] Address already in use`.

**Cause:** A previous sbt daemon is still holding
`~/.sbt/boot/sbt.boot.lock`.

**Fix:**
   ```
   pkill -f 'sbt.*canopy-engine-property'
   rm -f ~/.sbt/boot/sbt.boot.lock
   ```
Re-submit the run.

### 4. Rainier convergence failed

Run succeeds but `diagnostics.status == "failed"` and the
`warnings` array lists R-hat or ESS violations.

**Cause:** Observed history too small or too noisy for Rainier to
converge in the configured iterations.

**Fix:** Non-critical — the deterministic outputs are still valid.
The posterior bands reflect bootstrap-only uncertainty. To get real
Rainier bands, increase observed-rate count or bump engine profile
to "full" (doubles warmup + iteration count).

### 5. Run timed out

Worker error: `Scala CLI timed out after <N>ms`.

**Cause:** Large portfolio x many simulated years, or sbt cold-start
on a fresh deploy.

**Fix:** Increase `scalaEngineTimeoutMs` in the pricing form
(overrides the env default).

### 6. Hazard data unavailable

Worker logs show degraded-mode execution; the engine output may lack
overland decay or storm-surge contributions.

**Check the registry:**
   ```
   curl -s http://localhost:3001/api/v1/data-sources | jq .
   ```

**Fix:** Artifacts download on worker boot. If the registry shows
`state: "missing"` or `state: "unavailable"`, check outbound network
to `naciscdn.org` / `nhc.noaa.gov`. If those URLs aren't reachable
from the deployment, set `CANOPY_DATA_CACHE_DIR` to a pre-populated
directory.

## Tenant isolation surprise

User says "my run disappeared".

**Cause:** The phase 5.6 `ensureRunInScope` helper returns 404 when a
run's workspace doesn't match the caller's principal. A caller who
switched API keys will stop seeing runs created under a different
key's workspace.

**Fix:** Confirm the API key's workspaceId via `GET /api/v1/me`. If
the run was created under a different workspace, switch keys or
request cross-workspace access (not implemented; out of scope
for phase 5).

## Rate-limit 429s

Caller reports HTTP 429 with `retry_after` header.

**Cause:** The in-process token bucket (phase 5.6) limits each key to
`API_RATE_LIMIT_RPS` sustained with a burst of `API_RATE_LIMIT_BURST`.

**Fix:** Back off per Retry-After, or raise the limits in the
deployment env. Only a single-node concern today; a distributed
deploy should swap to a Redis-backed rate limiter.

## Escalation

If the run fails for reasons not covered above:

1. Capture `GET /api/v1/runs/:runId`, `/events`, and
   `/data-sources`.
2. Grab the worker log slice for the run:
   ```
   journalctl -u canopy-worker --since "10 min ago" | grep <runId>
   ```
3. Open a GitHub issue with those three artefacts plus the request
   body.
