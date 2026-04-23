# Data & Model Provenance Audit

Explicit record of every external dataset, published formula, or third-
party license embedded in the engine.

Update whenever a new artifact lands or an existing one is refreshed.

## Physics models

| Component | Source | Public reference | License | Notes |
|---|---|---|---|---|
| Windfield | Holland 1980 | Monthly Weather Review 108(8) | public domain | Implemented in `HollandWindfield.scala`; B-parameter derived from V_max + Pc |
| Rmax climatology | Willoughby, Darling & Rahn 2006 | MWR 134, 1102-1120 | public domain | `RmaxEstimator.willoughby2006Km` |
| Translation asymmetry | Schwerdt et al. 1979 | NOAA Tech Rep NWS-23 | public domain | `TranslationAsymmetry.adjustment`, k=0.55 default |
| Overland decay | Kaplan & DeMaria 1995 | Journal of Applied Meteorology 34 | public domain | `OverlandDecay.decayedWindKt`; Atlantic V_b=26.7 kt, a=0.095/hr |
| Surface roughness | ESDU 85020 / ASCE 7-16 | engineering standards | per the standards | `SurfaceRoughness.factorFor` is a qualitative lookup; numeric values derived from published exposure categories |

## Vulnerability library

**Location**: `scala/canopy-engine-property/src/main/resources/vulnerability/`

- `hazus-hm4-curves.csv` — 13 tabular damage-ratio curves spanning
  (construction × occupancy × stories × code-era). Stylized to match
  the qualitative shape of FEMA Hazus HM4 Hurricane Model damage
  functions; NOT a direct copy of the vendor's parametric output. See
  `PROVENANCE.md` in the resources directory for per-curve derivation.

Regulatory-grade fidelity requires composing against the actual Hazus
library and is out of scope for indicative pricing.

## Catalog

**Source**: HURDAT2 Atlantic and Pacific basins (NOAA NHC).
  Shipped as:
  - `test-data/hurdat2/sample_atlantic_subset.hurdat2`
  - `test-data/hurdat2/atlantic_full.hurdat2`
  - `test-data/hurdat2/pacific_full.hurdat2`
  - `test-data/hurdat2/combined_atlantic_pacific.hurdat2`

NHC updates HURDAT2 annually. Refresh procedure:
1. Download the latest file from `nhc.noaa.gov/data/hurdat/`.
2. Commit under the same filename.
3. Regenerate goldens (`CANOPY_GOLDEN_UPDATE=1 sbt test`).
4. Record the drift direction in the PR under a `GOLDEN_CHANGE`
   heading.

## Runtime data artifacts

Loaded via `canopy.data.registry.DataRegistry` (phase 2.5a).

| Artifact | URL | Expected size | License |
|---|---|---|---|
| natural-earth-10m-land | `https://naciscdn.org/naturalearth/10m/physical/ne_10m_land.zip` | ~2 MB | public domain (Natural Earth) |
| slosh-meow-gulf | `https://www.nhc.noaa.gov/nationalsurge/data/slosh_meow_gulf.zip` | ~20 MB | public domain (NOAA) |
| etopo-2022-60s | `https://www.ngdc.noaa.gov/thredds/fileServer/global/ETOPO2022/60s/60s_surface_elev_netcdf/ETOPO_2022_v1_60s_N90W180_surface.nc` | ~90 MB | public domain (NOAA NCEI) |

Artifacts cache under `$CANOPY_DATA_CACHE_DIR` (defaults to
`~/.canopy-workbench/data`). Admin refresh procedure:

```
rm -f ~/.canopy-workbench/data/<localFileName>
# Restart worker. Registry re-downloads on next boot.
```

SHA-256 digests are currently unpinned (registry accepts any bytes
when `sha256 == ""`). Pin digests before production by:
1. Downloading each artifact.
2. `sha256sum <file>` → update `DataArtifact.sha256` in
   `canopy-data/src/main/scala/canopy/data/registry/DataArtifact.scala`
   AND `apps/api/src/data-sources.ts` DEFAULT_ARTIFACTS.

## Bayesian calibration

**Component**: Rainier (Stripe) 0.3.5 used under the hood by
`canopy.inference.rainier.MpiRainierCalibrator`.

Model: `mu ~ Normal(logit(baseRate), priorLogitStdDev)`,
       `sigma ~ Exponential(20.0)`,
       observations = logit(observed annual loss rates).

Sampler: EHMC with warmup + iteration counts configured per
`engineProfile`:
- `fast`: warmup=60, iter=80, chains=2
- `standard`: warmup=120, iter=160, chains=2
- `full`: warmup=240, iter=320, chains=4

Rainier's license: Apache 2.0.

## Credible bands

Phase 4.1: `PosteriorBands.compute` does a 500-sample bootstrap of the
simulated annual-loss series per return period. When a Rainier
calibration is available, each bootstrap sample is additionally
multiplied by a draw from a Gaussian approximation
(N(posteriorMean/deterministic, posteriorStdDev/deterministic)) of
the posterior over calibration rate.

Not a true posterior-predictive in the strict Bayesian sense; see
`docs/phase-4-uncertainty-bands.md` for the caveats and the
deferred follow-ups.

## Assertions this engine does NOT make

- It is NOT a vendor-validated catastrophe model (AIR / RMS / Moody's
  parity).
- It does NOT carry a regulatory rating.
- It does NOT replace independent actuarial review for binding
  business.

Use for indicative pricing, scenario exploration, educational
purposes. See `docs/property-cat-pricing-design.md` (the D1-D8
architecture decision record) for the scoped target.
