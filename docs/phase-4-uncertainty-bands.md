# Phase 4 — Uncertainty Quantification

Replaces the phase-1 "multiply every output by one posterior-mean
scaleFactor" shortcut with per-quantile credible bands and real
convergence gating on the Rainier MCMC output.

## What shipped

### PosteriorBands (4.1)

`ylt/PosteriorBands.scala` — bootstrap-based 90% credible bands on any
loss series at a set of return periods.

For each RP:

  1. Bootstrap the annual-loss series B times with replacement
     (default B = 500).
  2. For each bootstrap, optionally multiply its p-quantile by a scale
     factor drawn from a Gaussian approximation of the Rainier
     posterior over calibration rate.
  3. Return `{mean, p05, p95}` of the resulting distribution.

The band width captures two uncertainty sources that the phase-1
scaleFactor hid:

  - **simulation sampling noise** - how tight is the p-quantile on a
    200-year catalog? Even without calibration the band is non-zero.
  - **calibration uncertainty** - when Rainier runs, the scale posterior
    has its own spread (posteriorStdDev) that feeds into every quantile.

Deterministic under a fixed `params.randomSeed` (the bands RNG is
seeded from `randomSeed XOR 0x42L`).

### Bands wiring (4.2)

Engine JSON output gains:

    moduleOutputs.propertyCatPricing.oepBands = {
      source: "bootstrap" | "bootstrap+rainier",
      bootstrapSamples: 500,
      gross: [{returnPeriodYears, mean, p05, p95}, ...],
      net:   [...]
    }
    moduleOutputs.propertyCatPricing.aepBands = { ...same shape... }

These sit alongside the existing deterministic `riskMetrics.oep` /
`riskMetrics.aep` curves (still the prior-predictive quantiles of the
unscaled simulated catalog).

Retired: `scaleSimulatedYears`, `scaleSummaryStats`, `scaleRiskMetrics`,
`scaleReturnPeriodPoint`, `sanitizeScaleFactor`. The CLI no longer
multiplies any output by the scalar `scaleFactor`; that field is still
present on the `rainierCalibration` sub-object for backwards
compatibility but should be considered deprecated.

### Convergence gates (4.3)

The `diagnostics` object classifies each Rainier MCMC run:

    "converged"  R-hat <= 1.05  AND  ESS >= 400
    "warning"    R-hat <= 1.10  AND  ESS >= 200  (relaxed)
    "failed"     outside the relaxed bounds
    "no_mcmc_diagnostics"  non-MCMC fallback path
    "skipped"    calibration not applied

Plus `rHatMax`, `essMin`, `rHatThreshold`, `essThreshold`, and a
`warnings[]` list of threshold violations when non-green.

### Goldens (4.4)

New test: `golden: gulf-three posterior bands at multiple RPs` freezes
the AEP and OEP bands for the gulf-three scenario at RP 10 / 50 / 100.

Sample values from the new `gulf-three-bands.json`:

| RP  | AEP mean | AEP 90% band        | OEP mean | OEP 90% band        |
|----:|---------:|---------------------|---------:|---------------------|
|  10 |  $6.84M  | $5.51M – $7.65M     |  $5.19M  | $4.44M – $5.69M     |
|  50 | $10.74M  | $8.64M – $12.09M    |  $7.28M  | $6.43M – $8.45M     |
| 100 | $11.93M  | $9.41M – $13.46M    |  $7.98M  | $6.81M – $9.61M     |

AEP > OEP at every RP (required invariant). Bands widen with RP (tail
is less well-estimated). The bootstrap source reflects simulation
noise only here, because the BaselineGoldenSpec uses a 12-year
synthetic catalog and the observed-rate floor for Rainier (4
non-degenerate observations) isn't met, so calibration is skipped.

### Web types (4.4)

`PropertyCatPricingYltOutput` gains optional `oepBands`, `aepBands`
typed fields and a `BandPoint` interface. The frontend is now aware of
the shape; rendering (shaded error-band chart etc.) is a separate UX
commit.

## What's NOT in phase 4

- **True posterior-predictive per quantile.** The Rainier scale is
  approximated as a Gaussian (mean, stddev) and combined with
  bootstrap. A full posterior-predictive treatment would push each
  MCMC sample through the YLT's quantile calculation and drop the
  Gaussian approximation. That requires exposing the posterior
  sample trace from `MpiRainierCalibrator`; the calibrator currently
  only returns summary stats.
- **Per-event-level calibration.** Every event scales by the same
  draw; a refined treatment would calibrate per intensity band or
  per basin.
- **Convergence gate on api response.** The engine reports status but
  the API handler doesn't reject runs with `failed` diagnostics.
  Decision is deferred until an SLA for calibration exists.
- **Shaded-band chart** in the web UI. The types know about the band;
  `LossExceedanceCurve` still renders the point-estimate line.

## Tests

143 Scala tests total. New:

  PosteriorBandsSpec              7 cases
  gulf-three-bands golden         1 scenario

All 9 ScalaCheck invariants still green after phase 4.

## Final commit count

  c0620ea feat(engine): bootstrap-based per-quantile PosteriorBands module
  672b10f feat(engine): emit per-quantile posterior bands; retire uniform scale factor
  (this commit) test + docs: phase-4 golden + summary

3 focused commits.
