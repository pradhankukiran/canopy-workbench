# Canopy Workbench

Full-stack catastrophe-analytics workbench: React SPA, Fastify API, BullMQ worker, and Scala pricing/risk engines.

## Architecture

```
  Vercel                          EC2
  ┌────────────────┐     ┌──────────────────────────────┐
  │  React SPA     │     │  cloudflared (systemd)       │
  │  (Vite build)  │────>│    → localhost:3001           │
  └────────────────┘     │  ┌──────────────────────────┐ │
                         │  │ docker-compose.prod.yml  │ │
                         │  │  api      :3001          │ │
                         │  │  worker   :4001          │ │
                         │  │  postgres :5432          │ │
                         │  │  redis    :6379          │ │
                         │  │  minio    :9000          │ │
                         │  └──────────────────────────┘ │
                         └──────────────────────────────┘
```

The SPA is deployed to Vercel. The backend runs on a single EC2 instance behind a Cloudflare quick tunnel for HTTPS.

## Repository Layout

```
apps/
  api/              Fastify control-plane API (uploads, runs, jobs)
  web/              React + Vite + Tailwind SPA
services/
  worker/           BullMQ worker — orchestrates Scala engines
  scheduler/        (future) scheduled job runner
scala/
  canopy-data/              Shared data models
  canopy-scenarios/         Scenario generation
  canopy-inference-rainier/ Bayesian inference (Rainier)
  canopy-engine-property/   Property Cat Pricing YLT engine
  canopy-engine-trigger/    ILS Parametric Trigger engine
  canopy-engine-portfolio/  Marginal Portfolio Impact engine
  canopy-risk-metrics/      Risk metric calculations
schemas/            JSON schemas and OpenAPI specs
infra/
  docker/           Dockerfile.api, Dockerfile.worker
  scripts/          deploy.sh, setup-cloudflare-tunnel.sh
test-data/          HURDAT2 datasets, golden outputs, sample inputs
docs/               Architecture notes, ADRs
```

## Quick Start (Local Dev)

Prerequisites: Docker, Node 22, pnpm 9, JDK 8+, SBT 1.10.

```bash
# 1. Set up env
cp .env.example .env

# 2. Start infra (Postgres, Redis, MinIO)
make dev-up

# 3. Start services (separate terminals)
make dev-api      # API on localhost:3001
make dev-worker   # Worker on localhost:4001
make dev-web      # SPA on localhost:5173
```

Stop everything:

```bash
make dev-down
```

## Production Deployment

### EC2

```bash
git clone <repo-url> ~/canopy-workbench && cd ~/canopy-workbench

# Install cloudflared and start the tunnel (prints the *.trycloudflare.com URL)
sudo ./infra/scripts/setup-cloudflare-tunnel.sh

# Build and start the stack
./infra/scripts/deploy.sh --no-pull
```

Subsequent deploys:

```bash
./infra/scripts/deploy.sh
```

The compose file uses sensible defaults for all secrets — no `.env` file required. Override any var by exporting it before running deploy, or create an `.env.production` file next to the compose file.

### Vercel

Import the repo into Vercel and add one env var:

| Variable | Value |
|----------|-------|
| `VITE_API_BASE_URL` | The `*.trycloudflare.com` URL from the tunnel setup |

Build settings are auto-detected from `apps/web/vercel.json`.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Service health + Redis ping |
| GET | `/api/v1/me` | Current user |
| GET | `/api/v1/workspaces` | List workspaces |
| GET/POST | `/api/v1/uploads` | List / create uploads |
| GET | `/api/v1/jobs` | List jobs |
| GET | `/api/v1/jobs/:jobId` | Job status |
| POST | `/api/v1/runs` | Submit a run (generic) |
| POST | `/api/v1/property-cat-pricing/runs` | Submit pricing run |
| POST | `/api/v1/ils-parametric-trigger/runs` | Submit ILS trigger run |
| GET | `/api/v1/runs/:runId` | Run status |
| GET | `/api/v1/runs/:runId/events` | Run event stream |
| GET | `/api/v1/runs/:runId/results` | Run results |

## Scala Engines

Built with SBT (`sbt compile`). The worker shells out to these via CLI:

- **Property Cat Pricing** — `canopy-engine-property/runMain ...Hurdat2PropertyCatPricingYltCli`
- **ILS Parametric Trigger** — `canopy-engine-trigger/runMain ...Hurdat2IlsTriggerCli`
- **Marginal Portfolio Impact** — `canopy-engine-portfolio/runMain ...MarginalPortfolioImpactCli`

Each engine reads a JSON `--input` file and writes results to stdout.

## Makefile Targets

```
make help        Show all targets
make setup       Create .env from .env.example
make dev-up      Start Postgres, Redis, MinIO
make dev-down    Stop infra containers
make dev-api     Run API in dev mode
make dev-worker  Run worker in dev mode
make dev-web     Run SPA in dev mode
make smoke-e2e   Run API+worker smoke test
```
