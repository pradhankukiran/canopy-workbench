# Web App (`@canopy/web`)

Phase 1 frontend shell for Canopy Workbench (Vite + React + TypeScript).

## Current role

- Module selection landing page for the three Canopy workflows
- Shared workflow shell with review/run step
- Polling UI for `runs` and `jobs` control-plane endpoints
- Result summary rendering for the dummy `PosteriorBundle` response

## Current state

- Vite/React app scaffold with responsive styles
- Simple `fetch` API client with configurable base URL (`VITE_API_BASE_URL`)
- Demo run submission to `POST /api/v1/runs`
- Polling for `GET /api/v1/runs/:id`, `GET /api/v1/jobs/:id`, and results

## Commands (from repo root)

- `pnpm --filter @canopy/web dev`
- `pnpm --filter @canopy/web build`
- `pnpm --filter @canopy/web typecheck`

## Environment

- `VITE_API_BASE_URL` (default: `http://localhost:3001`)
