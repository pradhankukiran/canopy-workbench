package canopy.engine.trigger

import canopy.data.hurdat2.{Hurdat2Dataset, Hurdat2Storm, Hurdat2TrackPoint}

import scala.util.Random

object Hurdat2IlsParametricTriggerSimulator {
  final case class Params(
      triggerIndexName: String,
      regionCode: String,
      perilCode: String,
      attachmentThreshold: Double,
      exhaustionThreshold: Double,
      payoutCurve: String,
      simulationCount: Int,
      includeEventLevelOutcomes: Boolean,
      notional: Double,
      currency: String,
      randomSeed: Int
  ) {
    val normalizedPayoutCurve: String =
      normalizePayoutCurve(payoutCurve)

    val normalizedAttachmentThreshold: Double = attachmentThreshold

    val normalizedExhaustionThreshold: Double =
      if (exhaustionThreshold <= attachmentThreshold) attachmentThreshold + 1.0 else exhaustionThreshold

    val normalizedSimulationCount: Int =
      if (simulationCount <= 0) 1 else simulationCount

    val normalizedNotional: Double =
      if (notional <= 0d) 1d else notional

    val normalizedCurrency: String =
      Option(currency).map(_.trim.toUpperCase).filter(_.matches("^[A-Z]{3}$")).getOrElse("USD")
  }

  final case class StormTriggerEvent(
      stormId: String,
      stormName: String,
      basin: String,
      sourceYear: Int,
      trackDate: String,
      trackTime: String,
      status: String,
      latitude: Double,
      longitude: Double,
      maxWindKt: Int,
      payoutPct: Double,
      payoutAmount: Double,
      triggered: Boolean,
      exhausted: Boolean
  )

  final case class HistoricalYearSummary(
      sourceYear: Int,
      eventCount: Int,
      triggeredEventCount: Int,
      annualMaxWindKt: Int,
      annualPayoutAmount: Double,
      annualPayoutPct: Double,
      triggered: Boolean,
      exhausted: Boolean,
      events: Vector[StormTriggerEvent]
  )

  final case class SimulatedYearOutcome(
      yearIndex: Int,
      sourceYear: Int,
      eventCount: Int,
      triggeredEventCount: Int,
      annualMaxWindKt: Int,
      payoutPct: Double,
      payoutAmount: Double,
      triggered: Boolean,
      exhausted: Boolean,
      sourceEvents: Vector[StormTriggerEvent]
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
      historicalYearCount: Int,
      availableYears: Vector[Int],
      historicalYears: Vector[HistoricalYearSummary],
      simulatedYears: Vector[SimulatedYearOutcome],
      historicalEvents: Vector[StormTriggerEvent],
      riskMetrics: RiskMetrics
  ) {
    lazy val annualTriggerProbability: Double = riskMetrics.attachmentProbability
    lazy val annualExhaustionProbability: Double = riskMetrics.exhaustionProbability
    lazy val expectedPayout: Double = riskMetrics.expectedLoss
  }

  def simulate(dataset: Hurdat2Dataset, rawParams: Params): Result = {
    val params = rawParams
    val region = TriggerRegion.fromCode(params.regionCode)
    val peril = PerilFilter.fromCode(params.perilCode)

    val historicalEvents =
      dataset.storms
        .flatMap(storm => stormToTriggerEvent(storm, params, region, peril))
        .sortBy(event => (event.sourceYear, event.stormId, event.trackDate, event.trackTime))

    val availableYears = dataset.years
    val eventsByYear = historicalEvents.groupBy(_.sourceYear).view.mapValues(_.toVector).toMap

    val historicalYears =
      availableYears.map { year =>
        val yearEvents = eventsByYear.getOrElse(year, Vector.empty).sortBy(event => (-event.maxWindKt, event.stormId))
        val triggeredEventCount = yearEvents.count(_.triggered)
        val payoutSum = yearEvents.iterator.map(_.payoutAmount).sum
        val annualPayout = math.min(params.normalizedNotional, payoutSum)
        val annualPayoutPct = clamp01(annualPayout / params.normalizedNotional)
        val annualMaxWind = yearEvents.map(_.maxWindKt).reduceOption(_ max _).getOrElse(0)
        HistoricalYearSummary(
          sourceYear = year,
          eventCount = yearEvents.size,
          triggeredEventCount = triggeredEventCount,
          annualMaxWindKt = annualMaxWind,
          annualPayoutAmount = annualPayout,
          annualPayoutPct = annualPayoutPct,
          triggered = annualPayout > 0d,
          exhausted = annualPayout >= (params.normalizedNotional - 1e-9),
          events = yearEvents
        )
      }

    val seed = params.randomSeed.toLong
    val rng = new Random(seed)
    val sampleBase =
      if (historicalYears.nonEmpty) historicalYears
      else {
        Vector(
          HistoricalYearSummary(
            sourceYear = 0,
            eventCount = 0,
            triggeredEventCount = 0,
            annualMaxWindKt = 0,
            annualPayoutAmount = 0d,
            annualPayoutPct = 0d,
            triggered = false,
            exhausted = false,
            events = Vector.empty
          )
        )
      }

    val simulatedYears = Vector.tabulate(params.normalizedSimulationCount) { idx =>
      val source = sampleBase(rng.nextInt(sampleBase.size))
      SimulatedYearOutcome(
        yearIndex = idx + 1,
        sourceYear = source.sourceYear,
        eventCount = source.eventCount,
        triggeredEventCount = source.triggeredEventCount,
        annualMaxWindKt = source.annualMaxWindKt,
        payoutPct = source.annualPayoutPct,
        payoutAmount = source.annualPayoutAmount,
        triggered = source.triggered,
        exhausted = source.exhausted,
        sourceEvents = if (params.includeEventLevelOutcomes) source.events else Vector.empty
      )
    }

    val riskMetrics = computeRiskMetrics(simulatedYears, params)

    Result(
      params = params,
      historicalYearCount = historicalYears.size,
      availableYears = availableYears,
      historicalYears = historicalYears,
      simulatedYears = simulatedYears,
      historicalEvents = if (params.includeEventLevelOutcomes) historicalEvents else Vector.empty,
      riskMetrics = riskMetrics
    )
  }

  private def stormToTriggerEvent(
      storm: Hurdat2Storm,
      params: Params,
      region: TriggerRegion,
      peril: PerilFilter
  ): Option[StormTriggerEvent] = {
    val filteredPoints =
      storm.track.filter(point => region.matches(point.latitude, point.longitude) && peril.matches(point.status))

    filteredPoints.maxByOption(_.maxWindKt).map { peak =>
      val payoutPct =
        payoutFraction(
          indexValue = peak.maxWindKt.toDouble,
          attachment = params.normalizedAttachmentThreshold,
          exhaustion = params.normalizedExhaustionThreshold,
          payoutCurve = params.normalizedPayoutCurve
        )

      val payoutAmount = params.normalizedNotional * payoutPct

      StormTriggerEvent(
        stormId = storm.header.id.raw,
        stormName = storm.header.name,
        basin = storm.header.id.basin,
        sourceYear = storm.year,
        trackDate = peak.date.toString,
        trackTime = peak.time.toString,
        status = peak.status,
        latitude = peak.latitude,
        longitude = peak.longitude,
        maxWindKt = peak.maxWindKt,
        payoutPct = payoutPct,
        payoutAmount = payoutAmount,
        triggered = payoutPct > 0d,
        exhausted = payoutPct >= 1d - 1e-9
      )
    }
  }

  private def computeRiskMetrics(simulatedYears: Vector[SimulatedYearOutcome], params: Params): RiskMetrics = {
    val payouts = simulatedYears.map(_.payoutAmount)
    val n = payouts.size.max(1)
    val expectedLoss = payouts.sum / n.toDouble
    val expectedLossRate = expectedLoss / params.normalizedNotional
    val attachmentProbability = payouts.count(_ > 0d).toDouble / n.toDouble
    val exhaustionProbability = payouts.count(_ >= params.normalizedNotional - 1e-9).toDouble / n.toDouble
    val variance =
      payouts.iterator.map(x => math.pow(x - expectedLoss, 2d)).sum / n.toDouble
    val stdDevLoss = math.sqrt(variance)

    val sorted = payouts.sorted
    val var99 = quantile(sorted, 0.99)
    val tvar99 = {
      val tail = sorted.filter(_ >= var99)
      if (tail.isEmpty) var99 else tail.sum / tail.size.toDouble
    }

    val returnPeriods = Vector(2, 5, 10, 20, 50, 100)
    val curvePoints = returnPeriods.map { rp =>
      val q = quantile(sorted, 1d - (1d / rp.toDouble))
      ReturnPeriodPoint(
        returnPeriodYears = rp,
        grossLoss = q,
        netLoss = q,
        bondPayout = q
      )
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
      oep = curvePoints,
      aep = curvePoints
    )
  }

  private def payoutFraction(
      indexValue: Double,
      attachment: Double,
      exhaustion: Double,
      payoutCurve: String
  ): Double = {
    val gap = math.max(1e-9, exhaustion - attachment)
    val raw = (indexValue - attachment) / gap
    payoutCurve match {
      case "binary" =>
        if (indexValue >= attachment) 1d else 0d
      case "stepped" =>
        if (indexValue < attachment) 0d
        else if (indexValue >= exhaustion) 1d
        else if (raw < 0.5d) 0.5d
        else 0.8d
      case _ =>
        clamp01(raw)
    }
  }

  private def quantile(sorted: Vector[Double], p: Double): Double = {
    if (sorted.isEmpty) {
      0d
    } else if (sorted.size == 1) {
      sorted.head
    } else {
      val clipped = clamp01(p)
      val position = clipped * (sorted.size - 1).toDouble
      val lowerIndex = math.floor(position).toInt
      val upperIndex = math.ceil(position).toInt
      if (lowerIndex == upperIndex) sorted(lowerIndex)
      else {
        val weight = position - lowerIndex.toDouble
        sorted(lowerIndex) * (1d - weight) + sorted(upperIndex) * weight
      }
    }
  }

  private def clamp01(value: Double): Double =
    math.max(0d, math.min(1d, value))

  private def normalizePayoutCurve(raw: String): String = {
    val normalized = Option(raw).map(_.trim.toLowerCase).getOrElse("linear")
    normalized match {
      case "linear"                 => "linear"
      case "binary"                 => "binary"
      case "step" | "stepped"       => "stepped"
      case "stepped-linear"         => "stepped"
      case _                        => "linear"
    }
  }

  private final case class BoundingBox(latMin: Double, latMax: Double, lonMin: Double, lonMax: Double) {
    def contains(lat: Double, lon: Double): Boolean =
      lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax
  }

  private final case class TriggerRegion(code: String, boxes: Vector[BoundingBox]) {
    def matches(lat: Double, lon: Double): Boolean =
      boxes.isEmpty || boxes.exists(_.contains(lat, lon))
  }

  private object TriggerRegion {
    private val Global: TriggerRegion = TriggerRegion("GLOBAL", Vector.empty)

    def fromCode(raw: String): TriggerRegion = {
      val code = Option(raw).map(_.trim.toUpperCase).filter(_.nonEmpty).getOrElse("GLOBAL")
      code match {
        case "GLOBAL" | "ALL" | "WORLD" =>
          Global
        case "NATL" | "NA" | "ATL" =>
          TriggerRegion(code, Vector(BoundingBox(0d, 60d, -100d, -10d)))
        case "GOM" | "GULF" | "US_GOM" =>
          TriggerRegion(code, Vector(BoundingBox(18d, 32d, -98d, -80d)))
        case "CAR" | "CARIBBEAN" =>
          TriggerRegion(code, Vector(BoundingBox(9d, 25d, -89d, -58d)))
        case "WATL" | "WESTATL" =>
          TriggerRegion(code, Vector(BoundingBox(15d, 45d, -85d, -55d)))
        case "USEC" | "US_EAST" =>
          TriggerRegion(code, Vector(BoundingBox(24d, 42d, -83d, -64d)))
        case bbox if bbox.startsWith("BBOX:") =>
          parseBoundingBoxRegion(bbox).getOrElse(Global)
        case _ =>
          Global
      }
    }

    private def parseBoundingBoxRegion(raw: String): Option[TriggerRegion] = {
      val values = raw.stripPrefix("BBOX:").split(":", -1).map(_.trim)
      if (values.length != 4) None
      else {
        values.toVector
          .map(s => scala.util.Try(s.toDouble).toOption)
          .collect { case Some(v) => v } match {
          case Vector(latMin, latMax, lonMin, lonMax) =>
            Some(TriggerRegion(raw, Vector(BoundingBox(latMin, latMax, lonMin, lonMax))))
          case _ =>
            None
        }
      }
    }
  }

  private final case class PerilFilter(code: String, allowStatuses: Set[String]) {
    def matches(status: String): Boolean =
      if (allowStatuses.isEmpty) true else allowStatuses.contains(status.toUpperCase)
  }

  private object PerilFilter {
    private val tropicalStatuses: Set[String] =
      Set("TD", "TS", "HU", "TY", "ST", "SD", "SS", "PT")

    def fromCode(raw: String): PerilFilter = {
      val code = Option(raw).map(_.trim.toUpperCase).filter(_.nonEmpty).getOrElse("TC")
      val statusSet =
        if (Set("ANY", "ALL", "GLOBAL", "*").contains(code)) Set.empty[String]
        else if (code == "HU" || code.contains("HURRICANE")) Set("HU")
        else if (code == "TS" || code.contains("TROPICALSTORM")) Set("TS", "HU", "TY", "ST")
        else if (
          code == "TC" ||
          code.contains("TROPICAL") ||
          code.contains("CYCLONE") ||
          code.contains("WIND")
        ) tropicalStatuses
        else tropicalStatuses

      PerilFilter(code, statusSet)
    }
  }
}
