package canopy.engine.portfolio

import scala.util.Random

object MarginalPortfolioImpactSimulator {
  final case class Params(
      baselinePortfolioId: String,
      candidateDealName: String,
      candidateDealLimit: Double,
      candidateParticipationPct: Double,
      tailCurve: String,
      tailMetric: String,
      tailReturnPeriodYears: Int,
      returnPeriodsYears: Vector[Int],
      includeTailRiskComparison: Boolean,
      currency: String,
      randomSeed: Int
  ) {
    val normalizedBaselinePortfolioId: String =
      Option(baselinePortfolioId).map(_.trim).filter(_.nonEmpty).getOrElse("pf_demo001")

    val normalizedCandidateDealName: String =
      Option(candidateDealName).map(_.trim).filter(_.nonEmpty).getOrElse("Candidate Deal")

    val normalizedCandidateDealLimit: Double =
      if (candidateDealLimit > 0d) candidateDealLimit else 5000000d

    val normalizedCandidateParticipationPct: Double = {
      val raw =
        if (candidateParticipationPct > 1.5d) candidateParticipationPct / 100d
        else candidateParticipationPct
      clamp01(raw)
    }

    val normalizedTailCurve: String =
      Option(tailCurve).map(_.trim.toLowerCase).filter(v => v == "oep" || v == "aep").getOrElse("oep")

    val normalizedTailMetric: String =
      Option(tailMetric).map(_.trim.toLowerCase).filter(v => v == "var" || v == "tvar").getOrElse("var")

    val normalizedTailReturnPeriodYears: Int =
      if (tailReturnPeriodYears <= 0) 100 else tailReturnPeriodYears

    val normalizedReturnPeriodsYears: Vector[Int] =
      uniquePositiveInts(returnPeriodsYears :+ normalizedTailReturnPeriodYears, Vector(10, 20, 50, 100))

    val normalizedCurrency: String =
      Option(currency).map(_.trim.toUpperCase).filter(_.matches("^[A-Z]{3}$")).getOrElse("USD")
  }

  final case class ExposureLocation(
      locationId: String,
      tiv: Double,
      deductible: Double,
      limit: Double,
      country: String,
      perils: Vector[String]
  )

  final case class CandidateTerms(
      notional: Double,
      attachmentPoint: Double,
      exhaustionPoint: Double,
      expectedLossBps: Option[Double],
      couponSpreadBps: Option[Double],
      modeledShare: Option[Double],
      triggerType: Option[String]
  )

  final case class PortfolioSummary(
      portfolioId: String,
      locationCount: Int,
      totalTiv: Double,
      averageDeductibleRatio: Double,
      averageLimitRatio: Double,
      countryCount: Int,
      perilCount: Int
  )

  final case class YearOutcome(
      yearIndex: Int,
      eventCount: Int,
      aggregateGrossLoss: Double,
      aggregateCededLoss: Double,
      aggregateNetLoss: Double,
      bondExhausted: Boolean
  )

  final case class TailRiskComparisonRow(
      returnPeriodYears: Int,
      metric: String,
      before: Double,
      after: Double,
      delta: Double,
      deltaPct: Double
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

  final case class Result(
      params: Params,
      portfolioSummary: PortfolioSummary,
      candidateTerms: CandidateTerms,
      yearOutcomes: Vector[YearOutcome],
      riskMetrics: RiskMetrics,
      comparisonRows: Vector[TailRiskComparisonRow]
  )

  final case class ModelInput(
      params: Params,
      portfolioSummary: PortfolioSummary,
      candidateTerms: CandidateTerms
  )

  def simulate(input: ModelInput): Result = {
    val params = input.params
    val summary = input.portfolioSummary
    val terms = input.candidateTerms
    val rng = new Random(params.randomSeed.toLong)

    val expectedLossRate =
      estimateExpectedLossRate(params, summary, terms)
    val expectedLoss = math.max(10000d, params.normalizedCandidateDealLimit * expectedLossRate)

    val yearCount = 12
    val yearOutcomes = Vector.tabulate(yearCount) { index =>
      val eventRate =
        0.9d + summary.perilCount * 0.08d + summary.countryCount * 0.03d + params.normalizedCandidateParticipationPct * 0.4d
      val eventCount = sampleEventCount(rng, eventRate)

      val severityScale =
        1d +
          (summary.averageLimitRatio * 0.22d) -
          (summary.averageDeductibleRatio * 0.35d) +
          optionOr(terms.modeledShare, 0.5d) * 0.12d

      val annualNoise = 0.55d + rng.nextDouble() * 1.35d
      val eventMultiplier =
        if (eventCount <= 0) 0d else 0.55d + eventCount.toDouble * (0.45d + rng.nextDouble() * 0.35d)

      val grossLoss = math.max(0d, expectedLoss * 2.2d * severityScale * annualNoise * eventMultiplier)

      val cessionShare =
        clamp01(
          0.12d +
            params.normalizedCandidateParticipationPct * 0.22d +
            optionOr(terms.modeledShare, 0.5d) * 0.08d +
            rng.nextDouble() * 0.08d
        )

      val grossCeded = grossLoss * cessionShare
      val aggregateCededLoss = math.min(params.normalizedCandidateDealLimit, grossCeded)
      val aggregateNetLoss = math.max(0d, grossLoss - aggregateCededLoss)

      YearOutcome(
        yearIndex = index + 1,
        eventCount = eventCount,
        aggregateGrossLoss = grossLoss,
        aggregateCededLoss = aggregateCededLoss,
        aggregateNetLoss = aggregateNetLoss,
        bondExhausted = aggregateCededLoss >= params.normalizedCandidateDealLimit - 1e-6
      )
    }

    val riskMetrics = computeRiskMetrics(params, yearOutcomes)
    val comparisonRows = buildComparisonRows(params, summary, terms)

    Result(
      params = params,
      portfolioSummary = summary,
      candidateTerms = terms,
      yearOutcomes = yearOutcomes,
      riskMetrics = riskMetrics,
      comparisonRows = comparisonRows
    )
  }

  def portfolioSummaryFromLocations(
      portfolioId: String,
      locations: Vector[ExposureLocation]
  ): PortfolioSummary = {
    val normalizedLocations = locations.filter(loc => loc.tiv >= 0d)
    val totalTiv = normalizedLocations.iterator.map(_.tiv).sum
    val ratios =
      normalizedLocations.iterator
        .filter(_.tiv > 0d)
        .map { loc =>
          val deductibleRatio = clamp01(loc.deductible / loc.tiv)
          val limitRatio = if (loc.limit <= 0d) 1d else clamp01(loc.limit / loc.tiv)
          (deductibleRatio, limitRatio)
        }
        .toVector

    val avgDeductibleRatio =
      if (ratios.isEmpty) 0.02d else ratios.iterator.map(_._1).sum / ratios.size.toDouble
    val avgLimitRatio =
      if (ratios.isEmpty) 0.85d else ratios.iterator.map(_._2).sum / ratios.size.toDouble

    val countryCount = normalizedLocations.map(_.country.trim.toUpperCase).filter(_.nonEmpty).distinct.size.max(1)
    val perilCount =
      normalizedLocations.flatMap(_.perils.map(_.trim.toUpperCase)).filter(_.nonEmpty).distinct.size.max(1)

    PortfolioSummary(
      portfolioId = Option(portfolioId).map(_.trim).filter(_.nonEmpty).getOrElse("pf_demo001"),
      locationCount = normalizedLocations.size,
      totalTiv = if (totalTiv > 0d) totalTiv else 250000000d,
      averageDeductibleRatio = avgDeductibleRatio,
      averageLimitRatio = avgLimitRatio,
      countryCount = countryCount,
      perilCount = perilCount
    )
  }

  private def estimateExpectedLossRate(
      params: Params,
      summary: PortfolioSummary,
      terms: CandidateTerms
  ): Double = {
    val fromTerms =
      terms.expectedLossBps.map(_ / 10000d).filter(_ > 0d)

    val fallback = {
      val exposureScale = math.log10(summary.totalTiv.max(1d)) / 12d
      val diversificationRelief = math.min(0.12d, (summary.countryCount - 1) * 0.008d + (summary.perilCount - 1) * 0.006d)
      val retentionLift = (1d - summary.averageDeductibleRatio * 0.7d).max(0.75d)
      val coverageLift = 0.85d + summary.averageLimitRatio * 0.25d
      val modeledLift = 0.9d + optionOr(terms.modeledShare, 0.5d) * 0.2d
      val triggerLift =
        terms.triggerType.map(_.trim.toLowerCase) match {
          case Some("parametric")    => 0.92d
          case Some("modeled-loss")  => 1.03d
          case Some("industry-loss") => 0.98d
          case _                     => 1d
        }

      (0.018d + exposureScale * 0.02d + params.normalizedCandidateParticipationPct * 0.014d) *
        retentionLift *
        coverageLift *
        modeledLift *
        triggerLift *
        (1d - diversificationRelief)
    }

    clampRange(fromTerms.getOrElse(fallback), 0.005d, 0.25d)
  }

  private def buildComparisonRows(
      params: Params,
      summary: PortfolioSummary,
      terms: CandidateTerms
  ): Vector[TailRiskComparisonRow] = {
    val metricLabel = s"${params.normalizedTailCurve.toUpperCase} ${params.normalizedTailMetric.toUpperCase}"
    val tailSlope =
      if (params.normalizedTailMetric == "tvar") 1.18d else 1d
    val curveSlope =
      if (params.normalizedTailCurve == "aep") 0.96d else 1.03d

    params.normalizedReturnPeriodsYears.zipWithIndex.map { case (rp, idx) =>
      val baselineScale =
        (0.0018d * summary.totalTiv) *
          (1d + math.log(rp.toDouble.max(1d)) / 6d) *
          curveSlope *
          (1d + (summary.perilCount - 1) * 0.02d) *
          (1d - math.min(0.2d, (summary.countryCount - 1) * 0.015d))

      val before =
        math.max(1000d, baselineScale * (1d + idx * 0.08d))

      val incremental =
        (params.normalizedCandidateDealLimit * (0.05d + params.normalizedCandidateParticipationPct * 0.12d)) *
          tailSlope *
          (1d + idx * 0.16d) *
          (0.9d + optionOr(terms.modeledShare, 0.5d) * 0.18d)

      val after = before + incremental
      val delta = after - before

      TailRiskComparisonRow(
        returnPeriodYears = rp,
        metric = metricLabel,
        before = before,
        after = after,
        delta = delta,
        deltaPct = if (before <= 0d) 0d else delta / before
      )
    }
  }

  private def computeRiskMetrics(params: Params, years: Vector[YearOutcome]): RiskMetrics = {
    val ceded = years.map(_.aggregateCededLoss)
    val gross = years.map(_.aggregateGrossLoss)
    val net = years.map(_.aggregateNetLoss)
    val n = years.size.max(1)

    val expectedLoss = ceded.sum / n.toDouble
    val expectedLossRate = expectedLoss / params.normalizedCandidateDealLimit.max(1d)
    val attachmentProbability = ceded.count(_ > 0d).toDouble / n.toDouble
    val exhaustionProbability = years.count(_.bondExhausted).toDouble / n.toDouble
    val variance = ceded.iterator.map(x => math.pow(x - expectedLoss, 2d)).sum / n.toDouble
    val stdDevLoss = math.sqrt(variance)
    val sortedCeded = ceded.sorted
    val var99 = quantile(sortedCeded, 0.99d)
    val tvar99 = {
      val tail = sortedCeded.filter(_ >= var99)
      if (tail.isEmpty) var99 else tail.sum / tail.size.toDouble
    }

    def curveFrom(sample: Vector[Double], payout: Vector[Double]): Vector[ReturnPeriodPoint] = {
      val sortedSample = sample.sorted
      val sortedNet = net.sorted
      val sortedPayout = payout.sorted
      params.normalizedReturnPeriodsYears.map { rp =>
        val p = 1d - (1d / rp.toDouble.max(1d))
        ReturnPeriodPoint(
          returnPeriodYears = rp,
          grossLoss = quantile(sortedSample, p),
          netLoss = quantile(sortedNet, p),
          bondPayout = quantile(sortedPayout, p)
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
      oep = curveFrom(gross, ceded),
      aep = curveFrom(gross.map(_ * 0.95d), ceded.map(_ * 0.93d))
    )
  }

  private def sampleEventCount(rng: Random, mean: Double): Int = {
    val lambda = mean.max(0.05d)
    val base = lambda.toInt
    val fractional = lambda - base.toDouble
    val fractionalHit = if (rng.nextDouble() < fractional) 1 else 0
    val swing = if (rng.nextDouble() < 0.18d) 1 else 0
    (base + fractionalHit + swing).max(0)
  }

  private def quantile(sorted: Vector[Double], p: Double): Double = {
    if (sorted.isEmpty) return 0d
    val clamped = clamp01(p)
    val position = clamped * (sorted.size - 1).toDouble
    val lower = position.toInt
    val upper = math.min(sorted.size - 1, lower + 1)
    val fraction = position - lower.toDouble
    if (upper == lower) sorted(lower)
    else sorted(lower) * (1d - fraction) + sorted(upper) * fraction
  }

  private def uniquePositiveInts(values: Vector[Int], fallback: Vector[Int]): Vector[Int] = {
    val source = if (values.exists(_ > 0)) values else fallback
    source.filter(_ > 0).distinct.sorted
  }

  private def clamp01(value: Double): Double =
    math.max(0d, math.min(1d, value))

  private def clampRange(value: Double, min: Double, max: Double): Double =
    math.max(min, math.min(max, value))

  private def optionOr(value: Option[Double], fallback: Double): Double =
    value.getOrElse(fallback)
}

