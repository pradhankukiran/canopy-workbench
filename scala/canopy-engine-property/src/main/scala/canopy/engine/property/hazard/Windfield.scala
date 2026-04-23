package canopy.engine.property.hazard

import canopy.data.hurdat2.{Hurdat2TrackPoint, Hurdat2WindRadii}
import canopy.engine.property.Hurdat2PropertyCatPricingYltSimulator.{PricingParameters, PropertyLocation}

import java.time.{LocalDateTime, ZoneOffset}

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

  /** Maximum wind at a location across all tropical-system track points.
    *
    * Phase 2.4: we also compute each point's translation speed and
    * heading from the previous track fix (by differencing the Geodesy
    * positions and the HURDAT2 datetimes) so the asymmetry correction
    * can be applied inside `attenuatedWindKt`. The first fix carries no
    * predecessor, so its translation context is None; successive fixes
    * inherit the diff from their immediate predecessor.
    */
  def maxSiteWindKt(
      track: Vector[Hurdat2TrackPoint],
      loc: PropertyLocation,
      pp: PricingParameters
  ): Double = {
    val withContext = track.zipWithIndex.map { case (point, idx) =>
      val prev = if (idx == 0) None else Some(track(idx - 1))
      (point, translationContext(prev, point, pp))
    }
    withContext.iterator
      .filter { case (point, _) => isTropicalSystem(point.status) }
      .map { case (point, ctx) => attenuatedWindKt(point, ctx, loc, pp) }
      .foldLeft(0d)(_ max _)
  }

  /** Heading (degrees) and translation speed (kt) derived from two
    * consecutive HURDAT2 track fixes. Returns a TranslationContext with
    * None fields when either the heading or speed cannot be computed
    * (zero dt, identical coordinates, out-of-range values).
    */
  def translationContext(
      previous: Option[Hurdat2TrackPoint],
      current: Hurdat2TrackPoint,
      pp: PricingParameters
  ): TranslationContext = {
    previous match {
      case None => TranslationContext.empty
      case Some(prev) =>
        val distanceKm = Geodesy.haversineKm(prev.latitude, prev.longitude, current.latitude, current.longitude)
        val dtHours = hoursBetween(prev, current)
        if (distanceKm < 1e-6 || dtHours <= 0d) TranslationContext.empty
        else {
          val bearing = Geodesy.bearingDeg(prev.latitude, prev.longitude, current.latitude, current.longitude)
          val speedKmPerH = distanceKm / dtHours
          val speedKtRaw = speedKmPerH / pp.nauticalMileKm
          val speedKt = math.max(0d, math.min(pp.translationMaxKt, speedKtRaw))
          TranslationContext(Some(bearing), Some(speedKt))
        }
    }
  }

  private def hoursBetween(prev: Hurdat2TrackPoint, curr: Hurdat2TrackPoint): Double = {
    val prevDt = LocalDateTime.of(prev.date, prev.time).toEpochSecond(ZoneOffset.UTC)
    val currDt = LocalDateTime.of(curr.date, curr.time).toEpochSecond(ZoneOffset.UTC)
    (currDt - prevDt).toDouble / 3600d
  }

  final case class TranslationContext(headingDeg: Option[Double], speedKt: Option[Double])
  object TranslationContext {
    val empty: TranslationContext = TranslationContext(None, None)
  }

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
    * since Holland requires delta-P. When phase 2.4 is enabled, the
    * Holland result is biased by the Schwerdt translation-asymmetry
    * term before being returned; the exponential-decay fallback is
    * left symmetric (it's a stand-in, not a physical model).
    */
  def attenuatedWindKt(
      point: Hurdat2TrackPoint,
      ctx: TranslationContext,
      loc: PropertyLocation,
      pp: PricingParameters
  ): Double = {
    val distanceKm = Geodesy.haversineKm(loc.latitude, loc.longitude, point.latitude, point.longitude)

    val symmetricKt =
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
          case _ => exponentialDecayKt(distanceKm, point, pp)
        }
      } else {
        exponentialDecayKt(distanceKm, point, pp)
      }

    val asymmetricKt =
      if (!pp.useTranslationAsymmetry || symmetricKt <= 0d) symmetricKt
      else {
        val adjustment = TranslationAsymmetry.adjustment(
          stormLatDeg = point.latitude,
          stormLonDeg = point.longitude,
          headingDeg = ctx.headingDeg,
          translationSpeed = ctx.speedKt,
          siteLatDeg = loc.latitude,
          siteLonDeg = loc.longitude,
          k = pp.translationAsymmetryK
        )
        math.max(0d, symmetricKt + adjustment)
      }

    // Phase 2.6: terrain roughness reduction at 10 m. Applied once, at
    // the end of the hazard chain. This converts the boundary-layer
    // "open-water" wind into the wind the structure actually sees.
    if (!pp.useSurfaceRoughness) asymmetricKt
    else asymmetricKt * SurfaceRoughness.factorFor(loc.surfaceRoughnessClass)
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
