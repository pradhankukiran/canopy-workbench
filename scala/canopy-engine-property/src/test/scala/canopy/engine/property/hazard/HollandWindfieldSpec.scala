package canopy.engine.property.hazard

import org.scalatest.funsuite.AnyFunSuite

/** Unit tests for the Holland (1980) windfield. These pin structural
  * behaviour (profile shape, monotonicity, parameter clamping) and
  * sanity-check one well-known historical storm (Hurricane Andrew 1992,
  * landfall intensity).
  */
class HollandWindfieldSpec extends AnyFunSuite {

  // Hurricane Andrew, 1992 landfall. Reported values:
  //   V_max ~ 145 kt (Category 5 at landfall)
  //   Pc    ~ 922 mb
  //   Rmax  ~ 13 km
  //   Landfall latitude ~ 25.5 N (south Florida)
  //
  // At r = Rmax the Holland profile should return approximately the
  // reported max wind after the surface reduction factor. We allow
  // 25% slack since the analytic peak occurs at gradient-wind Rmax
  // which does not exactly equal the 1-min sustained 10 m surface
  // peak radius, and because environmental pressure/density vary.
  private val AndrewVMax = 145d
  private val AndrewPc = 922d
  private val AndrewRmax = 13d
  private val AndrewLat = 25.5d

  test("wind peaks near Rmax") {
    val atRmax = HollandWindfield.surfaceWindKt(AndrewRmax, AndrewRmax, AndrewVMax, AndrewPc, AndrewLat)
    val at2xRmax = HollandWindfield.surfaceWindKt(2 * AndrewRmax, AndrewRmax, AndrewVMax, AndrewPc, AndrewLat)
    val atHalfRmax = HollandWindfield.surfaceWindKt(AndrewRmax / 2, AndrewRmax, AndrewVMax, AndrewPc, AndrewLat)
    assert(atRmax > at2xRmax, s"wind at Rmax ($atRmax) should exceed wind at 2*Rmax ($at2xRmax)")
    assert(atRmax > atHalfRmax, s"wind at Rmax ($atRmax) should exceed wind at Rmax/2 ($atHalfRmax)")
  }

  test("Andrew peak wind within 25% of reported V_max") {
    val atRmax = HollandWindfield.surfaceWindKt(AndrewRmax, AndrewRmax, AndrewVMax, AndrewPc, AndrewLat)
    val ratio = atRmax / AndrewVMax
    assert(ratio > 0.75 && ratio < 1.25, s"Andrew peak: Holland=${atRmax} kt, reported=${AndrewVMax} kt, ratio=$ratio")
  }

  test("wind decays monotonically beyond Rmax") {
    val samples = Seq(20d, 40d, 80d, 160d, 320d).map { r =>
      r -> HollandWindfield.surfaceWindKt(r, AndrewRmax, AndrewVMax, AndrewPc, AndrewLat)
    }
    samples.sliding(2).filter(_.size == 2).foreach { case Seq((ra, va), (rb, vb)) =>
      assert(vb <= va + 1e-9, s"non-monotonic decay: r=$ra -> $va kt, r=$rb -> $vb kt")
    }
  }

  test("wind decays far from eye") {
    val atFar = HollandWindfield.surfaceWindKt(500d, AndrewRmax, AndrewVMax, AndrewPc, AndrewLat)
    assert(atFar < 30d, s"wind at 500 km should be well below tropical storm force; got $atFar kt")
  }

  test("Holland B is clamped to plausible range") {
    val bLow = HollandWindfield.deriveB(vMaxMs = 5d, deltaPPa = 20000d)
    val bHigh = HollandWindfield.deriveB(vMaxMs = 100d, deltaPPa = 500d)
    assert(bLow >= HollandWindfield.MinHollandB)
    assert(bHigh <= HollandWindfield.MaxHollandB)
  }

  test("Coriolis is positive in NH and negative via abs in SH") {
    val north = HollandWindfield.coriolisAt(25d)
    val south = HollandWindfield.coriolisAt(-25d)
    assert(north > 0d)
    assert(south > 0d) // abs(lat) used, so both hemispheres give positive f
  }

  test("returns zero when Rmax or V_max are missing") {
    assert(HollandWindfield.surfaceWindKt(10d, 0d, 100d, 950d, 25d) == 0d)
    assert(HollandWindfield.surfaceWindKt(10d, 20d, 0d, 950d, 25d) == 0d)
  }

  test("returns zero when central pressure exceeds environmental") {
    assert(HollandWindfield.surfaceWindKt(10d, 20d, 100d, 1020d, 25d) == 0d)
  }

  test("higher category storm produces higher peak winds at same Rmax") {
    val cat1 = HollandWindfield.surfaceWindKt(20d, 20d, 75d, 985d, 25d)
    val cat5 = HollandWindfield.surfaceWindKt(20d, 20d, 145d, 920d, 25d)
    assert(cat5 > cat1 * 1.3, s"Cat5 ($cat5) should greatly exceed Cat1 ($cat1)")
  }
}
