package canopy.engine.property

import canopy.data.hurdat2.Hurdat2Dataset
import org.scalatest.funsuite.AnyFunSuite

import Hurdat2PropertyCatPricingYltSimulator._

/** Exercises the portfolio-normalization guardrail that landed in phase 1.6.
  *
  * Before this change, the simulator would silently fabricate a New Orleans
  * location ($10M TIV, WIND only) on empty input and return a plausible
  * pricing result. That is unacceptable: it meant buggy callers or
  * misconfigured uploads would produce numbers that looked real and priced
  * against synthetic exposure. The guardrail replaces the fallback with a
  * loud IllegalArgumentException.
  */
class PortfolioValidationSpec extends AnyFunSuite {

  private val baseParams = Params(
    simulatedYears = 10,
    returnPeriodsYears = Vector(10),
    yltRowLimit = 10,
    lossBasis = "net",
    includeGrossNetBreakout = true,
    includeSummaryPercentiles = true,
    currency = "USD",
    randomSeed = 42
  )

  private val emptyDataset = Hurdat2Dataset(storms = Vector.empty)

  test("empty portfolio raises rather than fabricating a location") {
    val empty = PropertyPortfolio(
      portfolioId = "pf_test_empty",
      name = "empty",
      currency = "USD",
      locations = Vector.empty
    )
    val ex = intercept[IllegalArgumentException] {
      Hurdat2PropertyCatPricingYltSimulator.simulate(emptyDataset, empty, baseParams)
    }
    assert(ex.getMessage.contains("pf_test_empty"))
    assert(ex.getMessage.toLowerCase.contains("no locations"))
  }

  test("portfolio with only out-of-range locations raises") {
    val bad = PropertyPortfolio(
      portfolioId = "pf_test_bad",
      name = "bad",
      currency = "USD",
      locations = Vector(
        PropertyLocation(
          locationId = "loc_bad1",
          latitude = 200d,
          longitude = 0d,
          tiv = 1000000d,
          deductible = 0d,
          limit = 0d,
          occupancy = None,
          perilSet = Vector("WIND"),
          country = Some("US")
        )
      )
    )
    intercept[IllegalArgumentException] {
      Hurdat2PropertyCatPricingYltSimulator.simulate(emptyDataset, bad, baseParams)
    }
  }

  test("portfolio with zero-TIV locations raises") {
    val zeroTiv = PropertyPortfolio(
      portfolioId = "pf_test_zero",
      name = "zero",
      currency = "USD",
      locations = Vector(
        PropertyLocation(
          locationId = "loc_zero",
          latitude = 29.5d,
          longitude = -90d,
          tiv = 0d,
          deductible = 0d,
          limit = 0d,
          occupancy = None,
          perilSet = Vector("WIND"),
          country = Some("US")
        )
      )
    )
    intercept[IllegalArgumentException] {
      Hurdat2PropertyCatPricingYltSimulator.simulate(emptyDataset, zeroTiv, baseParams)
    }
  }

  test("portfolio with at least one valid location proceeds") {
    val good = PropertyPortfolio(
      portfolioId = "pf_test_good",
      name = "good",
      currency = "USD",
      locations = Vector(
        PropertyLocation(
          locationId = "loc_good1",
          latitude = 29.5d,
          longitude = -90d,
          tiv = 1000000d,
          deductible = 0d,
          limit = 0d,
          occupancy = Some("Commercial"),
          perilSet = Vector("WIND"),
          country = Some("US")
        )
      )
    )
    val result = Hurdat2PropertyCatPricingYltSimulator.simulate(emptyDataset, good, baseParams)
    assert(result.portfolio.locations.size == 1)
    assert(result.portfolio.locations.head.locationId == "loc_good1")
  }
}
