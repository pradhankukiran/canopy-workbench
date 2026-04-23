package canopy.engine.property.hazard

import canopy.data.hurdat2.{Hurdat2TrackPoint, Hurdat2WindRadii}
import canopy.engine.property.Hurdat2PropertyCatPricingYltSimulator.{PricingParameters, PropertyLocation}

/** Hazard model: converts hurricane track points into wind intensity at a
  * property location.
  *
  * Phase 1 baseline: exponential distance-decay keyed on a 34-kt wind
  * radius (HURDAT2 column), averaged across quadrants. This file is the
  * surface that phase 2 upgrades replace:
  *
  *   - HollandWindfield.scala  (2.2)   radial Holland 1980 profile
  *   - RmaxEstimator.scala     (2.3)   Willoughby 2006 Rmax estimation
  *   - TranslationAsymmetry.scala (2.4) right-of-track bias
  *   - OverlandDecay.scala     (2.5)   Kaplan-DeMaria 1995 filling
  *   - SurfaceRoughness.scala  (2.6)   terrain 10m reduction
  */
object Windfield {

  /** Maximum wind at a location across all tropical-system track points. */
  def maxSiteWindKt(
      track: Vector[Hurdat2TrackPoint],
      loc: PropertyLocation,
      pp: PricingParameters
  ): Double =
    track.iterator
      .filter(point => isTropicalSystem(point.status))
      .map(point => attenuatedWindKt(point, loc, pp))
      .foldLeft(0d)(_ max _)

  /** HURDAT2 status codes for tropical cyclone states. TD=tropical depression,
    * TS=tropical storm, HU=hurricane, TY=typhoon (Pacific), ST=subtropical,
    * TC=other tropical. Extratropical (EX), low (LO), and disturbance (DB/WV)
    * statuses are excluded because their wind damage characteristics are
    * outside the scope of this engine's vulnerability curves. */
  def isTropicalSystem(status: String): Boolean = {
    val s = Option(status).map(_.trim.toUpperCase).getOrElse("")
    s == "TD" || s == "TS" || s == "HU" || s == "TY" || s == "ST" || s == "TC"
  }

  /** Site-level wind at a single track point. Dispatches on the pricing
    * parameter flag: Holland radial profile (default, phase 2.2) or the
    * legacy exponential-decay fallback. The Holland branch also degrades
    * to exponential decay when the track point lacks central pressure,
    * since Holland requires delta-P.
    */
  def attenuatedWindKt(
      point: Hurdat2TrackPoint,
      loc: PropertyLocation,
      pp: PricingParameters
  ): Double = {
    val distanceKm = Geodesy.haversineKm(loc.latitude, loc.longitude, point.latitude, point.longitude)

    if (pp.useHollandWindfield) {
      point.minPressureMb match {
        case Some(pc) if pc > 0 && pc < HollandWindfield.EnvironmentalPressureMb =>
          val rMaxKm = RmaxEstimator.estimateKm(point, pp)
          HollandWindfield.surfaceWindKt(
            rKm = distanceKm,
            rMaxKm = rMaxKm,
            vMaxKt = point.maxWindKt.toDouble,
            pcMb = pc.toDouble,
            latitudeDeg = point.latitude
          )
        case _ =>
          exponentialDecayKt(distanceKm, point, pp)
      }
    } else {
      exponentialDecayKt(distanceKm, point, pp)
    }
  }

  /** Phase-1 exponential-decay fallback. Kept for storms missing the
    * central-pressure column and for `useHollandWindfield=false` runs
    * (regression-testing the old numerics, never the recommended default).
    */
  def exponentialDecayKt(
      distanceKm: Double,
      point: Hurdat2TrackPoint,
      pp: PricingParameters
  ): Double = {
    val windRadiusKm = point.windRadii34KtNm
      .map(averageRadiiNm)
      .filter(_ > 0d)
      .map(_ * pp.nauticalMileKm)
      .getOrElse(pp.defaultWindRadiusKm)
    val decayScaleKm = math.max(pp.minDecayScaleKm, windRadiusKm * pp.radiusToDecayScaleRatio)
    val attenuation = math.exp(-distanceKm / decayScaleKm)
    point.maxWindKt.toDouble * attenuation
  }

  /** Average of the four quadrant radii. When HURDAT2 has partial quadrant
    * data we average over whatever is present. Real directional dependence
    * is restored in phase 2.4 (translation asymmetry). */
  def averageRadiiNm(radii: Hurdat2WindRadii): Double = {
    val values = Vector(radii.ne, radii.se, radii.sw, radii.nw).flatten.map(_.toDouble)
    if (values.isEmpty) 0d else values.sum / values.size.toDouble
  }
}
