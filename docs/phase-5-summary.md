# Phase 5 — Frontend & Ops Polish

Final lift from "indicative-pricing engine with a stark dev UI" to "the
underwriter-facing tool a reinsurance broker could actually sit in
front of."

## Frontend (5.1 + 5.2)

### Layer editor (5.1a)
Table-driven reinsurance layer editor in the pricing form:

    Name          free-form label
    Attachment    numeric
    Limit         numeric
    Share         0-1 (default 1.0)
    Basis         occurrence | aggregate
    Reinstatements integer >= 0 (default 0)

Plus a PremiumTerms strip (risk-load shape & coefficient, brokerage %,
profit commission %) that unlocks once at least one layer exists.

`form-builders.ts` emits `moduleParameters.propertyCatPricing.layerTower`
and `.premiumTerms`; the Scala CLI's `parseLayerTower` / `parsePremiumTerms`
(phase 5) turn those JSON objects back into `LayerTower` / `PremiumTerms`
case classes.

### Technical premium panel (5.1b)
`TechnicalPremiumPanel` in the results view shows per-layer

    layer · pure loss · σ · risk-loaded · brokerage · PC · gross tech · RoL

plus the TVaR curve at every return period and the tower-trigger
frequencies (% of years any layer attached / all layers exhausted).
Silently absent when the run didn't configure a tower.

### Uncertainty bands on the exceedance chart (5.1c)
`LossExceedanceCurve` now takes `oepBand` + `aepBand` BandPoint[] and
renders semi-transparent AreaClosed envelopes behind the deterministic
OEP/AEP lines. The y-axis autoscales to include the p95 of each band.

### Upload UX (5.2)
- `accept=".json,.csv,.hurdat2,application/json,text/csv"` on the file
  input.
- `lib/portfolio-schema-check.ts` — client-side structural validator
  for the v2 schema. Runs on every JSON upload that looks portfolio-
  ish; surfaces up to 4 violation paths in an amber box with a
  "server still validates" footnote.

## Ops (5.3 + 5.5 + 5.6)

### Rate limiting + tenant isolation (5.6)
- `rate-limit.ts` — in-memory token-bucket rate limiter, 10 rps + 30
  burst default. 429 with Retry-After on exhaustion. Keys on API-key
  prefix (authenticated) or client IP (anonymous).
- `ensureRunInScope` — every run-read endpoint now checks
  `run.workspaceId === principal.workspaceId` and returns 404 (not
  403) for cross-tenant probes so the API never reveals other
  workspaces' runs.

### Real CI (5.3)
`.github/workflows/ci.yml` replaces the phase-0 placeholder echoes
with four dependent jobs:

    typecheck   pnpm -r typecheck
    test-ts     pnpm test (vitest)
    test-scala  sbt test (143 Scala cases) + golden-drift PR gate
    build       pnpm -r build

PR-only golden gate: if the `baseline/` golden JSON files moved, CI
fails unless the PR body carries a `GOLDEN_CHANGE` note explaining
drift direction and magnitude.

### Runbook + provenance (5.5)
- `docs/runbooks/failed-pricing-run.md` — symptom-first triage for
  the six most common failure modes (missing path, validation 400,
  sbt lock collision, Rainier non-convergence, timeout, hazard data
  unavailable), plus tenant-isolation surprises and rate-limit 429s.
- `docs/provenance-audit.md` — every physics model, vulnerability
  curve, external data artifact, and the explicit non-goal list
  ("NOT a vendor-validated catastrophe model, NOT regulator-rated").

## Test totals

  Scala:  143 cases (unchanged; phase 5 is mostly UX + plumbing)
  TS:     37 vitest cases total (added 6 rate-limit tests)

  pnpm -r typecheck clean across api/web/worker/scheduler.

## What's NOT in phase 5

- **OpenTelemetry + Prometheus metrics**. The engine + API are fine
  without them for the current single-node demo; a production deploy
  should add OTel SDK instrumentation and a `/metrics` endpoint.
  Deferred as a separate workstream.
- **Distributed rate limiting**. In-memory bucket is single-node.
- **Multi-tenant OIDC**. API-key auth is the production surface for
  now; OIDC plugs in under the `Principal` abstraction when needed.
- **Nightly integration test**. CI runs the unit + golden suites; a
  full docker-compose E2E test (API + worker + engine + postgres +
  redis + minio) would be a separate nightly workflow.
- **Pricing wizard multi-step UX**. The existing one-page form
  remains; a wizard stepping the underwriter through upload →
  enrichment preview → configure → review → submit is a future
  product iteration.
- **CSV portfolio upload**. The v2 schema is JSON. The upload UX
  accepts .csv files for future use but no CSV extractor is wired.

## Commit sequence

    6a0175d  feat(web+engine): reinsurance layer tower editor
    64830ab  feat(web): technical premium panel
    979770b  feat(web): shaded p05-p95 uncertainty bands on chart
    e94d6ef  feat(web): client-side portfolio schema check + accept filter
    99cd656  feat(api): per-caller rate limiting + tenant-scoped run access
    4da435d  ci: replace phase-0 placeholder workflow
    (this)   docs: runbook + provenance audit + phase 5 summary

Seven focused commits.
