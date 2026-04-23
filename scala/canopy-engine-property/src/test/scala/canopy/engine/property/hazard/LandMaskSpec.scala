package canopy.engine.property.hazard

import org.scalatest.funsuite.AnyFunSuite

class LandMaskSpec extends AnyFunSuite {

  test("NullLandMask returns false everywhere") {
    assert(!NullLandMask.isLand(29.5, -90.0))
    assert(!NullLandMask.isLand(0, 0))
    assert(!NullLandMask.isLand(45, -75))
  }

  test("HardcodedUsCoastMask classifies inland US points as land") {
    // Dallas, Atlanta, Orlando, Richmond.
    assert(HardcodedUsCoastMask.isLand(32.8, -96.8), "Dallas should be land")
    assert(HardcodedUsCoastMask.isLand(33.7, -84.4), "Atlanta should be land")
    assert(HardcodedUsCoastMask.isLand(28.5, -81.4), "Orlando should be land")
    assert(HardcodedUsCoastMask.isLand(37.5, -77.4), "Richmond should be land")
  }

  test("HardcodedUsCoastMask classifies offshore points as ocean") {
    // Gulf of Mexico (deepwater), Atlantic mid-ocean, Caribbean.
    assert(!HardcodedUsCoastMask.isLand(25.0, -89.0), "central Gulf should be ocean")
    assert(!HardcodedUsCoastMask.isLand(30.0, -72.0), "mid-Atlantic should be ocean")
    assert(!HardcodedUsCoastMask.isLand(20.0, -70.0), "Caribbean should be ocean")
  }

  test("HardcodedUsCoastMask does not claim points far from the US") {
    // Hawaii, Europe, Africa.
    assert(!HardcodedUsCoastMask.isLand(21.3, -157.9), "Hawaii not covered")
    assert(!HardcodedUsCoastMask.isLand(51.5, 0.0), "London not covered")
    assert(!HardcodedUsCoastMask.isLand(-30, 30), "southern Africa not covered")
  }

  test("LandMask.resolve honors the pricing-parameter flag") {
    val hardcoded = LandMask.resolve(useHardcodedMask = true)
    val nullMask = LandMask.resolve(useHardcodedMask = false)
    assert(hardcoded.isLand(32.8, -96.8)) // Dallas
    assert(!nullMask.isLand(32.8, -96.8))
  }
}
