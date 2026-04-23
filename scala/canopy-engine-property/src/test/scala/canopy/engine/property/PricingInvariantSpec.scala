package canopy.engine.property

import canopy.data.hurdat2._
import org.scalacheck.{Arbitrary, Gen}
import org.scalatest.funsuite.AnyFunSuite
import org.scalatestplus.scalacheck.ScalaCheckPropertyChecks

import java.time.{LocalDate, LocalTime}

import Hurdat2PropertyCatPricingYltSimulator._

/** Property-based invariants the pricing engine must satisfy.
  *
  * These are the "actuarial sanity" checks called out in phase 1.7 of the
  * production-hardening plan. They trip early on any later change that
  * violates a fundamental structural invariant, before goldens would even
  * notice.
  */
class PricingInvariantSpec extends AnyFunSuite with ScalaCheckPropertyChecks {

  implicit override val generatorDrivenConfig: PropertyCheckConfiguration =
    PropertyCheckConfiguration(minSuccessful = 25, workers = 1, sizeRange = 5)

  private val perilChoices = Gen.oneOf(
    Vector("WIND"),
    Vector("WIND", "HAIL"),
    Vector("WIND", "STORM_SURGE"),
    Vector("WIND", "HAIL", "STORM_SURGE")
  )

  private val occupancyChoices = Gen.oneOf(
    Some("Commercial"),
    Some("Residential"),
    Some("Industrial"),
    Some("Hospitality"),
    None
  )

  private val locationGen: Gen[PropertyLocation] = for {
    id <- Gen.posNum[Int].map(i => s"loc_g$i")
    lat <- Gen.choose(24.0, 45.0)
    lon <- Gen.choose(-98.0, -70.0)
    tiv <- Gen.choose(1_000_000d, 50_000_000d)
    dedRatio <- Gen.choose(0.001, 0.05)
    limRatio <- Gen.choose(0.5, 1.0)
    occ <- occupancyChoices
    perils <- perilChoices
  } yield PropertyLocation(
    locationId = id,
    latitude = lat,
    longitude = lon,
    tiv = tiv,
    deductible = tiv * dedRatio,
    limit = tiv * limRatio,
    occupancy = occ,
    perilSet = perils,
    country = Some("US")
  )

  private val portfolioGen: Gen[PropertyPortfolio] = for {
    n <- Gen.choose(1, 5)
    locs <- Gen.listOfN(n, locationGen).map(_.toVector)
    pfId <- Gen.posNum[Int].map(i => s"pf_g$i")
  } yield PropertyPortfolio(
    portfolioId = pfId,
    name = "generated",
    currency = "USD",
    locations = locs
  )

  private def trackPoint(lat: Double, lon: Double, windKt: Int, year: Int): Hurdat2TrackPoint =
    Hurdat2TrackPoint(
      date = LocalDate.of(year, 9, 1),
      time = LocalTime.NOON,
      recordIdentifier = None,
      status = "HU",
      latitude = lat,
      longitude = lon,
      maxWindKt = windKt,
      minPressureMb = Some(950),
      windRadii34KtNm = Some(Hurdat2WindRadii(Some(80), Some(80), Some(80), Some(80))),
      windRadii50KtNm = None,
      windRadii64KtNm = None
    )

  private def makeStorm(year: Int, seq: Int, windKt: Int): Hurdat2Storm = {
    val id = Hurdat2StormId(s"AL$seq%02d$year", "AL", seq, year)
    val header = Hurdat2StormHeader(id, s"STORM$seq", 3)
    Hurdat2Storm(
      header = header,
      track = Vector(
        trackPoint(28.0, -92.0, windKt, year),
        trackPoint(29.5, -90.5, windKt, year),
        trackPoint(31.0, -89.0, math.max(35, windKt - 20), year)
      )
    )
  }

  private def datasetWith(years: Range, windKt: Int = 100): Hurdat2Dataset =
    Hurdat2Dataset(years.zipWithIndex.map { case (y, idx) => makeStorm(y, idx + 1, windKt) }.toVector)

  private val datasetGen: Gen[Hurdat2Dataset] = for {
    start <- Gen.choose(1980, 1990)
    span  <- Gen.choose(5, 12)
    wind  <- Gen.choose(65, 140)
  } yield datasetWith(start until (start + span), wind)

  private val paramsGen: Gen[Params] = for {
    years <- Gen.choose(100, 500)
    seed  <- Gen.choose(1, 10000)
  } yield Params(
    simulatedYears = years,
    returnPeriodsYears = Vector(10, 50, 100),
    yltRowLimit = 10,
    lossBasis = "net",
    includeGrossNetBreakout = true,
    includeSummaryPercentiles = true,
    currency = "USD",
    randomSeed = seed
  )

  implicit val arbPortfolio: Arbitrary[PropertyPortfolio] = Arbitrary(portfolioGen)
  implicit val arbDataset: Arbitrary[Hurdat2Dataset] = Arbitrary(datasetGen)
  implicit val arbParams: Arbitrary[Params] = Arbitrary(paramsGen)

  test("invariant: aggregate gross loss never exceeds total TIV") {
    forAll { (portfolio: PropertyPortfolio, dataset: Hurdat2Dataset, params: Params) =>
      val result = Hurdat2PropertyCatPricingYltSimulator.simulate(dataset, portfolio, params)
      val totalTiv = portfolio.locations.map(_.tiv).sum
      val maxGross = result.simulatedYears.map(_.grossLoss).maxOption.getOrElse(0d)
      assert(maxGross <= totalTiv + 1e-6, s"gross loss $maxGross exceeds portfolio TIV $totalTiv")
    }
  }

  test("invariant: net loss never exceeds gross loss") {
    forAll { (portfolio: PropertyPortfolio, dataset: Hurdat2Dataset, params: Params) =>
      val result = Hurdat2PropertyCatPricingYltSimulator.simulate(dataset, portfolio, params)
      result.simulatedYears.foreach { y =>
        assert(y.netLoss <= y.grossLoss + 1e-6, s"year ${y.yearIndex}: net=${y.netLoss} > gross=${y.grossLoss}")
      }
    }
  }

  test("invariant: AEP at every return period is less than or equal to OEP (current model)") {
    // In the current phase-1 model AEP = OEP * aepScale with aepScale < 1,
    // so AEP <= OEP is tautological by construction. Phase 3 replaces this
    // with a real aggregate/occurrence derivation and the invariant changes
    // direction - AEP(p) >= OEP(p) because aggregating multiple events in a
    // year cannot lower the quantile. Pinning the current direction here
    // guards against silent drift during the transition.
    forAll { (portfolio: PropertyPortfolio, dataset: Hurdat2Dataset, params: Params) =>
      val result = Hurdat2PropertyCatPricingYltSimulator.simulate(dataset, portfolio, params)
      val zipped = result.riskMetrics.oep.zip(result.riskMetrics.aep)
      zipped.foreach { case (oep, aep) =>
        assert(aep.grossLoss <= oep.grossLoss + 1e-6)
        assert(aep.netLoss <= oep.netLoss + 1e-6)
      }
    }
  }

  test("invariant: TVaR >= VaR at the same quantile") {
    forAll { (portfolio: PropertyPortfolio, dataset: Hurdat2Dataset, params: Params) =>
      val result = Hurdat2PropertyCatPricingYltSimulator.simulate(dataset, portfolio, params)
      assert(result.riskMetrics.tvar99 >= result.riskMetrics.var99 - 1e-6)
    }
  }

  test("invariant: locations with deductible >= TIV produce zero insured loss") {
    forAll(portfolioGen, datasetGen, paramsGen) { (basePortfolio, dataset, params) =>
      // Rewrite every location so its deductible equals its TIV; any positive
      // gross loss must still result in zero insured loss (and therefore
      // zero net loss) because there is nothing left above the deductible.
      val uninsured = basePortfolio.copy(
        locations = basePortfolio.locations.map(l => l.copy(deductible = l.tiv, limit = l.tiv))
      )
      val result = Hurdat2PropertyCatPricingYltSimulator.simulate(dataset, uninsured, params)
      result.simulatedYears.foreach { y =>
        assert(y.netLoss <= 1e-6, s"year ${y.yearIndex}: net=${y.netLoss} with deductible=TIV")
      }
    }
  }

  test("invariant: same seed produces identical outputs") {
    forAll(portfolioGen, datasetGen) { (portfolio, dataset) =>
      val p = Params(
        simulatedYears = 200,
        returnPeriodsYears = Vector(50),
        yltRowLimit = 5,
        lossBasis = "net",
        includeGrossNetBreakout = true,
        includeSummaryPercentiles = true,
        currency = "USD",
        randomSeed = 2025
      )
      val a = Hurdat2PropertyCatPricingYltSimulator.simulate(dataset, portfolio, p)
      val b = Hurdat2PropertyCatPricingYltSimulator.simulate(dataset, portfolio, p)
      assert(a.riskMetrics.expectedLoss == b.riskMetrics.expectedLoss)
      assert(a.riskMetrics.var99 == b.riskMetrics.var99)
      assert(a.simulatedYears.map(_.grossLoss) == b.simulatedYears.map(_.grossLoss))
    }
  }

  test("invariant: dataset with zero events produces zero expected loss") {
    forAll(portfolioGen) { portfolio =>
      val p = Params(
        simulatedYears = 100,
        returnPeriodsYears = Vector(10),
        yltRowLimit = 5,
        lossBasis = "net",
        includeGrossNetBreakout = true,
        includeSummaryPercentiles = true,
        currency = "USD",
        randomSeed = 1
      )
      val empty = Hurdat2Dataset(storms = Vector.empty)
      val result = Hurdat2PropertyCatPricingYltSimulator.simulate(empty, portfolio, p)
      assert(result.riskMetrics.expectedLoss == 0d)
      assert(result.riskMetrics.var99 == 0d)
      assert(result.simulatedYears.forall(_.grossLoss == 0d))
    }
  }

  test("invariant: expected loss is non-negative") {
    forAll { (portfolio: PropertyPortfolio, dataset: Hurdat2Dataset, params: Params) =>
      val result = Hurdat2PropertyCatPricingYltSimulator.simulate(dataset, portfolio, params)
      assert(result.riskMetrics.expectedLoss >= 0d)
      assert(result.riskMetrics.stdDevLoss >= 0d)
      assert(result.riskMetrics.attachmentProbability >= 0d)
      assert(result.riskMetrics.attachmentProbability <= 1d)
    }
  }

  test("invariant: OEP is monotonically non-decreasing in return period") {
    // Higher return periods correspond to more extreme quantiles, so the
    // loss at RP=100 must not be lower than the loss at RP=10. This is a
    // pure structural check on the EP curve; a bug that reorders or
    // mis-indexes the return periods would trip it.
    forAll { (portfolio: PropertyPortfolio, dataset: Hurdat2Dataset, params: Params) =>
      val result = Hurdat2PropertyCatPricingYltSimulator.simulate(dataset, portfolio, params)
      val sorted = result.riskMetrics.oep.sortBy(_.returnPeriodYears)
      sorted.sliding(2).filter(_.size == 2).foreach { case Seq(a, b) =>
        assert(b.grossLoss >= a.grossLoss - 1e-6, s"OEP not monotone: RP ${a.returnPeriodYears}=${a.grossLoss} -> RP ${b.returnPeriodYears}=${b.grossLoss}")
      }
    }
  }
}
