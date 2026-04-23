package canopy.engine.property

import canopy.data.hurdat2._
import canopy.engine.property.support.GoldenCompare
import org.scalatest.funsuite.AnyFunSuite

import java.nio.file.{Path, Paths}
import java.time.{LocalDate, LocalTime}

import Hurdat2PropertyCatPricingYltSimulator._

/** Baseline golden files for the phase-1 pricing engine.
  *
  * These freeze the numerical output of simulate() at current defaults for
  * three canonical scenarios. Any change to the default PricingParameters,
  * the bootstrap sampler, the vulnerability curve, or the AEP derivation
  * will produce a diff that fails this test at rel tol 1e-9.
  *
  * Regenerate after an intentional numerical change by running:
  *
  *   CANOPY_GOLDEN_UPDATE=1 sbt "canopy-engine-property/testOnly canopy.engine.property.BaselineGoldenSpec"
  *
  * and committing the regenerated goldens alongside a GOLDEN_CHANGE.md note
  * in the PR description explaining the drift (direction, magnitude, why).
  */
class BaselineGoldenSpec extends AnyFunSuite {

  private val goldenDir: Path = {
    val cwd = Paths.get("").toAbsolutePath
    val candidates = Seq(
      cwd.resolve("src/test/resources/golden/baseline"),
      cwd.resolve("scala/canopy-engine-property/src/test/resources/golden/baseline")
    )
    candidates.find(java.nio.file.Files.isDirectory(_)).getOrElse(candidates.head)
  }

  private val commonParams = Params(
    simulatedYears = 200,
    returnPeriodsYears = Vector(10, 50, 100),
    yltRowLimit = 5,
    lossBasis = "net",
    includeGrossNetBreakout = true,
    includeSummaryPercentiles = true,
    currency = "USD",
    randomSeed = 42
  )

  private def trackPoint(
      lat: Double,
      lon: Double,
      windKt: Int,
      year: Int,
      hour: Int
  ): Hurdat2TrackPoint =
    Hurdat2TrackPoint(
      date = LocalDate.of(year, 9, 1),
      time = LocalTime.of(hour, 0),
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

  private def storm(year: Int, seq: Int, wind: Int): Hurdat2Storm =
    Hurdat2Storm(
      header = Hurdat2StormHeader(Hurdat2StormId(f"AL$seq%02d$year", "AL", seq, year), s"GOLD$seq", 3),
      track = Vector(
        // 6-hour-spaced fixes so translation-asymmetry has real dt to work
        // with. Track moves NNE at ~15 kt, typical of Gulf landfalls.
        trackPoint(28.0, -92.0, wind, year, hour = 0),
        trackPoint(29.5, -90.5, wind, year, hour = 6),
        trackPoint(31.0, -89.0, math.max(35, wind - 20), year, hour = 12)
      )
    )

  private val canonicalDataset: Hurdat2Dataset = Hurdat2Dataset(
    (1970 to 1980).zipWithIndex.map { case (y, idx) =>
      val winds = Vector(75, 95, 105, 115, 130, 85, 90, 100, 120, 110, 95)
      storm(y, idx + 1, winds(idx % winds.size))
    }.toVector
  )

  private def loc(
      id: String,
      lat: Double,
      lon: Double,
      tiv: Double,
      ded: Double,
      lim: Double,
      occupancy: String,
      perils: Vector[String]
  ): PropertyLocation =
    PropertyLocation(
      locationId = id,
      latitude = lat,
      longitude = lon,
      tiv = tiv,
      deductible = ded,
      limit = lim,
      occupancy = Some(occupancy),
      perilSet = perils,
      country = Some("US")
    )

  private val singleMiamiPortfolio = PropertyPortfolio(
    portfolioId = "pf_golden_miami",
    name = "Miami single-location baseline",
    currency = "USD",
    locations = Vector(loc("loc_mia1", 25.77, -80.19, 8_000_000d, 100_000d, 6_500_000d, "Residential", Vector("WIND")))
  )

  private val gulfThreePortfolio = PropertyPortfolio(
    portfolioId = "pf_golden_gulf3",
    name = "Gulf coast 3-location baseline",
    currency = "USD",
    locations = Vector(
      loc("loc_hou1", 29.74, -95.37, 15_000_000d, 250_000d, 12_000_000d, "Commercial", Vector("WIND", "HAIL")),
      loc("loc_nola1", 29.95, -90.07, 9_000_000d, 150_000d, 7_000_000d, "Industrial", Vector("WIND", "STORM_SURGE")),
      loc("loc_mia2", 25.77, -80.19, 8_000_000d, 100_000d, 6_500_000d, "Residential", Vector("WIND"))
    )
  )

  private val tenLocationPortfolio = PropertyPortfolio(
    portfolioId = "pf_golden_ten",
    name = "10-location baseline",
    currency = "USD",
    locations = (0 until 10).toVector.map { i =>
      loc(
        id = f"loc_ten${i + 1}%02d",
        lat = 25.0 + i * 0.5,
        lon = -97.0 + i * 2.0,
        tiv = 1_000_000d + i * 500_000d,
        ded = 25_000d + i * 5_000d,
        lim = 800_000d + i * 400_000d,
        occupancy = Vector("Residential", "Commercial", "Industrial", "Hospitality")(i % 4),
        perils = if (i % 3 == 0) Vector("WIND", "STORM_SURGE") else Vector("WIND")
      )
    }
  )

  private def resultToGoldenJson(r: Hurdat2PropertyCatPricingYltSimulator.Result): ujson.Value = {
    def rpPoint(p: ReturnPeriodPoint): ujson.Obj = ujson.Obj(
      "returnPeriodYears" -> ujson.Num(p.returnPeriodYears),
      "grossLoss" -> ujson.Num(p.grossLoss),
      "netLoss" -> ujson.Num(p.netLoss),
      "bondPayout" -> ujson.Num(p.bondPayout)
    )
    ujson.Obj(
      "portfolioId" -> ujson.Str(r.portfolio.portfolioId),
      "locationCount" -> ujson.Num(r.portfolioSummary.locationCount),
      "totalTiv" -> ujson.Num(r.portfolioSummary.totalTiv),
      "simulatedYears" -> ujson.Num(r.simulatedYears.size),
      "historicalYearsCount" -> ujson.Num(r.historicalYears.size),
      "riskMetrics" -> ujson.Obj(
        "currency" -> ujson.Str(r.riskMetrics.currency),
        "expectedLoss" -> ujson.Num(r.riskMetrics.expectedLoss),
        "expectedLossRate" -> ujson.Num(r.riskMetrics.expectedLossRate),
        "stdDevLoss" -> ujson.Num(r.riskMetrics.stdDevLoss),
        "attachmentProbability" -> ujson.Num(r.riskMetrics.attachmentProbability),
        "exhaustionProbability" -> ujson.Num(r.riskMetrics.exhaustionProbability),
        "var99" -> ujson.Num(r.riskMetrics.var99),
        "tvar99" -> ujson.Num(r.riskMetrics.tvar99),
        "oep" -> ujson.Arr.from(r.riskMetrics.oep.map(rpPoint)),
        "aep" -> ujson.Arr.from(r.riskMetrics.aep.map(rpPoint))
      ),
      "summaryStats" -> ujson.Obj(
        "p50Loss" -> ujson.Num(r.summaryStats.p50Loss),
        "p90Loss" -> ujson.Num(r.summaryStats.p90Loss),
        "p99Loss" -> ujson.Num(r.summaryStats.p99Loss),
        "maxLoss" -> ujson.Num(r.summaryStats.maxLoss)
      ),
      "firstFiveSimulatedYears" -> ujson.Arr.from(
        r.simulatedYears.take(5).map { y =>
          ujson.Obj(
            "yearIndex" -> ujson.Num(y.yearIndex),
            "sourceYear" -> ujson.Num(y.sourceYear),
            "eventCount" -> ujson.Num(y.eventCount),
            "grossLoss" -> ujson.Num(y.grossLoss),
            "cededLoss" -> ujson.Num(y.cededLoss),
            "netLoss" -> ujson.Num(y.netLoss)
          )
        }
      )
    )
  }

  private def checkGolden(name: String, portfolio: PropertyPortfolio): Unit = {
    val result = Hurdat2PropertyCatPricingYltSimulator.simulate(canonicalDataset, portfolio, commonParams)
    val actualJson = resultToGoldenJson(result)
    val goldenPath = goldenDir.resolve(s"$name.json")
    val expected = GoldenCompare.readOrUpdate(goldenPath, actualJson)
    val diffs = GoldenCompare.diff(actualJson, expected, GoldenCompare.Tolerance.default)
    assert(
      diffs.isEmpty,
      s"""Golden drift detected for $name at $goldenPath
         |  Re-run with CANOPY_GOLDEN_UPDATE=1 only after an intentional change.
         |Diffs:
         |${diffs.mkString("\n")}""".stripMargin
    )
  }

  test("golden: single-location Miami portfolio") {
    checkGolden("single-miami", singleMiamiPortfolio)
  }

  test("golden: 3-location Gulf coast portfolio") {
    checkGolden("gulf-three", gulfThreePortfolio)
  }

  test("golden: 10-location portfolio") {
    checkGolden("ten-location", tenLocationPortfolio)
  }
}
