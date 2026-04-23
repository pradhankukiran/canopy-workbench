package canopy.engine.property.hazard

import org.scalatest.funsuite.AnyFunSuite

class RmaxEstimatorSpec extends AnyFunSuite {

  test("Willoughby 2006 gives smaller Rmax for stronger storms") {
    val rCat1 = RmaxEstimator.willoughby2006Km(vMaxKt = 75d, latitudeDeg = 25d)
    val rCat5 = RmaxEstimator.willoughby2006Km(vMaxKt = 150d, latitudeDeg = 25d)
    assert(rCat5 < rCat1, s"Cat5 Rmax ($rCat5) should be smaller than Cat1 ($rCat1)")
  }

  test("Willoughby 2006 gives larger Rmax at higher latitude") {
    val rTropical = RmaxEstimator.willoughby2006Km(vMaxKt = 100d, latitudeDeg = 15d)
    val rMidlat = RmaxEstimator.willoughby2006Km(vMaxKt = 100d, latitudeDeg = 40d)
    assert(rMidlat > rTropical, s"midlat ($rMidlat) should exceed tropical ($rTropical)")
  }

  test("Willoughby 2006 spot-checks match published mean magnitudes") {
    // The Willoughby formula is an empirical regression over the HRD
    // flight-level database, so it predicts a mean Rmax for storms of a
    // given intensity and latitude. Individual storms can deviate
    // substantially (Andrew 1992 had an observed Rmax of ~13 km but the
    // Willoughby mean for its intensity/latitude is ~22 km).

    // Cat-5 at 25N: published Willoughby mean is ~21-24 km.
    val cat5 = RmaxEstimator.willoughby2006Km(145d, 25d)
    assert(cat5 > 18d && cat5 < 28d, s"Cat-5 mean Rmax $cat5 km outside [18, 28]")

    // Tropical storm at 30 N: mean is ~42-45 km.
    val ts = RmaxEstimator.willoughby2006Km(45d, 30d)
    assert(ts > 35d && ts < 55d, s"TS mean Rmax $ts km outside [35, 55]")
  }

  test("Willoughby 2006 is symmetric in hemisphere (uses |lat|)") {
    val north = RmaxEstimator.willoughby2006Km(100d, 25d)
    val south = RmaxEstimator.willoughby2006Km(100d, -25d)
    assert(math.abs(north - south) < 1e-9)
  }
}
