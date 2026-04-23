package canopy.engine.property.hazard

import canopy.data.hurdat2.Hurdat2TrackPoint
import canopy.engine.property.Hurdat2PropertyCatPricingYltSimulator.PricingParameters

/** Phase-2.2 Rmax estimator. HURDAT2 does not ship a radius-of-maximum-
  * winds column for most records; this estimator falls back in a simple
  * two-tier hierarchy:
  *
  *   1. If the track point carries a 34-kt wind radius (HURDAT2 cols 9-12
  *      for records >= 2004), take the quadrant-average and multiply by
  *      a Rmax/R34 scale factor. The ratio of Rmax to the 34-kt radius
  *      typically lies in 0.25-0.45 for Atlantic tropical cyclones; we
  *      use 0.35 as the default (PricingParameters.rmaxFromR34Factor).
  *
  *   2. Otherwise fall back to a linear climatology
  *        Rmax_km = intercept - slope * V_max_kt
  *      clamped to [rmaxMinKm, rmaxMaxKm]. Defaults (45, 0.2, 15, 80)
  *      yield plausible Rmax values across the Saffir-Simpson range:
  *        V_max=40 kt  -> ~37 km
  *        V_max=100 kt -> ~25 km
  *        V_max=150 kt -> ~15 km
  *
  * Phase 2.3 replaces the climatology with the Willoughby 2006 formula
  * which also uses latitude and intensity gradient. Extended HURDAT2
  * records carrying an explicit Rmax column (2021+) will short-circuit
  * both paths.
  */
object RmaxEstimator {

  def estimateKm(point: Hurdat2TrackPoint, pp: PricingParameters): Double = {
    fromR34(point, pp).getOrElse(climatology(point, pp))
  }

  private def fromR34(point: Hurdat2TrackPoint, pp: PricingParameters): Option[Double] = {
    point.windRadii34KtNm
      .map(Windfield.averageRadiiNm)
      .filter(_ > 0d)
      .map(nm => nm * pp.nauticalMileKm * pp.rmaxFromR34Factor)
      .map(clampRmax(_, pp))
  }

  private def climatology(point: Hurdat2TrackPoint, pp: PricingParameters): Double = {
    val raw = pp.rmaxClimatologyInterceptKm - pp.rmaxClimatologySlopeKmPerKt * point.maxWindKt.toDouble
    clampRmax(raw, pp)
  }

  private def clampRmax(value: Double, pp: PricingParameters): Double =
    math.max(pp.rmaxMinKm, math.min(pp.rmaxMaxKm, value))
}
