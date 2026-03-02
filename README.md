# Canopy Workbench

Monorepo for the Canopy Workbench platform, applications, services, schemas, and analytics engines.

This repository now includes a **Phase 1 vertical slice**:
- React/Vite frontend shell (`apps/web`)
- Fastify control-plane API stub (`apps/api`)
- BullMQ/Redis async worker (`services/worker`)
- Dummy submit -> poll -> results workflow for end-to-end integration

## Current Scope (Phase 0 + Phase 1)

- Local development infrastructure via Docker Compose (`postgres`, `redis`, `minio`)
- Basic developer workflow commands via `Makefile`
- Environment variable template (`.env.example`)
- CI workflow skeleton (`.github/workflows/ci.yml`)
- Architecture and decision-record documentation scaffolding
- Frontend module chooser + workflow shell + run polling UI
- API endpoints for `/api/v1/me`, `/workspaces`, `/uploads`, `/jobs`, `/runs`
- Worker-driven dummy async run lifecycle (`queued -> validating -> running -> succeeded`)

## Quick Start (Local Infra)

1. Initialize local env file:

   ```bash
   make setup
   ```

2. Start local infrastructure:

   ```bash
   make dev-up
   ```

   If Docker is unavailable, start a Redis instance another way and set `REDIS_URL` in `.env`.

3. Start the Phase 1 services (separate terminals):

   ```bash
   make dev-api
   make dev-worker
   make dev-web
   ```

4. Tail infra logs (optional):

   ```bash
   make dev-logs
   ```

5. Stop the stack:

   ```bash
   make dev-down
   ```

## Local Services

| Service | Purpose | Default Endpoint |
| --- | --- | --- |
| PostgreSQL | Primary relational store | `localhost:5432` |
| Redis | Cache / queues / ephemeral state | `localhost:6379` |
| MinIO | S3-compatible object storage | API `http://localhost:9000`, Console `http://localhost:9001` |

MinIO credentials and other defaults are defined in `.env.example` and can be overridden in `.env`.

## Repository Layout (Top Level)

- `apps/` user-facing applications (not part of Phase 0 scaffolding)
- `services/` backend/background services
- `scala/` Scala engines and analytics modules
- `schemas/` API/result schemas and contracts
- `infra/` infrastructure-related notes and future assets
- `docs/` architecture notes, ADR template, phase tracking docs

## Docs

- `docs/architecture-overview.md`
- `docs/adr-template.md`
- `docs/phase-0-notes.md`

## Notes

- `Makefile` targets `lint`, `test`, and `build` are still placeholders.
- CI jobs are intentionally skeletal and should be wired to repo-specific commands as the codebase matures.
- The Phase 1 API/worker vertical slice requires Redis; Docker Compose is the default local path.
