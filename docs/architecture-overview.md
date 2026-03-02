# Architecture Overview (Phase 0)

## Purpose

This document defines the initial architectural boundaries for the Canopy Workbench monorepo and the local developer infrastructure required to support early implementation work.

## Phase 0 Goals

- Establish a repeatable local infrastructure baseline
- Define repository-level architectural boundaries and responsibilities
- Provide documentation scaffolding for future decisions and milestones
- Create a CI entry point that can be expanded as components become buildable/testable

## Monorepo Domains (High-Level)

- `apps/`: user-facing applications (web/API entry points and UI surfaces)
- `services/`: operational services (workers, schedulers, async processing)
- `scala/`: domain/analytics engines and model-oriented compute modules
- `schemas/`: contract definitions for APIs, payloads, and results
- `test-data/`: deterministic samples, golden outputs, fixtures
- `infra/`: infrastructure notes, CI/docker-related assets, deployment scaffolding

## Local Development Infrastructure (Phase 0)

The Phase 0 local stack includes:

- PostgreSQL: transactional and relational persistence
- Redis: cache, queue backing, and transient coordination
- MinIO: local S3-compatible object storage for binary artifacts and datasets

These services are provided through `docker-compose.yml` and are intended to support both app and service development without requiring cloud dependencies.

## Architectural Boundaries

- Phase 0 does not define production deployment topology yet.
- Phase 0 does not prescribe internal service-to-service protocols yet.
- Phase 0 does not implement runtime applications/services in this scaffold.
- Contract details are expected to live in `schemas/` and supporting docs (for example `docs/contracts.md` when introduced/updated by the owning team).

## Expected Near-Term Evolution

- Formalize service interfaces and contract versioning rules
- Introduce module-specific lint/test/build commands and CI wiring
- Add environment overlays for CI and production-like local workflows
- Define deployment targets (containers/Kubernetes/etc.) and IaC strategy

## Open Questions

- Which components are source-of-truth for API contracts (`schemas/openapi`, code-first generation, or both)?
- How will Scala modules be built/tested in CI relative to JS/TS services/apps?
- Will MinIO buckets be provisioned automatically in local dev, or lazily by services on startup?
