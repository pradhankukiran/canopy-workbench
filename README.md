<div align="center">

# Canopy Workbench

**Full-stack catastrophe analytics platform for insurance and reinsurance pricing, ILS modeling, and portfolio risk.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Scala](https://img.shields.io/badge/Scala-2.13-DC322F?logo=scala&logoColor=white)](https://www.scala-lang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)](https://fastify.dev/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://docs.docker.com/compose/)
[![Vercel](https://img.shields.io/badge/Deployed_on-Vercel-000000?logo=vercel&logoColor=white)](https://vercel.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://makeapullrequest.com)

[Getting Started](#quick-start-local-dev) &bull; [Architecture](#architecture) &bull; [API Reference](#api-endpoints) &bull; [Engines](#scala-engines) &bull; [Deployment](#production-deployment)

</div>

---

## Overview

Canopy Workbench is an end-to-end catastrophe analytics workbench that lets (re)insurance teams upload hazard data, run pricing and risk engines, and explore results through an interactive dashboard. It combines a **React SPA**, a **Fastify API**, a **BullMQ job worker**, and purpose-built **Scala pricing/risk engines** into a single deployable stack.

### Key Features

- **Property Cat Pricing** &mdash; Generate year-loss tables (YLT) from HURDAT2 hurricane track data with configurable return periods, loss bases, and portfolio inputs.
- **ILS Parametric Trigger** &mdash; Model insurance-linked securities with trigger/exhaustion probability, payout curves, and scenario scatter analysis.
- **Marginal Portfolio Impact** &mdash; Assess tail-risk impact of adding a new position to an existing portfolio with before/after comparison metrics.
- **Bayesian Inference (Rainier)** &mdash; Run posterior sampling with convergence diagnostics (R-hat, ESS) for probabilistic hazard models.
- **Interactive Charts** &mdash; Loss exceedance curves, scenario scatter plots, year-outcome distributions, and risk metric dashboards powered by Visx.
- **Job Queue** &mdash; Async BullMQ pipeline with real-time SSE event streaming, progress tracking, and automatic retry.
- **Dual Storage** &mdash; Redis for hot state with PostgreSQL mirror for durability and queryability.

---

## Architecture

```
  Vercel (SPA)                    EC2 (Backend)
  ┌────────────────┐     ┌──────────────────────────────┐
  │  React + Vite  │     │  cloudflared (systemd)       │
  │  Tailwind CSS  │────>│    → localhost:3001           │
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

The **SPA** is deployed to Vercel with automatic preview deploys. The **backend** runs on a single EC2 instance behind a Cloudflare quick tunnel for zero-config HTTPS.

---

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

---

## Quick Start (Local Dev)

### Prerequisites

| Tool | Version |
|------|---------|
| Docker | 24+ |
| Node.js | 22 LTS |
| pnpm | 9+ |
| JDK | 8+ |
| SBT | 1.10+ |

### Setup

```bash
# 1. Clone and install
git clone https://github.com/pradhankukiran/canopy-workbench.git
cd canopy-workbench
pnpm install

# 2. Set up environment
cp .env.example .env

# 3. Start infrastructure (Postgres, Redis, MinIO)
make dev-up

# 4. Start services (in separate terminals)
make dev-api      # API on localhost:3001
make dev-worker   # Worker on localhost:4001
make dev-web      # SPA on localhost:5173
```

Stop everything:

```bash
make dev-down
```

---

## Production Deployment

### EC2

```bash
git clone https://github.com/pradhankukiran/canopy-workbench.git ~/canopy-workbench
cd ~/canopy-workbench

# Install cloudflared and start the tunnel (prints the *.trycloudflare.com URL)
sudo ./infra/scripts/setup-cloudflare-tunnel.sh

# Build and start the stack
./infra/scripts/deploy.sh --no-pull
```

Subsequent deploys:

```bash
./infra/scripts/deploy.sh
```

The compose file uses sensible defaults for all secrets. Override any var by exporting it before running deploy, or create an `.env.production` file from the example:

```bash
cp .env.production.example .env.production
```

### Vercel

Import the repo into Vercel and add one env var:

| Variable | Value |
|----------|-------|
| `VITE_API_BASE_URL` | The `*.trycloudflare.com` URL from the tunnel setup |

Build settings are auto-detected from `apps/web/vercel.json`.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Service health + Redis ping |
| `GET` | `/api/v1/me` | Current user |
| `GET` | `/api/v1/workspaces` | List workspaces |
| `GET` | `/api/v1/uploads` | List uploads |
| `POST` | `/api/v1/uploads` | Create upload |
| `GET` | `/api/v1/jobs` | List jobs |
| `GET` | `/api/v1/jobs/:jobId` | Job status |
| `POST` | `/api/v1/runs` | Submit a run (generic) |
| `POST` | `/api/v1/property-cat-pricing/runs` | Submit pricing run |
| `POST` | `/api/v1/ils-parametric-trigger/runs` | Submit ILS trigger run |
| `GET` | `/api/v1/runs/:runId` | Run status |
| `GET` | `/api/v1/runs/:runId/events` | Run event stream (SSE) |
| `GET` | `/api/v1/runs/:runId/results` | Run results |

---

## Scala Engines

Built with SBT (`sbt compile`). The worker shells out to these via CLI:

| Engine | Entry Point | Description |
|--------|-------------|-------------|
| **Property Cat Pricing** | `canopy-engine-property/runMain ...Hurdat2PropertyCatPricingYltCli` | YLT generation from hurricane tracks |
| **ILS Parametric Trigger** | `canopy-engine-trigger/runMain ...Hurdat2IlsTriggerCli` | Parametric trigger simulation |
| **Marginal Portfolio Impact** | `canopy-engine-portfolio/runMain ...MarginalPortfolioImpactCli` | Portfolio tail-risk analysis |

Each engine reads a JSON `--input` file and writes results to stdout.

---

## Makefile Targets

```
make help          Show all targets
make setup         Create .env from .env.example
make dev-up        Start Postgres, Redis, MinIO
make dev-down      Stop infra containers
make dev-api       Run API in dev mode
make dev-worker    Run worker in dev mode
make dev-web       Run SPA in dev mode
make smoke-e2e     Run API+worker smoke test
```

---

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Frontend** | React 19, Vite, Tailwind CSS, Visx, Zod |
| **API** | Fastify 5, BullMQ, ioredis |
| **Worker** | BullMQ, Node.js child processes |
| **Engines** | Scala 2.13, SBT, Rainier (Bayesian) |
| **Storage** | PostgreSQL 16, Redis 7, MinIO (S3) |
| **Infra** | Docker Compose, Cloudflare Tunnel, Vercel |

---

## Contributing

Contributions are welcome! Please open an issue first to discuss what you'd like to change.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for more information.
