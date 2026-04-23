package canopy.engine.property.hazard

import canopy.data.hurdat2.Hurdat2Storm
import canopy.engine.property.Hurdat2PropertyCatPricingYltSimulator.{PricingParameters, PropertyLocation}

/** Storm surge loss contribution.
  *
  * The phase-1 engine treated surge as a flat 1.08x multiplier on the
  * wind MDR for locations with STORM_SURGE in their peril set. Surge
  * damages differently from wind (flooding of first-floor contents,
  * foundation failure, debris impact) so that shortcut is both
  * quantitatively wrong and conceptually misleading.
  *
  * This module adds a separate, additive surge loss path:
  *
  *   1. Estimate peak surge height at each site based on the storm's
  *      maximum Saffir-Simpson intensity at landfall and the site's
  *      distance from the nearest landfall track point.
  *   2. Apply a surge-specific damage ratio (surge-MDR curve is much
  *      steeper than wind; 6 ft of surge ruins a first-floor envelope).
  *   3. Add the surge loss to the wind loss, capped at TIV.
  *
  * Phase 2.7a (this commit) ships a parametric built-in surge formula
  * based on Saffir-Simpson surge ranges decayed with distance from the
  * track. Phase 2.7b (deferred) will load NOAA SLOSH MEOW tables via
  * the DataRegistry to replace the parametric approximation for basins
  * where MEOW data is available.
  *
  * Saffir-Simpson surge reference (Gulf coast, open coastline):
  *   TS     1-4 ft
  *   Cat 1  4-5 ft
  *   Cat 2  6-8 ft
  *   Cat 3  9-12 ft
  *   Cat 4  13-18 ft
  *   Cat 5  19+ ft
  *
  * Surge decays rapidly with distance from the landfall point (surge
  * is coastal, not radial) and with distance inland (no elevation data
  * here, so we use a simple exponential decay from the track).
  */
object StormSurge {

  /** Knots thresholds for Saffir-Simpson categories. */
  private val CategoryThresholdsKt: Vector[(Int, Double)] = Vector(
    0 -> 0d,    // weaker than TS: no surge
    1 -> 34d,   // TS-range surge
    2 -> 64d,   // Cat 1
    3 -> 83d,   // Cat 2
    4 -> 96d,   // Cat 3
    5 -> 113d,  // Cat 4
    6 -> 137d   // Cat 5
  )

  /** Peak surge height in feet by Saffir-Simpson category (midpoint of
    * published ranges). Index matches CategoryThresholdsKt rank. */
  private val PeakSurgeFt: Vector[Double] = Vector(0d, 2d, 4.5d, 7d, 10.5d, 15.5d, 22d)

  /** Distance over which surge attenuates along the coast / inland. */
  private val SurgeDecayKm: Double = 60d

  /** Surge only meaningfully damages sites close to the coast. Inland
    * locations (>100 km from the landfall track) get zero surge. */
  private val MaxRelevantDistanceKm: Double = 100d

  /** Is this storm capable of significant surge? Require the storm to
    * have reached at least Cat 2 intensity somewhere in its track. */
  def storedSaffirSimpsonCategory(storm: Hurdat2Storm): Int = {
    val maxWind = storm.maxWindKt.getOrElse(0)
    var category = 0
    CategoryThresholdsKt.foreach { case (c, thresh) =>
      if (maxWind >= thresh) category = c
    }
    category
  }

  /** Peak surge height at a site. Uses the storm's max SS category and
    * the site's minimum distance to any track point that the storm was
    * at that peak intensity. Falls off exponentially with distance.
    */
  def peakSurgeFt(storm: Hurdat2Storm, loc: PropertyLocation): Double = {
    val category = storedSaffirSimpsonCategory(storm)
    if (category <= 1) return 0d

    val peakFt = PeakSurgeFt(category)

    // Distance from the site to the nearest point on the track that was
    // within 15 kt of the peak. That's approximately the "landfall
    // window" - the surge envelope tracks with the peak intensity band.
    val peakWind = storm.maxWindKt.getOrElse(0)
    val peakBandPoints = storm.track.filter(p => (peakWind - p.maxWindKt) <= 15)
    if (peakBandPoints.isEmpty) return 0d

    val minDistKm = peakBandPoints.iterator
      .map(p => Geodesy.haversineKm(loc.latitude, loc.longitude, p.latitude, p.longitude))
      .min

    if (minDistKm > MaxRelevantDistanceKm) return 0d

    val decayed = peakFt * math.exp(-minDistKm / SurgeDecayKm)
    math.max(0d, decayed)
  }

  /** Convert surge height (ft) to a mean damage ratio. A much steeper
    * curve than the wind vulnerability curve because surge causes
    * first-floor envelope failure once it exceeds a few feet.
    */
  def surgeDamageRatio(surgeFt: Double): Double = {
    if (surgeFt <= 1d) 0d
    else if (surgeFt <= 3d) (surgeFt - 1d) * 0.05d        // 1-3 ft: up to 10% MDR
    else if (surgeFt <= 6d) 0.10d + (surgeFt - 3d) * 0.10d // 3-6 ft: 10-40% MDR
    else if (surgeFt <= 10d) 0.40d + (surgeFt - 6d) * 0.10d // 6-10 ft: 40-80% MDR
    else math.min(1d, 0.80d + (surgeFt - 10d) * 0.02d)    // 10+ ft: -> 1.0
  }

  /** Compute surge contribution to ground-up loss for a single (storm,
    * location) pair. Zero when the location doesn't carry STORM_SURGE
    * in its peril set, when the storm never reached Cat 2, or when the
    * site is too far from the peak-intensity track segment.
    */
  def modeledSurgeLoss(
      storm: Hurdat2Storm,
      loc: PropertyLocation,
      pp: PricingParameters
  ): Double = {
    if (!pp.useStormSurge) return 0d
    if (!loc.perilSet.exists(_.toUpperCase.contains("STORM_SURGE"))) return 0d
    val heightFt = peakSurgeFt(storm, loc)
    val ratio = surgeDamageRatio(heightFt)
    loc.tiv * ratio
  }
}
