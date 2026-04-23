package canopy.engine.property

import canopy.data.hurdat2.{Hurdat2Dataset, Hurdat2Storm}
import canopy.engine.property.financial.SiteTerms
import canopy.engine.property.hazard.Windfield
import canopy.engine.property.vulnerability.Vulnerability

import scala.util.Random

object Hurdat2PropertyCatPricingYltSimulator {

  /** Named numerical parameters used by the baseline pricing heuristics.
    *
    * These values were previously inline literals scattered through the
    * simulator. Extracting them into one place is a prerequisite for
    * property-level overrides, per-run calibration, and meaningful golden
    * diffs. Defaults reproduce the previous behavior exactly.
    *
    * Physical upgrades (Holland windfield, Hazus vulnerability curves,
    * real AEP vs. OEP derivation) land in phases 2 and 3; the fields here
    * are the surface they will replace.
    */
  final case class PricingParameters(
      // Hazard model selection. When true (default), the Holland (1980)
      // radial profile is used with Rmax either from HURDAT2 wind radii
      // (~35% of the 34-kt radius) or the V_max climatology below. When
      // false, the phase-1 exponential-decay fallback is used. Phase 2.3
      // replaces the climatology with Willoughby 2006.
      useHollandWindfield: Boolean = true,
      rmaxFromR34Factor: Double = 0.35d,
      rmaxClimatologyInterceptKm: Double = 45d,
      rmaxClimatologySlopeKmPerKt: Double = 0.2d,
      rmaxMinKm: Double = 15d,
      rmaxMaxKm: Double = 80d,
      // Legacy exponential-decay params (used when useHollandWindfield=false
      // or as a last-resort for storms missing central-pressure data).
      defaultWindRadiusKm: Double = 140d,
      minDecayScaleKm: Double = 60d,
      radiusToDecayScaleRatio: Double = 1.15d,
      nauticalMileKm: Double = 1.852d,
      // Vulnerability curve (single power curve; phase 2 replaces with Hazus).
      minDamagingWindKt: Double = 35d,
      saturationWindKt: Double = 130d,
      vulnerabilityExponent: Double = 2.25d,
      // Peril modifiers.
      perilFactorStormSurge: Double = 1.08d,
      perilFactorWind: Double = 1d,
      perilFactorOther: Double = 0.7d,
      // Occupancy modifiers.
      occupancyFactorIndustrial: Double = 1.10d,
      occupancyFactorHospitality: Double = 1.05d,
      occupancyFactorResidential: Double = 0.95d,
      occupancyFactorCommercial: Double = 1.00d,
      occupancyFactorDefault: Double = 1.00d,
      // Risk-metric quantile choices.
      var99Quantile: Double = 0.99d,
      exhaustionQuantile: Double = 0.95d,
      // AEP curve scale relative to OEP. Phase 3 replaces this with a real
      // aggregate-loss derivation from a stochastic catalog.
      aepScale: Double = 0.94d
  )

  object PricingParameters {
    val default: PricingParameters = PricingParameters()
  }

  final case class Params(
      simulatedYears: Int,
      returnPeriodsYears: Vector[Int],
      yltRowLimit: Int,
      lossBasis: String,
      includeGrossNetBreakout: Boolean,
      includeSummaryPercentiles: Boolean,
      currency: String,
      randomSeed: Int,
      pricingParameters: PricingParameters = PricingParameters.default
  ) {
    val normalizedSimulatedYears: Int =
      if (simulatedYears <= 0) 1000 else simulatedYears

    val normalizedReturnPeriodsYears: Vector[Int] =
      uniquePositiveInts(returnPeriodsYears, Vector(10, 20, 50, 100))

    val normalizedYltRowLimit: Int =
      if (yltRowLimit <= 0) 25 else yltRowLimit

    val normalizedLossBasis: String =
      Option(lossBasis).map(_.trim.toLowerCase).filter(v => v == "gross" || v == "net" || v == "ceded").getOrElse("net")

    val normalizedCurrency: String =
      Option(currency).map(_.trim.toUpperCase).filter(_.matches("^[A-Z]{3}$")).getOrElse("USD")
  }

  final case class PropertyLocation(
      locationId: String,
      latitude: Double,
      longitude: Double,
      tiv: Double,
      deductible: Double,
      limit: Double,
      occupancy: Option[String],
      perilSet: Vector[String],
      country: Option[String]
  )

  final case class PropertyPortfolio(
      portfolioId: String,
      name: String,
      currency: String,
      locations: Vector[PropertyLocation]
  )

  final case class EventLoss(
      stormId: String,
      stormName: String,
      sourceYear: Int,
      eventCountContribution: Int,
      grossLoss: Double,
      cededLoss: Double,
      netLoss: Double,
      peakStormWindKt: Int,
      peakSiteWindKt: Double
  )

  final case class HistoricalYearLoss(
      sourceYear: Int,
      eventCount: Int,
      grossLoss: Double,
      cededLoss: Double,
      netLoss: Double,
      events: Vector[EventLoss]
  )

  final case class SimulatedYearLoss(
      yearIndex: Int,
      sourceYear: Int,
      eventCount: Int,
      grossLoss: Double,
      cededLoss: Double,
      netLoss: Double
  )

  final case class ReturnPeriodPoint(
      returnPeriodYears: Int,
      grossLoss: Double,
      netLoss: Double,
      bondPayout: Double
  )

  final case class RiskMetrics(
      currency: String,
      expectedLoss: Double,
      expectedLossRate: Double,
      stdDevLoss: Double,
      attachmentProbability: Double,
      exhaustionProbability: Double,
      var99: Double,
      tvar99: Double,
      oep: Vector[ReturnPeriodPoint],
      aep: Vector[ReturnPeriodPoint]
  )

  final case class SummaryStats(
      p50Loss: Double,
      p90Loss: Double,
      p99Loss: Double,
      maxLoss: Double
  )

  final case class PortfolioSummary(
      locationCount: Int,
      totalTiv: Double,
      countries: Vector[String],
      perils: Vector[String]
  )

  final case class Result(
      params: Params,
      portfolio: PropertyPortfolio,
      portfolioSummary: PortfolioSummary,
      historicalYears: Vector[HistoricalYearLoss],
      simulatedYears: Vector[SimulatedYearLoss],
      riskMetrics: RiskMetrics,
      summaryStats: SummaryStats
  )

  def simulate(
      dataset: Hurdat2Dataset,
      portfolio: PropertyPortfolio,
      rawParams: Params,
      onProgress: Double => Unit = _ => ()
  ): Result = {
    val params = rawParams
    val normalizedPortfolio = normalizePortfolio(portfolio, params.normalizedCurrency)
    val historicalYears = buildHistoricalYears(dataset, normalizedPortfolio, params, onProgress)
    val simulatedYears = simulateYears(historicalYears, params)
    val riskMetrics = computeRiskMetrics(simulatedYears, normalizedPortfolio, params)
    val summaryStats = computeSummaryStats(simulatedYears, params)

    Result(
      params = params,
      portfolio = normalizedPortfolio,
      portfolioSummary = summarizePortfolio(normalizedPortfolio),
      historicalYears = historicalYears,
      simulatedYears = simulatedYears,
      riskMetrics = riskMetrics,
      summaryStats = summaryStats
    )
  }

  private def normalizePortfolio(portfolio: PropertyPortfolio, fallbackCurrency: String): PropertyPortfolio = {
    val normalizedLocations =
      portfolio.locations
        .filter(loc =>
          loc.tiv > 0d &&
            loc.latitude >= -90d && loc.latitude <= 90d &&
            loc.longitude >= -180d && loc.longitude <= 180d
        )
        .map { loc =>
          loc.copy(
            deductible = math.max(0d, loc.deductible),
            limit = math.max(0d, if (loc.limit > 0d) loc.limit else loc.tiv),
            perilSet = loc.perilSet.map(_.trim.toUpperCase).filter(_.nonEmpty).distinct
          )
        }

    if (normalizedLocations.isEmpty) {
      throw new IllegalArgumentException(
        s"Property portfolio ${portfolio.portfolioId} has no locations that pass validation " +
          "(tiv > 0 and latitude/longitude in range). Refusing to fabricate a fallback location: " +
          "an empty portfolio must fail visibly rather than silently price against synthetic exposure."
      )
    }

    portfolio.copy(
      currency =
        Option(portfolio.currency).map(_.trim.toUpperCase).filter(_.matches("^[A-Z]{3}$")).getOrElse(fallbackCurrency),
      locations = normalizedLocations
    )
  }

  private def summarizePortfolio(portfolio: PropertyPortfolio): PortfolioSummary = {
    val countries =
      portfolio.locations.flatMap(_.country.map(_.trim.toUpperCase)).filter(_.nonEmpty).distinct.sorted
    val perils =
      portfolio.locations.flatMap(_.perilSet.map(_.trim.toUpperCase)).filter(_.nonEmpty).distinct.sorted

    PortfolioSummary(
      locationCount = portfolio.locations.size,
      totalTiv = portfolio.locations.iterator.map(_.tiv).sum,
      countries = countries,
      perils = perils
    )
  }

  private def buildHistoricalYears(
      dataset: Hurdat2Dataset,
      portfolio: PropertyPortfolio,
      params: Params,
      onProgress: Double => Unit
  ): Vector[HistoricalYearLoss] = {
    val years = contiguousYears(dataset)
    val stormsByYear = dataset.stormsByYear.withDefaultValue(Vector.empty)

    val total = years.size.max(1)
    val rows = years.zipWithIndex.map { case (year, idx) =>
      val eventLosses =
        stormsByYear(year)
          .flatMap(storm => stormLoss(storm, portfolio, params))
          .sortBy(event => (event.stormId, event.stormName))

      val row = HistoricalYearLoss(
        sourceYear = year,
        eventCount = eventLosses.iterator.map(_.eventCountContribution).sum,
        grossLoss = eventLosses.iterator.map(_.grossLoss).sum,
        cededLoss = eventLosses.iterator.map(_.cededLoss).sum,
        netLoss = eventLosses.iterator.map(_.netLoss).sum,
        events = eventLosses
      )
      onProgress((idx + 1).toDouble / total.toDouble)
      row
    }

    if (rows.nonEmpty) rows
    else {
      Vector(
        HistoricalYearLoss(
          sourceYear = 0,
          eventCount = 0,
          grossLoss = 0d,
          cededLoss = 0d,
          netLoss = 0d,
          events = Vector.empty
        )
      )
    }
  }

  private def simulateYears(historicalYears: Vector[HistoricalYearLoss], params: Params): Vector[SimulatedYearLoss] = {
    val rng = new Random(params.randomSeed.toLong)
    Vector.tabulate(params.normalizedSimulatedYears) { idx =>
      val source = historicalYears(rng.nextInt(historicalYears.size))
      SimulatedYearLoss(
        yearIndex = idx + 1,
        sourceYear = source.sourceYear,
        eventCount = source.eventCount,
        grossLoss = source.grossLoss,
        cededLoss = source.cededLoss,
        netLoss = source.netLoss
      )
    }
  }

  private def computeRiskMetrics(
      simulatedYears: Vector[SimulatedYearLoss],
      portfolio: PropertyPortfolio,
      params: Params
  ): RiskMetrics = {
    val gross = simulatedYears.map(_.grossLoss)
    val net = simulatedYears.map(_.netLoss)
    val ceded = simulatedYears.map(_.cededLoss)
    val basis = basisLosses(simulatedYears, params)
    val n = simulatedYears.size.max(1)

    val expectedLoss = basis.sum / n.toDouble
    val exposureBase = portfolio.locations.iterator.map(_.tiv).sum.max(1d)
    val expectedLossRate = expectedLoss / exposureBase
    val variance = basis.iterator.map(v => math.pow(v - expectedLoss, 2d)).sum / n.toDouble
    val stdDevLoss = math.sqrt(variance)
    val attachmentProbability = basis.count(_ > 0d).toDouble / n.toDouble

    val pp = params.pricingParameters
    val sortedBasis = basis.sorted
    val var99 = quantile(sortedBasis, pp.var99Quantile)
    val tvar99 = {
      val tail = sortedBasis.filter(_ >= var99)
      if (tail.isEmpty) var99 else tail.sum / tail.size.toDouble
    }
    val exhaustionThreshold = quantile(sortedBasis, pp.exhaustionQuantile)
    val exhaustionProbability =
      if (exhaustionThreshold <= 0d) 0d else basis.count(_ >= exhaustionThreshold).toDouble / n.toDouble

    def curvePoints(
        grossSeries: Vector[Double],
        netSeries: Vector[Double],
        cededSeries: Vector[Double],
        scale: Double
    ): Vector[ReturnPeriodPoint] = {
      val sg = grossSeries.map(_ * scale).sorted
      val sn = netSeries.map(_ * scale).sorted
      val sc = cededSeries.map(_ * scale).sorted
      params.normalizedReturnPeriodsYears.map { rp =>
        val p = 1d - (1d / rp.toDouble.max(1d))
        ReturnPeriodPoint(
          returnPeriodYears = rp,
          grossLoss = quantile(sg, p),
          netLoss = quantile(sn, p),
          bondPayout = quantile(sc, p)
        )
      }
    }

    RiskMetrics(
      currency = params.normalizedCurrency,
      expectedLoss = expectedLoss,
      expectedLossRate = expectedLossRate,
      stdDevLoss = stdDevLoss,
      attachmentProbability = attachmentProbability,
      exhaustionProbability = exhaustionProbability,
      var99 = var99,
      tvar99 = tvar99,
      oep = curvePoints(gross, net, ceded, 1d),
      aep = curvePoints(gross, net, ceded, pp.aepScale)
    )
  }

  private def computeSummaryStats(simulatedYears: Vector[SimulatedYearLoss], params: Params): SummaryStats = {
    val basis = basisLosses(simulatedYears, params).sorted
    SummaryStats(
      p50Loss = quantile(basis, 0.50d),
      p90Loss = quantile(basis, 0.90d),
      p99Loss = quantile(basis, 0.99d),
      maxLoss = basis.lastOption.getOrElse(0d)
    )
  }

  private def basisLosses(rows: Vector[SimulatedYearLoss], params: Params): Vector[Double] =
    SiteTerms.basisLosses(rows, params.normalizedLossBasis)

  private def stormLoss(
      storm: Hurdat2Storm,
      portfolio: PropertyPortfolio,
      params: Params
  ): Option[EventLoss] = {
    val peakStormWind = storm.maxWindKt.getOrElse(0)
    if (peakStormWind <= 0) return None

    val pp = params.pricingParameters
    val losses = portfolio.locations.map { loc =>
      val siteWind = Windfield.maxSiteWindKt(storm.track, loc, pp)
      val groundUp = Vulnerability.modeledGroundUpLoss(loc, siteWind, pp)
      val insured = SiteTerms.modeledInsuredLoss(loc, groundUp)
      val ceded = math.max(0d, groundUp - insured)
      (siteWind, groundUp, ceded, insured)
    }

    val peakSiteWind = losses.iterator.map(_._1).foldLeft(0d)(_ max _)
    val grossLoss = losses.iterator.map(_._2).sum
    val cededLoss = losses.iterator.map(_._3).sum
    val netLoss = losses.iterator.map(_._4).sum
    val basis = SiteTerms.selectedBasisValue(params.normalizedLossBasis, grossLoss, cededLoss, netLoss)
    if (basis <= 0d) {
      None
    } else {
      Some(
        EventLoss(
          stormId = storm.header.id.raw,
          stormName = storm.header.name,
          sourceYear = storm.year,
          eventCountContribution = 1,
          grossLoss = grossLoss,
          cededLoss = cededLoss,
          netLoss = netLoss,
          peakStormWindKt = peakStormWind,
          peakSiteWindKt = peakSiteWind
        )
      )
    }
  }

  private def contiguousYears(dataset: Hurdat2Dataset): Vector[Int] = {
    dataset.years match {
      case Vector() => Vector.empty
      case years    => (years.min to years.max).toVector
    }
  }

  private def quantile(sorted: Vector[Double], p: Double): Double = {
    if (sorted.isEmpty) return 0d
    val clamped = clamp01(p)
    val pos = clamped * (sorted.size - 1).toDouble
    val lo = pos.toInt
    val hi = math.min(sorted.size - 1, lo + 1)
    val frac = pos - lo.toDouble
    if (hi == lo) sorted(lo)
    else sorted(lo) * (1d - frac) + sorted(hi) * frac
  }

  private def uniquePositiveInts(values: Vector[Int], fallback: Vector[Int]): Vector[Int] = {
    val source = if (values.exists(_ > 0)) values else fallback
    source.filter(_ > 0).distinct.sorted
  }

  private def clamp01(value: Double): Double = math.max(0d, math.min(1d, value))
}

