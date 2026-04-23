package canopy.engine.property

import org.scalatest.funsuite.AnyFunSuite

/** Pin the default PricingParameters values so the phase-1 refactor's
  * "no numerical change" property is enforced by a test, not just a promise.
  * Changing any of these numbers should require an explicit golden refresh
  * per the plan's golden-discipline policy.
  */
class PricingParametersSpec extends AnyFunSuite {
  import Hurdat2PropertyCatPricingYltSimulator.PricingParameters

  test("default wind attenuation parameters match pre-refactor literals") {
    val pp = PricingParameters.default
    assert(pp.defaultWindRadiusKm == 140d)
    assert(pp.minDecayScaleKm == 60d)
    assert(pp.radiusToDecayScaleRatio == 1.15d)
    assert(pp.nauticalMileKm == 1.852d)
  }

  test("default vulnerability curve parameters match pre-refactor literals") {
    val pp = PricingParameters.default
    assert(pp.minDamagingWindKt == 35d)
    assert(pp.saturationWindKt == 130d)
    assert(pp.vulnerabilityExponent == 2.25d)
  }

  test("default peril and occupancy factors match pre-refactor literals") {
    val pp = PricingParameters.default
    assert(pp.perilFactorStormSurge == 1.08d)
    assert(pp.perilFactorWind == 1d)
    assert(pp.perilFactorOther == 0.7d)
    assert(pp.occupancyFactorIndustrial == 1.10d)
    assert(pp.occupancyFactorHospitality == 1.05d)
    assert(pp.occupancyFactorResidential == 0.95d)
    assert(pp.occupancyFactorCommercial == 1.00d)
    assert(pp.occupancyFactorDefault == 1.00d)
  }

  test("default risk-metric and AEP scale parameters match pre-refactor literals") {
    val pp = PricingParameters.default
    assert(pp.var99Quantile == 0.99d)
    assert(pp.exhaustionQuantile == 0.95d)
    assert(pp.aepScale == 0.94d)
  }

  test("Params gets PricingParameters.default when omitted") {
    val p = Hurdat2PropertyCatPricingYltSimulator.Params(
      simulatedYears = 100,
      returnPeriodsYears = Vector(10),
      yltRowLimit = 10,
      lossBasis = "net",
      includeGrossNetBreakout = true,
      includeSummaryPercentiles = true,
      currency = "USD",
      randomSeed = 42
    )
    assert(p.pricingParameters == PricingParameters.default)
  }
}
