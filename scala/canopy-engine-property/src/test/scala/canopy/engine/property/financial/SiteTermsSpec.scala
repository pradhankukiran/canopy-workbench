package canopy.engine.property.financial

import canopy.engine.property.Hurdat2PropertyCatPricingYltSimulator.PropertyLocation
import org.scalatest.funsuite.AnyFunSuite

class SiteTermsSpec extends AnyFunSuite {

  private def loc(
      tiv: Double = 10_000_000d,
      deductible: Double = 100_000d,
      limit: Double = 8_000_000d,
      perilDeductibles: Map[String, Double] = Map.empty,
      sublimits: Map[String, Double] = Map.empty
  ): PropertyLocation = PropertyLocation(
    locationId = "loc_x",
    latitude = 29.5,
    longitude = -90d,
    tiv = tiv,
    deductible = deductible,
    limit = limit,
    occupancy = None,
    perilSet = Vector("WIND", "STORM_SURGE"),
    country = Some("US"),
    perilDeductibles = perilDeductibles,
    sublimits = sublimits
  )

  test("site-level deductible applied when no per-peril override exists") {
    val l = loc(deductible = 100_000d, limit = 1_000_000d)
    val (gross, insured) = SiteTerms.applyPerilTerms(Map("WIND" -> 500_000d), l)
    assert(gross == 500_000d)
    assert(insured == 400_000d)
  }

  test("per-peril absolute deductible overrides site-level") {
    val l = loc(
      deductible = 100_000d,
      limit = 1_000_000d,
      perilDeductibles = Map("WIND" -> 250_000d)
    )
    val (_, insured) = SiteTerms.applyPerilTerms(Map("WIND" -> 500_000d), l)
    assert(insured == 250_000d)
  }

  test("fractional deductible in (0, 1] is treated as % of TIV") {
    val l = loc(
      tiv = 1_000_000d,
      limit = 1_000_000d,
      perilDeductibles = Map("WIND" -> 0.05d) // 5% of TIV = 50k
    )
    val (_, insured) = SiteTerms.applyPerilTerms(Map("WIND" -> 500_000d), l)
    assert(insured == 450_000d)
  }

  test("per-peril sublimit caps gross before deductible") {
    val l = loc(
      deductible = 0d,
      limit = 10_000_000d,
      sublimits = Map("WIND" -> 200_000d)
    )
    val (gross, insured) = SiteTerms.applyPerilTerms(Map("WIND" -> 900_000d), l)
    assert(gross == 200_000d)
    assert(insured == 200_000d)
  }

  test("site limit caps the total insured across perils") {
    val l = loc(
      tiv = 5_000_000d,
      deductible = 0d,
      limit = 600_000d
    )
    val (_, insured) = SiteTerms.applyPerilTerms(
      Map("WIND" -> 500_000d, "STORM_SURGE" -> 400_000d),
      l
    )
    assert(insured == 600_000d)
  }

  test("peril map keys are case-insensitive") {
    val l = loc(
      deductible = 100_000d,
      limit = 1_000_000d,
      perilDeductibles = Map("wind" -> 250_000d, "storm_surge" -> 0d)
    )
    val (_, insured) = SiteTerms.applyPerilTerms(
      Map("WIND" -> 500_000d, "STORM_SURGE" -> 100_000d),
      l
    )
    // 500k wind - 250k ded = 250k; 100k surge - 0 ded = 100k; total 350k
    assert(insured == 350_000d)
  }

  test("empty peril-loss map yields zero") {
    val (g, i) = SiteTerms.applyPerilTerms(Map.empty, loc())
    assert(g == 0d && i == 0d)
  }

  test("losses above TIV after sublimits still bounded by limit") {
    val l = loc(tiv = 2_000_000d, deductible = 0d, limit = 1_500_000d)
    val (_, insured) = SiteTerms.applyPerilTerms(Map("WIND" -> 3_000_000d, "STORM_SURGE" -> 3_000_000d), l)
    assert(insured == 1_500_000d)
  }
}
