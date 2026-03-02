# API Service (`@canopy/api`)

Phase 1 Fastify control-plane API stub for Canopy Workbench.

## Current role

- Expose Phase 1 endpoints for `/api/v1/me`, `/workspaces`, `/uploads`, `/jobs`, `/runs`
- Persist stub state in Redis
- Enqueue dummy async runs into BullMQ for worker processing
- Return dummy run results matching the `PosteriorBundle` contract shape

## Current state

- Fastify + CORS server
- Redis-backed state store
- BullMQ queue producer for run execution
- TypeScript build + dev scripts

## Commands (from repo root)

- `pnpm --filter @canopy/api dev`
- `pnpm --filter @canopy/api build`
- `pnpm --filter @canopy/api typecheck`

## Environment

- `API_PORT` (default: `3001`)
- `API_HOST` (default: `0.0.0.0`)
- `REDIS_URL`
- `CANOPY_REDIS_PREFIX`
- `CANOPY_RUN_QUEUE`
