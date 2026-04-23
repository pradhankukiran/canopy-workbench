package canopy.engine.property.hazard

/** Terrain-based 10 m wind reduction factor.
  *
  * The Holland profile and Schwerdt asymmetry produce a surface wind in
  * the conventional open-water boundary layer. For inland sites the
  * actual wind experienced by a structure is significantly lower because
  * buildings, trees, and topography convert momentum into turbulence.
  *
  * The table below follows the qualitative ESDU 85020 / ASCE 7-16
  * exposure-category scheme:
  *
  *   Exposure   z0 (m)     typical factor at 10m
  *     D/open_water   0.003          1.00  (baseline: overwater)
  *     C/open_terrain 0.03           0.93
  *     suburban       0.30           0.85
  *     urban          0.80           0.75
  *     dense_urban    1.50           0.65
  *     forest         1.20           0.72
  *
  * These are single-point factors, not a full log-law profile. A proper
  * treatment would compute z0 from land-use and apply the logarithmic
  * profile between the boundary-layer top and the building's mean roof
  * height; that's a phase-3 consideration once construction taxonomy is
  * wired to detailed envelope models.
  */
object SurfaceRoughness {

  val OpenWater: Double = 1.00d
  val OpenTerrain: Double = 0.93d
  val Suburban: Double = 0.85d
  val Urban: Double = 0.75d
  val DenseUrban: Double = 0.65d
  val Forest: Double = 0.72d

  /** Map a surfaceRoughnessClass (from PropertyLocation) to the 10m
    * reduction factor. Unknown values return 1.0 so unclassified sites
    * default to no reduction rather than a spurious one. */
  def factorFor(surfaceRoughnessClass: Option[String]): Double = {
    surfaceRoughnessClass.map(_.trim.toLowerCase) match {
      case Some("open_water")    => OpenWater
      case Some("open_terrain")  => OpenTerrain
      case Some("suburban")      => Suburban
      case Some("urban")         => Urban
      case Some("dense_urban")   => DenseUrban
      case Some("forest")        => Forest
      case _                     => 1.00d
    }
  }
}
