# Phase 0 Notes

## Objective

Create a stable repository baseline for platform/infra/docs work so feature teams can begin implementation without blocking on local dependencies or repo conventions.

## Delivered Scaffolding

- Root `README.md` with local infra quick start
- `.env.example` with local service defaults
- `docker-compose.yml` for PostgreSQL, Redis, and MinIO
- `Makefile` with setup/dev and placeholder lint/test/build targets
- `.github/workflows/ci.yml` placeholder pipeline
- Architecture overview and ADR template docs

## Conventions (Initial)

- Keep local-only secrets in `.env` (never commit)
- Use `docker compose` for Phase 0 local dependency management
- Treat CI jobs as wiring points until component-specific commands exist
- Record non-trivial architecture decisions via ADRs before broad rollout

## Known Gaps / Follow-Up

- Real lint/test/build commands per module are not yet defined
- No production deployment or IaC strategy is defined yet
- No automated bucket/bootstrap initialization for MinIO yet
- No cross-language version/build orchestration is defined

## Handoff Notes

- App/service teams can rely on local Postgres/Redis/MinIO endpoints from `.env.example`
- Platform owners should replace CI placeholders incrementally as modules become executable
- Future infra assets (Dockerfiles, CI scripts, deploy manifests) should be organized under `infra/`
