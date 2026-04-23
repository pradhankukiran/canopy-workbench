# Phase 2 — Golden Drift Summary

Tracks the cumulative numerical impact of each Phase-2 physics upgrade on
the three `BaselineGoldenSpec` scenarios. Each row below is a delta vs.
the previous commit, not vs. Phase 1.

## Test scenarios

All three scenarios run with `simulatedYears = 200`, `randomSeed = 42`,
and `returnPeriodsYears = [10, 50, 100]` against a synthetic 11-year
HURDAT2 catalog of Gulf landfalls (winds 75-130 kt, NNE tracks,
6-hour spacing).

- **single-miami** — 1 residential location at (25.77, -80.19). Miami
  is far east of every Gulf track, so no storm reaches damage-force
  winds at this site. Expected loss stays at 0 across all phases.
- **gulf-three** — Houston (29.74, -95.37), New Orleans (29.95, -90.07),
  Miami (25.77, -80.19). Houston sits just west of the track (left-of-
  track in NH), New Orleans sits almost on the peak-intensity landfall
  point. This scenario carries most of the drift signal.
- **ten-location** — 10 locations spread across the 25-35°N, -97 to
  -79°W band. Most are out of the peak intensity band but a few sit
  close to the synthetic tracks.

## Gulf-three drift timeline

| Phase | Commit | Expected loss | OEP(100yr) | Notes |
|------:|--------|--------------:|-----------:|-------|
| 1 baseline | a15334a | $1.15M | $2.97M | frozen under exponential decay + single power curve |
| 2.2 Holland | d3091a8 | $2.75M | $5.71M | +140%; Holland predicts much higher eyewall winds than exponential decay |
| 2.3 Willoughby Rmax | faf304b | $2.75M | $5.71M | unchanged; test fixtures populate windRadii34KtNm so the Willoughby climatology is not reached |
| 2.4 Translation asymmetry | eb7dd80 | $2.73M | $5.66M | -1%; portfolio straddles both sides of the NNE track so asymmetry nets out |
| 2.6 Surface roughness | ee54b65 | $2.73M | $5.66M | unchanged; fixtures don't set surfaceRoughnessClass so factor = 1.0 |
| 2.9 Hazus curves | 5b1edbb | $1.50M | $3.72M | -45%; Hazus curves are softer than the power curve for default-enriched wood/legacy residential in Cat 2-4 range |
| 2.10 Secondary uncertainty | 397baa1 | $1.56M | $3.96M | +3-6%; Beta is right-skewed for MDR < 0.5 so sample mean exceeds deterministic mean in the tail |
| 2.5b Overland decay | e596b6e | $1.51M | $3.81M | -3%; the third track point is inland so its V_max decays |
| 2.7a Storm surge | 00c68c7 | $1.58M | $3.92M | +3-5%; New Orleans (on STORM_SURGE peril) picks up separate surge loss on the landfall event |

Net Phase-1 to end-of-Phase-2: $1.15M → $1.58M (+37%) expected loss;
$2.97M → $3.92M (+32%) at 100-yr OEP.

## Why the numbers moved

The physics upgrades pull in two competing directions:

**Upward** (higher loss):
- Holland's eyewall is much more intense than exponential decay's.
- Storm surge adds a second, independent loss path for coastal exposures.
- Beta secondary uncertainty biases sampled mean upward when MDR < 0.5.

**Downward** (lower loss):
- Hazus curves are less aggressive than the power curve at Cat 2-4 for
  typical residential / commercial profiles.
- Overland decay eats V_max as the storm moves inland.
- Surface roughness (when exercised via enrichment, not by the baseline
  fixtures) would reduce inland winds by ~15%.

The net effect on our three-scenario panel is a moderate increase (~30%)
that reflects the combined impact. Real portfolios will move by larger
amounts depending on their exposure profile — coastal + surge-peril
portfolios see more; inland wind-only portfolios see less.

## Invariants preserved

All 9 ScalaCheck invariants in `PricingInvariantSpec` passed unchanged
through every Phase-2 commit:

1. `aggregate gross loss <= total TIV`
2. `net loss <= gross loss per simulated year`
3. `AEP(p) <= OEP(p)` at every return period (current model bound)
4. `TVaR >= VaR` at the same quantile
5. `deductible >= TIV implies insured loss = 0`
6. `fixed seed produces byte-identical outputs`
7. `empty HURDAT2 dataset produces zero expected loss`
8. `expected loss, stddev, attachment probability are non-negative; attachment probability in [0, 1]`
9. `OEP(rp) is monotonically non-decreasing in return period`

## Phase 2.7b (deferred)

SLOSH MEOW data integration is scaffolded (the DataArtifact descriptor
exists, the loader doesn't) but not wired. Phase 2.7a currently uses a
parametric Saffir-Simpson surge formula. Replacing it with real MEOW
per-cell lookups would change surge numbers without changing the wind
loss path.

## Regenerating

```
CANOPY_GOLDEN_UPDATE=1 sbt 'canopy-engine-property/testOnly canopy.engine.property.BaselineGoldenSpec'
```

Every regeneration should be paired with an entry here explaining the
drift direction and magnitude.
