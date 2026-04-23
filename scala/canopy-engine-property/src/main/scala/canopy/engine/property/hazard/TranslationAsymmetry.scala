package canopy.engine.property.hazard

/** Schwerdt (1979) translation-speed asymmetry correction.
  *
  * A moving tropical cyclone is not radially symmetric: the storm's
  * forward motion adds to winds on the right of the track (in NH) and
  * subtracts on the left. The correction takes the form
  *
  *     V_eff = V_symm + k * V_trans * sign(lat) * sin(bearing - heading)
  *
  * where `bearing - heading` is the angular offset of the site from the
  * storm's direction of motion. In NH the maximum boost falls at
  * `bearing - heading = +90 deg` (site to the right of the track) and
  * the maximum reduction at `-90 deg` (to the left). In SH the sign is
  * flipped because storms rotate clockwise.
  *
  * Reference: Schwerdt, R. W., F. P. Ho, and R. W. Watkins (1979),
  *   "Meteorological criteria for standard project hurricane and
  *    probable maximum hurricane windfields", NOAA Technical Report
  *    NWS-23.
  */
object TranslationAsymmetry {

  /** Translation-speed adjustment in the same units as the input
    * translation speed. Returns 0 when heading or speed are missing
    * (e.g. single-point tracks or zero dt between fixes).
    */
  def adjustment(
      stormLatDeg: Double,
      stormLonDeg: Double,
      headingDeg: Option[Double],
      translationSpeed: Option[Double],
      siteLatDeg: Double,
      siteLonDeg: Double,
      k: Double
  ): Double = {
    val headingOpt = headingDeg.filter(h => !h.isNaN && !h.isInfinite)
    val speedOpt = translationSpeed.filter(s => s > 0d && !s.isNaN && !s.isInfinite)
    (headingOpt, speedOpt) match {
      case (Some(h), Some(v)) =>
        val bearing = Geodesy.bearingDeg(stormLatDeg, stormLonDeg, siteLatDeg, siteLonDeg)
        val offset = normalizeDeg(bearing - h)
        val hemiSign = if (stormLatDeg >= 0d) 1d else -1d
        k * v * hemiSign * math.sin(math.toRadians(offset))
      case _ => 0d
    }
  }

  /** Map an arbitrary bearing difference to (-180, 180]. */
  def normalizeDeg(deg: Double): Double = {
    var d = deg % 360d
    if (d > 180d) d -= 360d
    if (d <= -180d) d += 360d
    d
  }
}
