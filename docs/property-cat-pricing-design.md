# Property Cat Pricing — Architecture Decisions

This document records the architectural decisions that govern the production
hardening of the Property Cat Pricing module. Each decision is actionable:
disagreement invalidates later workstreams.

Status: proposed (awaiting sign-off from engineering + actuarial reviewers).

## Context

The current module is MVP-grade: schema-complete but semantically hollow.
Observed gaps:

- Hazard: exponential distance-decay only (no windfield).
- Vulnerability: single `x^2.25` power curve for every structure.
- Financial: per-site deductible + limit only (no layers, reinstatements,
  brokerage, profit commission, or technical-premium formula).
- Event catalog: whole-year historical bootstrap (no Poisson frequency,
  no event-level perturbation).
- Bayesian calibration: single scalar post-hoc scale factor; fake convergence
  diagnostics emitted when the MCMC is skipped.
- Orchestration: no JSON-schema validation, hardcoded demo user/workspace,
  fake progress events, ~600 lines of dead synthetic-pricing code in the
  worker.

The target is "production-grade indicative pricing" — numerically coherent
enough that an underwriter at a mid-size (re)insurer could quote from it.
Not vendor-validated cat-model territory.

## Decisions

### D1 — Event catalog strategy

**Decision:** Hybrid. Fit a Poisson frequency per basin, bootstrap events
(not whole years), perturb each sampled event on landfall position, central
pressure, Rmax, forward speed, and heading.

**Alternatives:**

- Pure synthetic catalog (fit track/intensity distributions, sample new
  storms). Rejected for this cycle — 4 to 8 weeks of statistical modelling
  and the single largest timeline risk.
- Keep the whole-year bootstrap. Rejected — it tautologically flattens
  every quantile and collapses variance.

**Implication:** the `hazard/` package must accept a `BasinCatalog` interface
so a synthetic catalog can slot in later without touching the simulator.

### D2 — Windfield model

**Decision:** Holland (1980) radial profile plus translation-speed asymmetry
(Schwerdt coefficient ≈ 0.55) plus Kaplan–DeMaria 1995 overland decay.

**Alternatives:**

- Keep exponential decay. Rejected — no physical basis; underestimates
  landfall intensity, which dominates loss.
- Emanuel–Rotunna or CLIMADA-style full boundary-layer model. Deferred —
  research-grade; not justified for indicative pricing.

**Implication:** consume `minPressureMb` from HURDAT2 (currently parsed and
ignored). Estimate Rmax via Willoughby 2006 when HURDAT2 is missing the
wind radii (pre-2004).

### D3 — Vulnerability library

**Decision:** Ship Hazus HM4 wind vulnerability curves as CSV data in
`canopy-data/src/main/resources/vulnerability/`. Look up by
`(construction class × occupancy × stories × code era)`. Commit provenance
per file in `PROVENANCE.md`.

**Alternatives:**

- Keep the single power curve. Rejected.
- Synthesize curves in code. Rejected — hides provenance; makes audit hard.
- Build our own via lab/historical loss calibration. Out of scope.

**Implication:** portfolio schema must carry construction class, year built,
stories, code era (D6).

### D4 — Secondary uncertainty

**Decision:** Beta-distributed jitter around the mean damage ratio per
(event × location), with CV sourced from Hazus. Combine with portfolio-
level posterior bands from Rainier (D5).

**Alternatives:**

- Skip. Rejected — produces deterministic point estimates the market does
  not recognize.
- Full posterior-predictive via Rainier per (event × location). Rejected —
  too expensive and redundant with event-level jitter.

### D5 — Rainier's role

**Decision:** Posterior-predictive calibration per quantile. Treat the
simulated YLT as prior-predictive, the observed annual-loss-rate history as
likelihood, and emit posterior mean plus 90% credible band for every
return-period point (OEP/AEP at RP 10, 20, 50, 100, 250, 500, 1000).

**Alternatives:**

- Remove Rainier. Rejected — wastes sunk integration; underwriters expect
  uncertainty bands.
- Keep the scalar scale-factor. Rejected — collapses all posterior mass to
  a single number and applies it to every quantile identically.

**Implication:** the output schema gains `{mean, p05, p95}` tuples per
return-period point. The current single `scaleFactor` field is deprecated.

### D6 — Portfolio schema evolution

**Decision:** Additive evolution. Keep all v1 fields optional; add v2 fields
as optional with `$id` bumped to `/v2/`. Both schemas remain valid for one
release cycle. An `enrichPortfolio()` step fills missing v2 fields from
country/region defaults and emits an `enrichmentLog` per location in the
run output.

**Alternatives:**

- Breaking change. Rejected — constraint says backwards-compatible.
- v2 only. Rejected — same reason.

**Implication:** every run output includes an enrichment log so underwriters
can see what was defaulted.

### D7 — Financial model shape

**Decision:** Composable pipeline.

```
GroundUp → SiteTerms → PortfolioTerms → LayerTower → Cedent/Reinsurer → TechnicalPremium
```

Each stage is a pure function, independently unit-tested. `SiteTerms` handles
per-peril deductibles and sublimits. `LayerTower` handles arbitrary numbers
of layers with `(attachment, limit, share, reinstatements)`, supporting
occurrence and aggregate bases. `TechnicalPremium` emits pure premium,
risk-loaded premium (configurable: `EL + k·σ` or `EL·(1 + μ)`),
rate-on-line, and TVaR at RP 100, 250, 500, 1000.

**Alternatives:**

- Keep per-site D&L only. Rejected — unrecognizable to a reinsurance
  underwriter.
- Monolithic one-pass financial function. Rejected — untestable.

### D8 — Request validation and authentication

**Decision:**

- Compile the v1 and v2 JSON schemas with ajv at API boot. Validate every
  `POST /api/v1/property-cat-pricing/runs` body; return 400 with a
  JSON-Pointer path on failure.
- Bearer API-key authentication with argon2-hashed keys at rest. Resolve
  tenant and user from the key. Remove the hardcoded `usr_demo001` /
  `ws_demo001` defaults.
- Structure the auth module around a `Principal` abstraction so OIDC can
  plug in as another strategy later.

**Alternatives:**

- Full OIDC now. Deferred — out of scope for this cycle.
- Skip validation and auth. Rejected — unblocks everything downstream.

## Non-goals for this cycle

- Vendor-grade validation (AIR/RMS/Moody's parity).
- Basins other than Atlantic (HURDAT2).
- Full synthetic track generation.
- Multi-tenant OIDC.
- Real-time pricing APIs (run-based async only).
- Property-level geocoding from free-text addresses.

## References

- Holland, G. J. (1980). "An analytic model of the wind and pressure
  profiles in hurricanes."
- Willoughby, H. E. et al. (2006). "Parametric representation of the primary
  hurricane vortex."
- Kaplan, J. & DeMaria, M. (1995). "A simple empirical model for predicting
  the decay of tropical cyclone winds after landfall."
- Schwerdt, R. W. et al. (1979). "Meteorological criteria for standard
  project hurricane…" (translation asymmetry).
- Hazus Hurricane Model Technical Manual (FEMA, public domain).

## Change log

- 2026-04-23 — Initial draft.
