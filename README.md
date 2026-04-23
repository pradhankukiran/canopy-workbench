<div align="center">

# Canopy Workbench

**Indicative catastrophe reinsurance pricing workbench: real physics-based hazard, Hazus-style vulnerability, stochastic event catalog, composable financial pipeline, and Bayesian uncertainty bands.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Scala](https://img.shields.io/badge/Scala-2.13-DC322F?logo=scala&logoColor=white)](https://www.scala-lang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)](https://fastify.dev/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://docs.docker.com/compose/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[Getting Started](#quick-start) &bull; [Architecture](#architecture) &bull; [API](#api) &bull; [Engines](#engines) &bull; [Docs](#documentation)

</div>

---

## What this is

A working indicative-pricing engine for Atlantic tropical cyclone exposures, not a vendor-validated catastrophe model. The engine moves a portfolio through the full underwriting pipeline: HURDAT2 hazard → Holland windfield → Hazus-style vulnerability → stochastic event catalog → per-peril financial terms → layer tower with reinstatements → technical premium with brokerage → TVaR at multiple RPs → posterior credible bands with real MCMC convergence reporting.

Built so an underwriter at a mid-size (re)insurer could sit in front of it, configure a deal, and get numbers back that pass structural sanity checks (AEP ≥ OEP, loss ≤ TIV, payout ≤ notional, net ≤ gross, TVaR ≥ VaR, monotone quantiles). **Not for binding business**; not regulator-rated. See [`docs/provenance-audit.md`](docs/provenance-audit.md) for the explicit non-assertions.

### What's live

| Module | Status | Notes |
|---|---|---|
| **Property Cat Pricing** | Working end-to-end | Holland windfield + Willoughby Rmax + Schwerdt asymmetry + Kaplan-DeMaria overland decay + ESDU roughness; Hazus curve lookup + Beta secondary uncertainty; Poisson event catalog + event-level bootstrap + perturbation; per-peril deductibles + sublimits; layer tower with reinstatements; technical premium with brokerage + profit commission; TVaR curve; posterior bands with MCMC diagnostics |
| **ILS Parametric Trigger** | Working end-to-end | HURDAT2-driven trigger/exhaustion sim with linear / binary / stepped payout curves, bounded by notional |
| **Marginal Portfolio Impact** | **Disabled** | `POST /api/v1/marginal-portfolio-impact/runs` returns HTTP 400. Engine still relies on synthetic heuristics; not yet production-hardened |

---

## Architecture

```
  Vercel (SPA)                    EC2 (Backend)
  ┌────────────────┐     ┌──────────────────────────────┐
  │  React + Vite  │     │  cloudflared (systemd)       │
  │  Tailwind CSS  │────>│    → localhost:3001          │
  └────────────────┘     │  ┌──────────────────────────┐│
                         │  │ docker-compose.prod.yml  ││
                         │  │  api      :3001          ││
                         │  │  worker   :4001          ││
                         │  │  postgres :5432          ││
                         │  │  redis    :6379          ││
                         │  │  minio    :9000          ││
                         │  └──────────────────────────┘│
                         └──────────────────────────────┘
```

**Request flow**: Web SPA → REST `/api/v1/*` → API validates (ajv) + authenticates (API-key or anonymous demo) → API enqueues to BullMQ → Worker hydrates inputs → Worker spawns Scala CLI via `sbt runMain` → Engine emits NDJSON progress on stderr + full result on stdout → Worker persists result to Postgres → SPA polls the result.

---

## Repository layout

```
apps/
  api/              Fastify API (Node/TypeScript)
                    auth (scrypt API keys), ajv schema validation,
                    token-bucket rate limit, tenant-scoped run access
  web/              React 19 + Vite SPA (Tailwind, Visx charts)
                    layer editor, premium panel, shaded band charts
                    DataSourcesPanel, portfolio schema check

services/
  worker/           BullMQ consumer; parses engine stderr heartbeats
                    into progress events
  scheduler/        (placeholder)

scala/
  canopy-data/              Shared data models + DataRegistry
  canopy-scenarios/         Scenario generation
  canopy-inference-rainier/ Bayesian inference (Rainier 0.3.5)
  canopy-engine-property/   Property Cat Pricing engine
      hazard/       Holland, Willoughby Rmax, Schwerdt asymmetry,
                    Kaplan-DeMaria overland decay, ESDU roughness,
                    LandMask, Saffir-Simpson storm surge
      vulnerability/ Hazus curves + Beta secondary uncertainty
      financial/    SiteTerms (per-peril), LayerTower, TechnicalPremium
      ylt/          FrequencyModel, EventBootstrap, EventPerturbation,
                    PosteriorBands
  canopy-engine-trigger/    ILS Parametric Trigger engine
  canopy-engine-portfolio/  Marginal Portfolio Impact (disabled)
  canopy-risk-metrics/      Risk metric helpers

schemas/            JSON schemas (v1 + v2 portfolio), OpenAPI
test-data/          HURDAT2 datasets, portfolio fixtures, golden
                    reference outputs
docs/               Phase summaries, runbook, provenance audit,
                    architecture decisions
infra/              Dockerfiles, deploy + tunnel scripts
.github/workflows/  Real CI (typecheck, tests, golden-drift gate, build)
```

---

## Quick start

### Prerequisites

| Tool | Version |
|------|---------|
| Docker | 24+ |
| Node.js | 22 LTS |
| pnpm | 9+ |
| JDK | 8+ (Temurin recommended) |
| SBT | 1.10+ |

### Setup

```bash
git clone https://github.com/pradhankukiran/canopy-workbench.git
cd canopy-workbench
pnpm install

cp .env.example .env

# Infra: postgres, redis, minio in the background
make dev-up

# Three services — each in its own terminal
make dev-api      # Fastify API on  :3001
make dev-worker   # BullMQ worker on :4001
make dev-web      # Vite SPA on     :5173
```

Stop everything:

```bash
make dev-down
```

### First engine run

```bash
# Submit a small pricing run against the bundled HURDAT2 sample
curl -sX POST http://localhost:3001/api/v1/property-cat-pricing/runs \
  -H 'Content-Type: application/json' \
  -d '{
    "analysisType": "pricing",
    "candidateDeal": {"portfolio": {"propertyPortfolio": {
      "portfolioId": "pf_demo","name":"demo","currency":"USD",
      "locations":[{"locationId":"loc1","country":"US","perilSet":["WIND"],"tiv":5000000,"latitude":27.0,"longitude":-80.0}]
    }}},
    "moduleParameters": {"propertyCatPricing": {
      "simulatedYears": 500,
      "returnPeriodsYears": [10, 50, 100],
      "hurdat2Path": "/absolute/path/to/test-data/hurdat2/atlantic_full.hurdat2"
    }}
  }' | jq .
```

Wait a few seconds, then:

```bash
curl -s http://localhost:3001/api/v1/runs/<runId>/results | jq .riskMetrics
```

Open http://localhost:5173/ to drive the same flow through the UI (upload panel, layer editor, shaded band chart, premium panel).

---

## API

All `/api/v1/*` endpoints require authentication when `CANOPY_ALLOW_ANONYMOUS=false`. In dev mode (default) unauthenticated calls resolve to the anonymous demo principal and land in the `ws_demo001` workspace. Production deployments should set `CANOPY_BOOTSTRAP_API_KEY` to seed a real key.

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Service health + Redis ping. Public. |
| `GET` | `/api/v1/me` | Resolved principal (userId, workspaceId, authSource) |
| `GET` | `/api/v1/workspaces` | Principal's workspace(s) |
| `GET` | `/api/v1/data-sources` | Registry status: coastline / SLOSH / bathymetry artifacts |
| `GET` | `/api/v1/uploads` | List uploads |
| `POST` | `/api/v1/uploads` | Register an upload |
| `GET` | `/api/v1/jobs` / `/api/v1/jobs/:id` | BullMQ job status |
| `POST` | `/api/v1/property-cat-pricing/runs` | Submit Pricing run (ajv-validates embedded portfolio) |
| `POST` | `/api/v1/ils-parametric-trigger/runs` | Submit Trigger run |
| `POST` | `/api/v1/marginal-portfolio-impact/runs` | **400** — module disabled |
| `GET` | `/api/v1/runs` / `/api/v1/runs/:id` | List / fetch run (tenant-scoped) |
| `GET` | `/api/v1/runs/:id/events` | Event stream (polled JSON, not SSE) |
| `GET` | `/api/v1/runs/:id/results` | Full engine output |

**Rate limit**: token-bucket, 10 rps sustained / 30 burst per key (or per IP for anonymous). Override via `API_RATE_LIMIT_RPS` / `API_RATE_LIMIT_BURST`.

**Tenant isolation**: a run's `workspaceId` must match the caller's principal; cross-tenant reads return 404 (not 403) so run existence isn't leaked.

**Validation**: `POST /api/v1/property-cat-pricing/runs` ajv-validates any embedded `candidateDeal.portfolio.propertyPortfolio`. Violations return HTTP 400 with `{path, message, keyword}` per rule.

---

## Engines

Scala 2.13 / SBT 1.10+. Worker shells out via:

```
sbt -batch -error "canopy-engine-property/runMain \
  canopy.engine.property.Hurdat2PropertyCatPricingYltCli \
  --input <path-to-request-json>"
```

Engines emit NDJSON progress heartbeats on stderr (`{"kind":"progress","phase":"…","fraction":0.37}`) and write the full posterior bundle to stdout.

| Engine | CLI main | Emits |
|---|---|---|
| Property Cat Pricing | `canopy.engine.property.Hurdat2PropertyCatPricingYltCli` | YLT rows, risk metrics, OEP/AEP/TVaR, layer premiums, posterior bands, enrichment log, Rainier calibration, diagnostics |
| ILS Parametric Trigger | `canopy.engine.trigger.Hurdat2IlsTriggerCli` | Trigger/exhaustion probabilities, payout distribution, Rainier calibration (scale factor reported, not applied uniformly) |

### Physics inside the Property Cat engine

| Stage | Implementation | Reference |
|---|---|---|
| Radial windfield | Holland 1980 parametric profile with B derived from V_max + Pc | Holland, MWR 108(8) 1980 |
| Rmax estimation | Willoughby, Darling & Rahn 2006 climatology with R34 override | Willoughby et al., MWR 134 2006 |
| Track asymmetry | Schwerdt 1979 with k=0.55 and hemisphere sign flip | NOAA Tech Rep NWS-23 |
| Overland decay | Kaplan & DeMaria 1995 exponential filling, V_b=26.7 kt, a=0.095/hr | Kaplan & DeMaria, JAM 34 1995 |
| Surface roughness | ESDU 85020 / ASCE 7-16 exposure factors | ESDU standards |
| Vulnerability | Hazus HM4-style curves by construction × occupancy × stories × code era | FEMA Hazus HM4 Technical Manual (curves stylized; see `PROVENANCE.md`) |
| Secondary uncertainty | Beta-distributed MDR jitter (CV ~ 0.35 default) | Hazus HM4 Section 5.4 |
| Event catalog | Poisson frequency + event-level bootstrap + mean-1 lognormal perturbation | — |
| Calibration | Rainier (Stripe) logit-normal on historical ALR history | — |
| Uncertainty bands | 500-sample bootstrap on quantiles (simulation-sampling noise) | — |

Physics invariants enforced by 9 ScalaCheck property tests (AEP ≥ OEP, TVaR ≥ VaR, loss ≤ TIV, net ≤ gross, deductible ≥ TIV ⇒ insured = 0, OEP monotone in RP, seed reproducibility, zero-event floor, non-negative expected loss).

---

## Configuration

| Env var | Default | Notes |
|---|---|---|
| `API_PORT` | `3001` | — |
| `WORKER_PORT` | `4001` | Health only |
| `REDIS_URL` | `redis://127.0.0.1:6379` | — |
| `DATABASE_URL` | unset | Enables Postgres persistence (required for API-key auth) |
| `CANOPY_ALLOW_ANONYMOUS` | `true` | Set `false` in prod |
| `CANOPY_DEMO_WORKSPACE_ID` | `ws_demo001` | Anonymous-fallback workspace |
| `CANOPY_BOOTSTRAP_API_KEY` | unset | Upserts on API boot if present |
| `CANOPY_DATA_CACHE_DIR` | `~/.canopy-workbench/data` | Hazard artifact cache |
| `API_RATE_LIMIT_RPS` | `10` | Per-key sustained rate |
| `API_RATE_LIMIT_BURST` | `30` | Per-key burst |
| `WORKER_CONCURRENCY` | `2` | BullMQ worker concurrency |
| `WORKER_PROPERTY_PRICING_SCALA_CLI_COMMAND` | `sbt -batch -error "…"` | Engine invocation template |

---

## Tests & CI

```bash
pnpm -r typecheck           # api/web/worker/scheduler — all clean
pnpm test                   # 37 vitest cases across api + worker
sbt test                    # 143 ScalaTest + ScalaCheck cases
```

**Golden files** live under `scala/canopy-engine-property/src/test/resources/golden/baseline/`. Five frozen scenarios. To regenerate after an intentional numerical change:

```bash
CANOPY_GOLDEN_UPDATE=1 sbt 'canopy-engine-property/testOnly canopy.engine.property.BaselineGoldenSpec'
```

CI (`.github/workflows/ci.yml`) runs typecheck → test-ts → test-scala → build. The scala job fails a PR if goldens moved without a `GOLDEN_CHANGE` note in the PR body.

---

## Production deployment

```bash
# On EC2
git clone https://github.com/pradhankukiran/canopy-workbench.git
cd canopy-workbench

# Cloudflare tunnel (prints the *.trycloudflare.com URL)
sudo ./infra/scripts/setup-cloudflare-tunnel.sh

# Build + start the full stack
./infra/scripts/deploy.sh --no-pull

# Subsequent deploys
./infra/scripts/deploy.sh
```

Override defaults via `.env.production` (`cp .env.production.example .env.production`).

For Vercel: import the repo, set `VITE_API_BASE_URL` to the tunnel URL. Build settings are auto-detected from `apps/web/vercel.json`.

---

## Tech stack

| Layer | |
|---|---|
| **Frontend** | React 19, Vite 5, Tailwind, Visx, react-hook-form + Zod, lucide-react |
| **API** | Fastify 5, BullMQ, ioredis, ajv 8 + ajv-formats, `node:crypto` scrypt |
| **Worker** | BullMQ, Node child_process, NDJSON stderr parser |
| **Engines** | Scala 2.13, SBT 1.10+, ujson, Stripe Rainier 0.3.5 |
| **Testing** | Vitest 2, ScalaTest 3.2 + ScalaCheck 1.18, property-based invariants, tolerance-based golden comparison |
| **Storage** | PostgreSQL 16 (raw SQL), Redis 7, MinIO (S3-compat) |
| **Infra** | Docker Compose, Cloudflare Tunnel, Vercel, GitHub Actions |

---

## Documentation

| File | What it's for |
|---|---|
| [`docs/property-cat-pricing-design.md`](docs/property-cat-pricing-design.md) | Architecture decision record (D1–D8) |
| [`docs/phase-2-golden-drift.md`](docs/phase-2-golden-drift.md) | Physics + vulnerability upgrade, per-commit drift record |
| [`docs/phase-3-financial-pipeline.md`](docs/phase-3-financial-pipeline.md) | Event catalog + layer tower + premium |
| [`docs/phase-4-uncertainty-bands.md`](docs/phase-4-uncertainty-bands.md) | Credible bands + convergence gates |
| [`docs/phase-5-summary.md`](docs/phase-5-summary.md) | Frontend UX + ops polish |
| [`docs/runbooks/failed-pricing-run.md`](docs/runbooks/failed-pricing-run.md) | Triage guide for the six most common failure modes |
| [`docs/provenance-audit.md`](docs/provenance-audit.md) | Every external dataset, published formula, and license |
| [`docs/architecture-overview.md`](docs/architecture-overview.md) | Original architecture intent |

---

## Known issues

- **Concurrent sbt invocations collide** on `~/.sbt/boot/sbt.boot.lock`. Submitting two runs within the same second can fail the second with `Address already in use`. Resolution: retry, or serialize engine invocations. See runbook §3.
- **Rainier posterior is reported, not applied to the point estimates**. The scale factor is emitted on `rainierCalibration.scaleFactor`; consumers that want a calibration-adjusted view apply it explicitly. The bands reflect simulation-sampling uncertainty only.
- **SLOSH MEOW data loader** is scaffolded in the DataRegistry but not wired; surge is currently parametric Saffir-Simpson.
- **Natural Earth coastline loader** is scaffolded; overland decay uses a coarse built-in US coast polygon mask.
- **Marginal Portfolio Impact** is disabled — engine still relies on synthetic heuristics.

---

## Contributing

Please open an issue first to discuss the change. Then:

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/…`)
3. Make the change with tests + a phase/drift doc update if physics or goldens move
4. Push and open a PR

CI must stay green. Goldens that drift require a `GOLDEN_CHANGE` note in the PR body.

---

## License

MIT. See [`LICENSE`](LICENSE).
