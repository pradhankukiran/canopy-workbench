# Phase 3 — Event Catalog & Financial Pipeline

Completes the lift of the pricing engine from "plausible loss numbers
on a single-curve event set" to "indicative reinsurance pricing" with
a proper stochastic catalog and a composable financial pipeline.

## What shipped

### Event catalog (3.1–3.3)

**Poisson frequency.** Historical annual event counts are fit with
  arithmetic-mean lambda. Each simulated year draws `N ~ Poisson(lambda)`
  via Knuth 1969.

**Event-level bootstrap.** The phase-1 "copy one historical year
  wholesale" sampler is replaced. Each simulated year's N events are
  drawn uniformly with replacement from the flattened historical event
  pool. Year losses are sums over sampled events.

**Event perturbation.** Each sampled event is multiplied by a mean-1
  lognormal draw (sigma = 0.30 default). Preserves expected loss,
  widens the tail. A full track-jitter + re-run treatment is deferred.

### Real AEP derivation

Phase 1's `AEP = 0.94 * OEP` hack is deleted. Both curves are now real
quantiles of distinct series:

    OEP(p)  p-quantile of per-year MAX-SINGLE-EVENT loss
    AEP(p)  p-quantile of per-year AGGREGATE (sum-of-events) loss

The AEP >= OEP invariant now holds by construction and is enforced by
`PricingInvariantSpec`.

### Financial pipeline (3.6–3.10)

**Per-peril deductibles and sublimits** in `SiteTerms.applyPerilTerms`.
  v2 portfolio fields `perilDeductibles` and `sublimits` (fractions in
  (0, 1] = % of TIV, larger values = absolute) flow through to the
  site-level pipeline before layers.

**Layer tower.** `LayerTower` carries an ordered list of `Layer(name,
  attachment, limit, share, basis, reinstatements)`. Occurrence basis
  applies per event; aggregate basis applies to the year total.
  Reinstatements expand annual capacity. `LayerYearOutcome` emits
  `attachmentReached` and `exhausted` per year per layer.

**Technical premium.** `TechnicalPremium.priceTower` emits per-layer
  premium with:

    pureLoss              = E[annual layer loss]
    stdDevLoss            = sigma of annual layer loss
    riskLoadedPremium     = pure + k*sigma (additive) OR pure*(1+k) (mult)
    brokerage             = gross * brokerageRate
    profitCommission      = gross * profitCommissionRate
    grossTechnicalPremium = loaded / (1 - brokerageRate - profitCommissionRate)
    rateOnLine            = grossTechnicalPremium / limit

**TVaR curve** at configured return periods. `tvarByReturnPeriod` is
  always emitted on the Result.

### Output surface (3.11–3.12)

Engine JSON output under `moduleOutputs.propertyCatPricing` gains:

    tvarByReturnPeriod        [{returnPeriodYears, tvar}, ...]   always
    layerPremiums             [{layerName, pureLoss, ..., rateOnLine}, ...] with tower
    layerAttachmentFrequency  fraction of years any layer attached        with tower
    layerExhaustionFrequency  fraction of years every layer exhausted     with tower

Web `PropertyCatPricingYltOutput` gains optional typed fields for each.

### Golden coverage

Four frozen scenarios in `BaselineGoldenSpec`:

    single-miami           1 location, no cession
    gulf-three             3 locations, no cession
    ten-location           10 locations, no cession
    gulf-three-tower       3 locations + reinsurance tower (3 layers
                           with 1 reinstatement each, 5% brokerage,
                           0.3x additive risk load)

The tower scenario locks phase-3 logic against regression. Its golden
includes the layerPremiums array and tvarByReturnPeriod so changes to
the financial pipeline show up as diffs.

## What's NOT in phase 3

- State-dependent frequency (ENSO clustering etc.) - 3.4 deferred.
- Track-level event perturbation (re-run hazard per event). 3.3 ships
  the loss-level surrogate.
- Full SLOSH MEOW surge data binding. 2.7a is parametric; 2.7b deferred.
- Hours clauses / event-definition nuances on layer basis.
- Quota-share stacked with XoL.
- Per-layer per-peril sublimits.
- Reinstatement premium calculation and payback mechanics.
- Frontend layer editor + premium panel. Web types know about the new
  fields but the UI surface is a next-cycle item.

## Cumulative drift summary (gulf-three scenario)

| Phase end | Expected loss | OEP(100yr) |
|----------:|--------------:|-----------:|
| 1 baseline                   | $1.15M | $2.97M |
| 2 complete                   | $1.58M | $3.92M |
| 3 event-level bootstrap      | $1.9M  | $5.0M  |
| 3 + perturbation             | $1.95M | $5.1M  |
| 3 + per-peril terms          | $1.95M | $5.1M  |
| 3 end (tower empty baseline) | $1.95M | $5.1M  |

The phase-3 drift is dominated by the Poisson-frequency change: years
can now have 0, 1, 2, 3+ events vs. phase-2's uniform 1-event
resampled copy. The tail of the aggregate distribution is fatter
because multi-event years stack losses.

## Invariants still green

All ten ScalaCheck property tests pass after phase 3 (the AEP <= OEP
invariant was intentionally flipped to the actuarially correct
AEP >= OEP when event-level bootstrap landed):

  1. aggregate gross loss <= total TIV
  2. net loss <= gross loss per simulated year
  3. AEP(p) >= OEP(p) at every return period     [flipped in 3.1]
  4. TVaR >= VaR at the same quantile
  5. deductible >= TIV implies insured loss = 0
  6. fixed seed produces byte-identical outputs
  7. empty HURDAT2 dataset produces zero expected loss
  8. expected loss, stddev, attachment prob non-negative; in [0,1]
  9. OEP(rp) monotone non-decreasing in RP

Test totals at end of phase 3: 134 Scala tests, 31 TS tests, clean
pnpm -r typecheck.

## Next steps (phase 4 / 5 candidates)

- Per-quantile Rainier posterior (phase 4) - replace the scalar
  scaleFactor with real credible bands on each RP curve point.
- Convergence gates on R-hat / ESS.
- Web frontend: layer-tower editor, brokerage/PC form fields, per-
  layer premium display, TVaR chart alongside OEP/AEP.
- Operational hardening: OTel tracing, Prom metrics, CI-enforced
  golden diff with GOLDEN_CHANGE.md requirement.
