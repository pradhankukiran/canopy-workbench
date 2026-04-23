package canopy.engine.property.hazard

/** Spherical-earth geodesic helpers. Separate from Windfield so the
  * overland-decay module (phase 2.5) and storm-surge lookups (phase 2.7)
  * can share distance/bearing computations without pulling in the whole
  * hazard module.
  */
object Geodesy {

  /** Earth radius in km (WGS84 mean). */
  val EarthRadiusKm: Double = 6371.0088d

  /** Great-circle distance between two lat/lon points in kilometres. */
  def haversineKm(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double = {
    val dLat = math.toRadians(lat2 - lat1)
    val dLon = math.toRadians(lon2 - lon1)
    val a =
      math.pow(math.sin(dLat / 2d), 2d) +
        math.cos(math.toRadians(lat1)) * math.cos(math.toRadians(lat2)) * math.pow(math.sin(dLon / 2d), 2d)
    val c = 2d * math.atan2(math.sqrt(a), math.sqrt(1d - a))
    EarthRadiusKm * c
  }

  /** Forward bearing in degrees from (lat1, lon1) to (lat2, lon2).
    * 0 = north, 90 = east. Used by translation-asymmetry (phase 2.4) to
    * compute the storm's heading relative to a site. */
  def bearingDeg(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double = {
    val phi1 = math.toRadians(lat1)
    val phi2 = math.toRadians(lat2)
    val lambda = math.toRadians(lon2 - lon1)
    val y = math.sin(lambda) * math.cos(phi2)
    val x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(lambda)
    val bearing = math.toDegrees(math.atan2(y, x))
    (bearing + 360d) % 360d
  }
}
