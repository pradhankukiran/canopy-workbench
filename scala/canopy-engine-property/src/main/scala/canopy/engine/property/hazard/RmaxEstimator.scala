package canopy.engine.property.hazard

import canopy.data.hurdat2.Hurdat2TrackPoint
import canopy.engine.property.Hurdat2PropertyCatPricingYltSimulator.PricingParameters

/** Rmax estimator. HURDAT2 does not ship a radius-of-maximum-winds column
  * for most records, so we fall back in a three-tier hierarchy:
  *
  *   1. If the track point carries a 34-kt wind radius (HURDAT2 cols 9-12
  *      for records >= 2004), take the quadrant-average and multiply by
  *      a Rmax/R34 scale factor. The ratio of Rmax to the 34-kt radius
  *      typically lies in 0.25-0.45 for Atlantic tropical cyclones; we
  *      use 0.35 as the default (PricingParameters.rmaxFromR34Factor).
  *
  *   2. Otherwise use Willoughby, Darling & Rahn (2006) when
  *      `rmaxFormula = "willoughby2006"` (default):
  *
  *        Rmax_km = 46.4 * exp( -0.0155 V_max_ms + 0.0169 |lat_deg| )
  *
  *      This is the empirical relation fitted to the HRD flight-level
  *      database. It reproduces the observed pattern that stronger
  *      storms have smaller Rmax and that Rmax grows with latitude.
  *
  *   3. Linear fallback when `rmaxFormula = "linear"`:
  *        Rmax_km = intercept - slope * V_max_kt
  *      clamped to [rmaxMinKm, rmaxMaxKm]. Retained for regression
  *      against phase-2.2 numerics.
  *
  * Reference: Willoughby, H. E., R. W. R. Darling, and M. E. Rahn
  * (2006), "Parametric Representation of the Primary Hurricane Vortex.
  * Part II: A New Family of Sectionally Continuous Profiles",
  * Monthly Weather Review, 134, 1102-1120.
  *
  * Extended HURDAT2 records carrying an explicit Rmax column (2021+)
  * will short-circuit all three paths once the parser supports them.
  */
object RmaxEstimator {

  /** Willoughby 2006 regression coefficients (Table 5 in the paper). */
  private val WilloughbyIntercept: Double = 46.4d
  private val WilloughbyVMaxCoef: Double = -0.0155d
  private val WilloughbyLatCoef: Double = 0.0169d

  /** 1 kt -> m/s for the Willoughby formula (which takes V_max in m/s). */
  private val KtToMPerSec: Double = 0.514444d

  def estimateKm(point: Hurdat2TrackPoint, pp: PricingParameters): Double = {
    fromR34(point, pp).getOrElse(fromClimatology(point, pp))
  }

  private def fromR34(point: Hurdat2TrackPoint, pp: PricingParameters): Option[Double] = {
    point.windRadii34KtNm
      .map(Windfield.averageRadiiNm)
      .filter(_ > 0d)
      .map(nm => nm * pp.nauticalMileKm * pp.rmaxFromR34Factor)
      .map(clampRmax(_, pp))
  }

  private def fromClimatology(point: Hurdat2TrackPoint, pp: PricingParameters): Double = {
    val raw = pp.rmaxFormula.trim.toLowerCase match {
      case "willoughby2006" => willoughby2006Km(point.maxWindKt.toDouble, point.latitude)
      case _                => linearClimatologyKm(point.maxWindKt.toDouble, pp)
    }
    clampRmax(raw, pp)
  }

  /** Willoughby, Darling & Rahn 2006 Atlantic Rmax formula. Exported for
    * unit tests and for callers that want Rmax without instantiating
    * PricingParameters. */
  def willoughby2006Km(vMaxKt: Double, latitudeDeg: Double): Double = {
    if (vMaxKt <= 0d) return 46.4d
    val vMaxMs = vMaxKt * KtToMPerSec
    WilloughbyIntercept *
      math.exp(WilloughbyVMaxCoef * vMaxMs + WilloughbyLatCoef * math.abs(latitudeDeg))
  }

  def linearClimatologyKm(vMaxKt: Double, pp: PricingParameters): Double =
    pp.rmaxClimatologyInterceptKm - pp.rmaxClimatologySlopeKmPerKt * vMaxKt

  private def clampRmax(value: Double, pp: PricingParameters): Double =
    math.max(pp.rmaxMinKm, math.min(pp.rmaxMaxKm, value))
}
