package canopy.engine.property.hazard

/** Simple "is this point over land?" test used by the overland-decay
  * module and anyone else who needs a land/sea classification.
  *
  * Implementations ordered by fidelity:
  *
  *   NullLandMask             - treats everything as ocean. Used as the
  *                              graceful-degradation fallback when real
  *                              coastline data is unavailable. Overland
  *                              decay is then a no-op.
  *
  *   HardcodedUsCoastMask     - built-in coarse polygons covering the
  *                              US Gulf and Atlantic coasts plus Florida,
  *                              suitable for the indicative-pricing demo
  *                              without requiring a coastline data
  *                              download.
  *
  *   NaturalEarthLandMask     - (phase 3) parses Natural Earth 1:10m
  *                              land polygons from the DataRegistry.
  *                              Not yet wired.
  */
trait LandMask {
  def isLand(latDeg: Double, lonDeg: Double): Boolean
}

object NullLandMask extends LandMask {
  override def isLand(latDeg: Double, lonDeg: Double): Boolean = false
}

/** Coarse hand-digitised US Atlantic and Gulf coast polygons. Intended as
  * a plausible fallback, not a gazetteer - resolution is approximately
  * 100-200 km and many features (barrier islands, bays, keys) are
  * smoothed over. A production deployment should prefer the Natural
  * Earth mask via the DataRegistry.
  */
object HardcodedUsCoastMask extends LandMask {

  /** Each polygon is a counter-clockwise ring of (latitude, longitude)
    * pairs. We test each polygon with a standard ray-casting point-in-
    * polygon routine and return true if any contains the query point. */
  private val polygons: Vector[Vector[(Double, Double)]] = Vector(
    // US mainland east of the Mississippi (rough): Texas panhandle ->
    // Louisiana -> Mississippi -> Alabama -> Florida Panhandle ->
    // Georgia -> South/North Carolina -> Virginia -> Mid-Atlantic ->
    // New England -> Maine -> north boundary back west to Texas.
    Vector(
      (30.0, -97.0), (29.2, -94.8), (29.2, -91.0), (29.1, -89.2), (30.2, -88.0),
      (30.4, -86.3), (29.8, -84.8), (27.0, -82.5), (25.1, -80.8), (25.2, -80.2),
      (27.0, -80.0), (30.7, -81.4), (32.1, -80.8), (34.6, -76.7), (36.8, -75.9),
      (38.6, -75.0), (40.5, -74.0), (41.8, -71.0), (43.0, -70.6), (44.9, -66.9),
      (47.4, -68.2), (47.9, -82.2), (47.0, -90.0), (42.5, -95.0), (35.0, -100.0),
      (30.0, -97.0)
    ),
    // Florida peninsula (already covered by the mainland polygon above,
    // but we retain it for future refinement when barrier/mainland
    // polygons are split per-state).
    Vector(
      (25.0, -81.5), (25.1, -80.2), (28.5, -80.3), (30.5, -81.6),
      (30.7, -84.1), (29.9, -83.3), (27.8, -82.8), (26.2, -81.9),
      (25.0, -81.5)
    )
  )

  override def isLand(latDeg: Double, lonDeg: Double): Boolean =
    polygons.exists(polygon => pointInPolygon(polygon, latDeg, lonDeg))

  /** Standard ray-casting point-in-polygon. Ties at the boundary are
    * treated as outside; that's fine for our use (storm tracks are
    * continuous so a boundary crossing happens in a finite window). */
  private def pointInPolygon(polygon: Vector[(Double, Double)], lat: Double, lon: Double): Boolean = {
    var inside = false
    var j = polygon.size - 1
    var i = 0
    while (i < polygon.size) {
      val (ai, bi) = polygon(i)
      val (aj, bj) = polygon(j)
      val crosses =
        ((ai > lat) != (aj > lat)) &&
          (lon < (bj - bi) * (lat - ai) / (aj - ai) + bi)
      if (crosses) inside = !inside
      j = i
      i += 1
    }
    inside
  }
}

object LandMask {

  /** Resolve the best-available land mask. Production intent: check the
    * DataRegistry for Natural Earth data and use it when present,
    * otherwise fall back to the built-in coarse US coast polygons. The
    * Natural-Earth branch is not wired yet (phase 3); for now we return
    * the hardcoded mask when coastline-style data is available OR
    * requested, and Null otherwise.
    */
  def resolve(useHardcodedMask: Boolean): LandMask =
    if (useHardcodedMask) HardcodedUsCoastMask else NullLandMask
}
