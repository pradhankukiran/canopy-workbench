package canopy.engine.property.hazard

import org.scalatest.funsuite.AnyFunSuite

class SurfaceRoughnessSpec extends AnyFunSuite {

  test("open water is the baseline (factor 1.0)") {
    assert(SurfaceRoughness.factorFor(Some("open_water")) == 1.00d)
  }

  test("factors decrease with increasing roughness") {
    val openTerrain = SurfaceRoughness.factorFor(Some("open_terrain"))
    val suburban = SurfaceRoughness.factorFor(Some("suburban"))
    val urban = SurfaceRoughness.factorFor(Some("urban"))
    val denseUrban = SurfaceRoughness.factorFor(Some("dense_urban"))
    assert(openTerrain > suburban, s"open_terrain $openTerrain should exceed suburban $suburban")
    assert(suburban > urban, s"suburban $suburban should exceed urban $urban")
    assert(urban > denseUrban, s"urban $urban should exceed dense_urban $denseUrban")
  }

  test("all factors fall within [0.5, 1.0]") {
    val classes = Seq("open_water", "open_terrain", "suburban", "urban", "dense_urban", "forest")
    classes.foreach { c =>
      val f = SurfaceRoughness.factorFor(Some(c))
      assert(f >= 0.5 && f <= 1.0, s"$c factor $f outside [0.5, 1.0]")
    }
  }

  test("unknown terrain class returns 1.0 (no reduction)") {
    assert(SurfaceRoughness.factorFor(Some("moonbase")) == 1.0d)
    assert(SurfaceRoughness.factorFor(None) == 1.0d)
  }

  test("forest lies between suburban and urban") {
    val suburban = SurfaceRoughness.factorFor(Some("suburban"))
    val forest = SurfaceRoughness.factorFor(Some("forest"))
    val urban = SurfaceRoughness.factorFor(Some("urban"))
    assert(forest < suburban && forest > urban - 0.05, s"forest $forest should sit near urban $urban")
  }
}
