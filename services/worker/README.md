# Worker Service (`@canopy/worker`)

Phase 1 BullMQ worker for Canopy Workbench async runs.

## Current role

- Consume queued run jobs from Redis/BullMQ
- Progress job/run state through `queued -> validating -> running -> succeeded`
- Write a dummy `PosteriorBundle`-like result payload back to Redis
- Expose a minimal `/health` endpoint for local checks

## Current state

- Real worker implementation with Redis state updates
- Local HTTP health endpoint
- TypeScript build + dev scripts

## Commands (from repo root)

- `pnpm --filter @canopy/worker dev`
- `pnpm --filter @canopy/worker build`
- `pnpm --filter @canopy/worker typecheck`

## Environment

- `WORKER_PORT` (default: `4001`)
- `WORKER_CONCURRENCY`
- `WORKER_STEP_DELAY_MS`
- `REDIS_URL`
- `CANOPY_REDIS_PREFIX`
- `CANOPY_RUN_QUEUE`
