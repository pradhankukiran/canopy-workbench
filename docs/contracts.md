# Canopy Workbench Contracts (Phase 0)

This document defines the MVP contract/versioning conventions for API and schema artifacts under `schemas/`.

## Versioning Conventions

- API major versions are path-scoped (`/api/v1`) and documented in a matching OpenAPI file (`schemas/openapi/openapi.v1.yaml`).
- JSON and result contracts use JSON Schema 2020-12 and embed the major version in `$id` (for example `.../contracts/json/v1/...` and `.../contracts/results/v1/...`).
- Phase 0 filenames are stable skeleton names; a future breaking major should introduce parallel artifacts (`v2`) instead of replacing `v1`.
- Additive changes within `v1` are allowed (new optional fields, new endpoints, new enum values only when clients can tolerate them).
- Breaking changes require a new major (`v2`), including changes to required fields, field meaning, incompatible enum removals/renames, or path semantics.

## Core ID Conventions

IDs are opaque strings with a type prefix and lowercase alphanumeric suffix.

- General shape: `^([a-z]{2,8})_[a-z0-9]+$`
- Prefixes are stable contract surface area and should not be repurposed across entity types.
- Suffixes are opaque to clients (do not parse for timestamps/shards/versioning).

Current prefixes used in Phase 0:

- `usr_` user
- `ws_` workspace
- `upl_` upload
- `pf_` portfolio
- `deal_` candidate deal
- `job_` background job
- `run_` model run
- `rnev_` run lifecycle/progress event
- `evt_` event outcome record
- `req_` request/error correlation id
- `loc_` property location row

## Contract Scope (Phase 0)

- Control plane endpoints: `/me`, `/workspaces`, `/uploads`, `/jobs`, `/runs`, `/runs/{runId}/events`
- Module-specific run submission aliases (additive v1): `/property-cat-pricing/runs`, `/ils-parametric-trigger/runs`, `/marginal-portfolio-impact/runs`
- Input/domain schemas: portfolio and candidate deal payloads plus run submission
- Result schemas: event/year outcomes, risk metrics, posterior result bundle
- Additive v1 extensions may introduce optional module-specific request parameters and module result payloads (for example marginal portfolio impact, property cat pricing YLT summaries, or ILS parametric trigger summaries) without changing existing required fields
- ILS parametric trigger request payloads may include optional real-engine hints (for example `hurdat2Path`, `useScalaEngine`, and timeout fields) as additive `v1` module parameters

The current artifacts are intentionally MVP-level and should be extended by adding optional fields first.

Module-specific run submission endpoints are thin aliases over the shared run queue/orchestration pipeline. They exist to provide clearer contracts per module while preserving common run/job/result endpoints and backwards compatibility with `POST /runs`.
