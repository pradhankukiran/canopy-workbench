package canopy.engine.property

import canopy.data.hurdat2.Hurdat2Parser
import canopy.inference.rainier.MpiRainierCalibrator
import canopy.engine.property.Hurdat2PropertyCatPricingYltSimulator.{
  Params,
  PropertyLocation,
  PropertyPortfolio,
  Result
}

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path, Paths}
import java.time.Instant

import scala.util.Try

object Hurdat2PropertyCatPricingYltCli {
  private final case class CliArgs(
      inputPath: Path,
      outputPath: Option[Path],
      hurdat2Override: Option[Path],
      propertyPortfolioOverride: Option[Path]
  )

  private final case class RunInput(
      runId: String,
      workspaceId: Option[String],
      params: Params,
      portfolio: PropertyPortfolio,
      hurdat2Path: Path,
      engineProfile: Option[String]
  )

  def main(args: Array[String]): Unit = {
    run(args) match {
      case Left(err) =>
        System.err.println(err)
        sys.exit(1)
      case Right(_) =>
        ()
    }
  }

  def run(args: Array[String]): Either[String, Unit] = {
    for {
      cliArgs <- parseCliArgs(args)
      runInput <- parseRunInput(cliArgs)
      dataset <- Hurdat2Parser.parseFile(runInput.hurdat2Path).left.map(_.toString)
      result = Hurdat2PropertyCatPricingYltSimulator.simulate(dataset, runInput.portfolio, runInput.params)
      bundle = buildPosteriorBundle(runInput, result)
      rendered = ujson.write(bundle, indent = 2)
      _ <- writeOutput(rendered, cliArgs.outputPath)
    } yield ()
  }

  private def parseCliArgs(args: Array[String]): Either[String, CliArgs] = {
    var input: Option[Path] = None
    var output: Option[Path] = None
    var hurdat2: Option[Path] = None
    var propertyPortfolio: Option[Path] = None
    var idx = 0

    def requireValue(flag: String): Either[String, String] =
      if (idx + 1 >= args.length) Left(s"missing value for $flag")
      else {
        idx += 1
        Right(args(idx))
      }

    while (idx < args.length) {
      args(idx) match {
        case "-i" | "--input" =>
          requireValue(args(idx)) match {
            case Left(err) => return Left(usage(Some(err)))
            case Right(v)  => input = Some(Paths.get(v))
          }
        case "-o" | "--output" =>
          requireValue(args(idx)) match {
            case Left(err) => return Left(usage(Some(err)))
            case Right(v)  => output = Some(Paths.get(v))
          }
        case "--hurdat2" =>
          requireValue(args(idx)) match {
            case Left(err) => return Left(usage(Some(err)))
            case Right(v)  => hurdat2 = Some(Paths.get(v))
          }
        case "--portfolio" | "--property-portfolio" =>
          requireValue(args(idx)) match {
            case Left(err) => return Left(usage(Some(err)))
            case Right(v)  => propertyPortfolio = Some(Paths.get(v))
          }
        case "-h" | "--help" =>
          return Left(usage(None))
        case other =>
          return Left(usage(Some(s"unknown argument: $other")))
      }
      idx += 1
    }

    input match {
      case Some(path) => Right(CliArgs(path, output, hurdat2, propertyPortfolio))
      case None       => Left(usage(Some("missing required --input <json-file>")))
    }
  }

  private def parseRunInput(cliArgs: CliArgs): Either[String, RunInput] = {
    val inputPath = cliArgs.inputPath.toAbsolutePath.normalize()
    val inputDir = Option(inputPath.getParent).getOrElse(Paths.get(".").toAbsolutePath.normalize())

    for {
      rootObj <- readJsonObjectFile(inputPath, "input root")
      nestedInput = rootObj.value.get("input").flatMap(asObjOpt)
      lookup = NodeLookup(rootObj, nestedInput)
      runId <- lookup.requiredString("runId")
      workspaceId = lookup.optionalString("workspaceId")
      randomSeed = lookup.optionalInt("randomSeed").getOrElse(42)
      engineProfile = lookup.optionalString("engineProfile")
      pricingObj <- locatePricingParams(rootObj, nestedInput)
      currency =
        firstNonEmpty(
          optionalString(pricingObj, "currency"),
          lookup.optionalString("currency")
        ).getOrElse("USD")
      params = Params(
        simulatedYears =
          optionalInt(pricingObj, "simulatedYears")
            .orElse(optionalInt(pricingObj, "sampleYearCount"))
            .orElse(optionalInt(pricingObj, "yltSampleCount"))
            .getOrElse(1000),
        returnPeriodsYears = optionalIntVector(pricingObj, "returnPeriodsYears").getOrElse(Vector(10, 20, 50, 100)),
        yltRowLimit = optionalInt(pricingObj, "yltRowLimit").getOrElse(25),
        lossBasis = optionalString(pricingObj, "lossBasis").getOrElse("net"),
        includeGrossNetBreakout = optionalBoolean(pricingObj, "includeGrossNetBreakout").getOrElse(true),
        includeSummaryPercentiles = optionalBoolean(pricingObj, "includeSummaryPercentiles").getOrElse(true),
        currency = currency,
        randomSeed = randomSeed
      )
      hurdat2Path = resolvePath(
        cliArgs.hurdat2Override.map(_.toString)
          .orElse(optionalString(pricingObj, "hurdat2Path"))
          .orElse(lookup.optionalString("hurdat2Path"))
          .getOrElse("test-data/hurdat2/sample_atlantic_subset.hurdat2"),
        inputDir
      )
      propertyPortfolio <- loadPropertyPortfolio(
        cliArgs = cliArgs,
        pricingObj = pricingObj,
        rootObj = rootObj,
        nestedInput = nestedInput,
        lookup = lookup,
        inputDir = inputDir,
        fallbackCurrency = params.normalizedCurrency
      )
    } yield RunInput(
      runId = runId,
      workspaceId = workspaceId,
      params = params,
      portfolio = propertyPortfolio,
      hurdat2Path = hurdat2Path,
      engineProfile = engineProfile
    )
  }

  private def loadPropertyPortfolio(
      cliArgs: CliArgs,
      pricingObj: ujson.Obj,
      rootObj: ujson.Obj,
      nestedInput: Option[ujson.Obj],
      lookup: NodeLookup,
      inputDir: Path,
      fallbackCurrency: String
  ): Either[String, PropertyPortfolio] = {
    val portfolioPathOpt =
      cliArgs.propertyPortfolioOverride
        .map(_.toString)
        .orElse(optionalString(pricingObj, "propertyPortfolioPath"))
        .orElse(lookup.optionalString("propertyPortfolioPath"))

    val candidateDealObj =
      lookup.findObject("candidateDeal")
        .orElse(rootObj.value.get("candidateDeal").flatMap(asObjOpt))
        .orElse(nestedInput.flatMap(_.value.get("candidateDeal")).flatMap(asObjOpt))
    val inlinePortfolioObj =
      findNestedObject(candidateDealObj, "portfolio")
        .flatMap(p => findNestedObject(Some(p), "propertyPortfolio"))
        .orElse(lookup.findObject("propertyPortfolio"))
        .orElse(rootObj.value.get("propertyPortfolio").flatMap(asObjOpt))
        .orElse(nestedInput.flatMap(_.value.get("propertyPortfolio")).flatMap(asObjOpt))

    portfolioPathOpt match {
      case Some(pathString) =>
        val path = resolvePath(pathString, inputDir)
        for {
          obj <- readJsonObjectFile(path, "property portfolio file")
          propertyObj <- locatePropertyPortfolioObject(obj)
          portfolio <- parsePropertyPortfolio(propertyObj, fallbackCurrency)
        } yield portfolio
      case None =>
        inlinePortfolioObj match {
          case Some(obj) =>
            parsePropertyPortfolio(obj, fallbackCurrency)
          case None =>
            val fallbackPath = resolvePath("test-data/property/sample_property_portfolio.json", inputDir)
            for {
              obj <- readJsonObjectFile(fallbackPath, "fallback property portfolio file")
              propertyObj <- locatePropertyPortfolioObject(obj)
              portfolio <- parsePropertyPortfolio(propertyObj, fallbackCurrency)
            } yield portfolio
        }
    }
  }

  private def locatePropertyPortfolioObject(root: ujson.Obj): Either[String, ujson.Obj] =
    if (root.value.contains("locations")) Right(root)
    else {
      val candidates = Vector(
        root.value.get("propertyPortfolio").flatMap(asObjOpt),
        root.value.get("portfolio").flatMap(asObjOpt).flatMap(obj => obj.value.get("propertyPortfolio")).flatMap(asObjOpt)
      ).flatten

      candidates.headOption.toRight("could not locate property portfolio object (expected field 'locations')")
    }

  private def parsePropertyPortfolio(obj: ujson.Obj, fallbackCurrency: String): Either[String, PropertyPortfolio] = {
    val locationsValue =
      obj.value.get("locations").collect { case arr: ujson.Arr => arr.value.toVector }.getOrElse(Vector.empty)

    val locations =
      locationsValue.flatMap { value =>
        asObjOpt(value).flatMap(parsePropertyLocation)
      }

    val portfolioId = optionalString(obj, "portfolioId").getOrElse("pf_demo001")
    val name = optionalString(obj, "name").getOrElse("Property Portfolio")
    val currency =
      optionalString(obj, "currency")
        .map(_.trim.toUpperCase)
        .filter(_.matches("^[A-Z]{3}$"))
        .getOrElse(fallbackCurrency)

    Right(
      PropertyPortfolio(
        portfolioId = portfolioId,
        name = name,
        currency = currency,
        locations = locations
      )
    )
  }

  private def parsePropertyLocation(obj: ujson.Obj): Option[PropertyLocation] = {
    val latitude = optionalDouble(obj, "latitude")
    val longitude = optionalDouble(obj, "longitude")
    val tiv = optionalDouble(obj, "tiv")

    if (latitude.isEmpty || longitude.isEmpty || tiv.forall(_ <= 0d)) return None

    Some(
      PropertyLocation(
        locationId = optionalString(obj, "locationId").getOrElse(s"loc_${math.abs(obj.hashCode())}"),
        latitude = latitude.get,
        longitude = longitude.get,
        tiv = tiv.get,
        deductible = optionalDouble(obj, "deductible").getOrElse(0d),
        limit = optionalDouble(obj, "limit").getOrElse(tiv.get),
        occupancy = optionalString(obj, "occupancy"),
        perilSet = optionalStringVector(obj, "perilSet").getOrElse(Vector("WIND")),
        country = optionalString(obj, "country")
      )
    )
  }

  private def locatePricingParams(rootObj: ujson.Obj, nestedInput: Option[ujson.Obj]): Either[String, ujson.Obj] = {
    val rootModuleParams = rootObj.value.get("moduleParameters").flatMap(asObjOpt)
    val nestedModuleParams = nestedInput.flatMap(obj => obj.value.get("moduleParameters")).flatMap(asObjOpt)

    val candidates = Vector(
      rootModuleParams.flatMap(_.value.get("propertyCatPricing")).flatMap(asObjOpt),
      rootModuleParams.flatMap(_.value.get("propertyCatPricingYlt")).flatMap(asObjOpt),
      rootModuleParams.flatMap(_.value.get("pricingYlt")).flatMap(asObjOpt),
      nestedModuleParams.flatMap(_.value.get("propertyCatPricing")).flatMap(asObjOpt),
      nestedModuleParams.flatMap(_.value.get("propertyCatPricingYlt")).flatMap(asObjOpt),
      nestedModuleParams.flatMap(_.value.get("pricingYlt")).flatMap(asObjOpt),
      rootObj.value.get("propertyCatPricing").flatMap(asObjOpt),
      nestedInput.flatMap(_.value.get("propertyCatPricing")).flatMap(asObjOpt)
    ).flatten

    candidates.headOption.toRight("missing property pricing parameters: expected moduleParameters.propertyCatPricing")
  }

  private def buildPosteriorBundle(runInput: RunInput, result: Result): ujson.Obj = {
    val calibrationAttempt = calibrateWithRainier(runInput, result)
    val calibrationApplied = calibrationAttempt.toOption
    val scaleFactor = calibrationApplied.map(_.scaleFactor).getOrElse(1d)
    val simulatedYears = scaleSimulatedYears(result.simulatedYears, scaleFactor)
    val summary = scaleSummaryStats(result.summaryStats, scaleFactor)
    val riskMetrics = scaleRiskMetrics(result.riskMetrics, scaleFactor)
    val yltRows = simulatedYears.take(result.params.normalizedYltRowLimit).map(yltRowJson(_, result.params.normalizedLossBasis))
    val currency = result.portfolio.currency

    val pricingOutput = ujson.Obj(
      "currency" -> ujson.Str(currency),
      "simulatedYears" -> ujson.Num(result.params.normalizedSimulatedYears),
      "sampleYearCount" -> ujson.Num(result.params.normalizedSimulatedYears),
      "yltRowLimit" -> ujson.Num(result.params.normalizedYltRowLimit),
      "rowLimit" -> ujson.Num(result.params.normalizedYltRowLimit),
      "lossBasis" -> ujson.Str(result.params.normalizedLossBasis),
      "includeGrossNetBreakout" -> ujson.Bool(result.params.includeGrossNetBreakout),
      "includeSummaryPercentiles" -> ujson.Bool(result.params.includeSummaryPercentiles),
      "portfolioSummary" -> ujson.Obj(
        "portfolioId" -> ujson.Str(result.portfolio.portfolioId),
        "portfolioName" -> ujson.Str(result.portfolio.name),
        "locationCount" -> ujson.Num(result.portfolioSummary.locationCount),
        "totalInsuredValue" -> ujson.Num(round(result.portfolioSummary.totalTiv, 2)),
        "perils" -> ujson.Arr.from(result.portfolioSummary.perils.map(ujson.Str(_))),
        "regions" -> ujson.Arr.from(result.portfolioSummary.countries.map(ujson.Str(_)))
      ),
      "hazardSummary" -> ujson.Obj(
        "historicalYearCount" -> ujson.Num(result.historicalYears.size),
        "historicalYears" -> ujson.Arr.from(result.historicalYears.map(year => ujson.Num(year.sourceYear)))
      ),
      "summary" -> summaryJson(result, summary),
      "yearLossTable" -> ujson.Obj(
        "rowLimit" -> ujson.Num(result.params.normalizedYltRowLimit),
        "rows" -> ujson.Arr.from(yltRows),
        "summary" -> summaryJson(result, summary)
      ),
      "yltRows" -> ujson.Arr.from(yltRows),
      "rows" -> ujson.Arr.from(yltRows),
      "p50Loss" -> ujson.Num(round(summary.p50Loss, 2)),
      "p90Loss" -> ujson.Num(round(summary.p90Loss, 2)),
      "p99Loss" -> ujson.Num(round(summary.p99Loss, 2)),
      "maxLoss" -> ujson.Num(round(summary.maxLoss, 2)),
      "returnPeriodPricing" -> ujson.Arr.from(riskMetrics.oep.map(returnPeriodPointJson))
    )
    pricingOutput("rainierCalibration") = rainierCalibrationJson(runInput, calibrationAttempt)

    val bundle = ujson.Obj(
      "runId" -> ujson.Str(runInput.runId),
      "generatedAt" -> ujson.Str(Instant.now().toString),
      "modelVersion" ->
        ujson.Str(
          calibrationApplied match {
            case Some(_) => "canopy-engine-property-hurdat2-ylt-v1+rainier"
            case None    => "canopy-engine-property-hurdat2-ylt-v1"
          }
        ),
      "priorVersion" ->
        ujson.Str(
          calibrationApplied match {
            case Some(_) => "rainier-property-pricing-logit-normal-v1"
            case None    => "deterministic-property-pricing-priors-v1"
          }
        ),
      "posteriorSampleCount" ->
        ujson.Num(calibrationApplied.map(_.posteriorSampleCount.toDouble).getOrElse(result.simulatedYears.size.toDouble)),
      "riskMetrics" -> riskMetricsJson(riskMetrics),
      "yearOutcomes" -> ujson.Arr.from(simulatedYears.map(yearOutcomeJson)),
      "moduleOutputs" -> ujson.Obj("propertyCatPricing" -> pricingOutput),
      "diagnostics" -> diagnosticsJson(calibrationApplied, result)
    )

    runInput.workspaceId.foreach(ws => bundle("workspaceId") = ujson.Str(ws))
    bundle
  }

  private def calibrateWithRainier(
      runInput: RunInput,
      result: Result
  ): Either[MpiRainierCalibrator.CalibrationFailure, MpiRainierCalibrator.Output] = {
    val exposureBase = math.max(1d, result.portfolioSummary.totalTiv)
    val observedHistoricalRates =
      result.historicalYears.map(year => clamp01(lossByBasis(year.grossLoss, year.cededLoss, year.netLoss, result.params.normalizedLossBasis) / exposureBase))
    val observedRates =
      if (observedHistoricalRates.count(rate => rate > 0d && rate < 1d) >= 4) observedHistoricalRates
      else
        result.simulatedYears.map(year =>
          clamp01(lossByBasis(year.grossLoss, year.cededLoss, year.netLoss, result.params.normalizedLossBasis) / exposureBase)
        )

    MpiRainierCalibrator.calibrate(
      MpiRainierCalibrator.Input(
        baseExpectedLossRate = clamp01(result.riskMetrics.expectedLossRate),
        observedAnnualLossRates = observedRates,
        randomSeed = result.params.randomSeed,
        engineProfile = runInput.engineProfile.getOrElse("standard")
      )
    )
  }

  private def rainierCalibrationJson(
      runInput: RunInput,
      calibrationAttempt: Either[MpiRainierCalibrator.CalibrationFailure, MpiRainierCalibrator.Output]
  ): ujson.Obj = {
    val engineProfile = runInput.engineProfile.map(_.trim).filter(_.nonEmpty).getOrElse("standard")
    calibrationAttempt match {
      case Right(output) =>
        val obj = ujson.Obj(
          "status" -> ujson.Str("applied"),
          "engineProfile" -> ujson.Str(engineProfile),
          "posteriorMeanRate" -> ujson.Num(round(output.posteriorMeanRate)),
          "posteriorMedianRate" -> ujson.Num(round(output.posteriorMedianRate)),
          "posteriorP05Rate" -> ujson.Num(round(output.posteriorP05Rate)),
          "posteriorP95Rate" -> ujson.Num(round(output.posteriorP95Rate)),
          "posteriorStdDevRate" -> ujson.Num(round(output.posteriorStdDevRate)),
          "posteriorSampleCount" -> ujson.Num(output.posteriorSampleCount),
          "deterministicBaseRate" -> ujson.Num(round(output.deterministicBaseRate)),
          "scaleFactor" -> ujson.Num(round(output.scaleFactor)),
          "observedRateCount" -> ujson.Num(output.observedRateCount)
        )
        output.mapRate.foreach(v => obj("mapRate") = ujson.Num(round(v)))
        output.diagnostics.foreach { d =>
          obj("diagnostics") = ujson.Obj(
            "rHatMax" -> ujson.Num(round(d.rHatMax)),
            "essMin" -> ujson.Num(round(d.essMin, 2))
          )
        }
        obj
      case Left(err) =>
        ujson.Obj(
          "status" -> ujson.Str("failed"),
          "engineProfile" -> ujson.Str(engineProfile),
          "message" -> ujson.Str(err.toString)
        )
    }
  }

  private def diagnosticsJson(
      calibration: Option[MpiRainierCalibrator.Output],
      result: Result
  ): ujson.Obj = {
    // Honest diagnostics: emit real MCMC R-hat / ESS only when the Rainier
    // sampler actually produced them. Previously this path fabricated
    // rHatMax=1.0 and a synthetic essMin whenever calibration was skipped
    // (no Rainier run, sampler fallback, or too few observed rates), which
    // presented users with "converged" diagnostics for an MCMC that never
    // executed. Real per-quantile posterior diagnostics land in phase 4.
    val _ = result
    calibration match {
      case Some(output) =>
        output.diagnostics match {
          case Some(d) =>
            ujson.Obj(
              "status" -> ujson.Str("converged"),
              "rHatMax" -> ujson.Num(round(d.rHatMax)),
              "essMin" -> ujson.Num(round(d.essMin, 2)),
              "source" -> ujson.Str("rainier-mcmc")
            )
          case None =>
            ujson.Obj(
              "status" -> ujson.Str("no_mcmc_diagnostics"),
              "reason" -> ujson.Str(
                "Rainier calibration ran a non-MCMC path (deterministic fallback or insufficient observed history) so no R-hat/ESS are available."
              )
            )
        }
      case None =>
        ujson.Obj(
          "status" -> ujson.Str("skipped"),
          "reason" -> ujson.Str(
            "Rainier calibration was not applied for this run (disabled, failed, or not requested)."
          )
        )
    }
  }

  private def scaleSimulatedYears(
      rows: Vector[Hurdat2PropertyCatPricingYltSimulator.SimulatedYearLoss],
      rawFactor: Double
  ): Vector[Hurdat2PropertyCatPricingYltSimulator.SimulatedYearLoss] = {
    val factor = sanitizeScaleFactor(rawFactor)
    rows.map(row =>
      row.copy(
        grossLoss = row.grossLoss * factor,
        cededLoss = row.cededLoss * factor,
        netLoss = row.netLoss * factor
      )
    )
  }

  private def scaleSummaryStats(
      stats: Hurdat2PropertyCatPricingYltSimulator.SummaryStats,
      rawFactor: Double
  ): Hurdat2PropertyCatPricingYltSimulator.SummaryStats = {
    val factor = sanitizeScaleFactor(rawFactor)
    stats.copy(
      p50Loss = stats.p50Loss * factor,
      p90Loss = stats.p90Loss * factor,
      p99Loss = stats.p99Loss * factor,
      maxLoss = stats.maxLoss * factor
    )
  }

  private def scaleRiskMetrics(
      risk: Hurdat2PropertyCatPricingYltSimulator.RiskMetrics,
      rawFactor: Double
  ): Hurdat2PropertyCatPricingYltSimulator.RiskMetrics = {
    val factor = sanitizeScaleFactor(rawFactor)
    risk.copy(
      expectedLoss = risk.expectedLoss * factor,
      expectedLossRate = clamp01(risk.expectedLossRate * factor),
      stdDevLoss = risk.stdDevLoss * factor,
      var99 = risk.var99 * factor,
      tvar99 = risk.tvar99 * factor,
      oep = risk.oep.map(point => scaleReturnPeriodPoint(point, factor)),
      aep = risk.aep.map(point => scaleReturnPeriodPoint(point, factor))
    )
  }

  private def scaleReturnPeriodPoint(
      point: Hurdat2PropertyCatPricingYltSimulator.ReturnPeriodPoint,
      factor: Double
  ): Hurdat2PropertyCatPricingYltSimulator.ReturnPeriodPoint =
    point.copy(
      grossLoss = point.grossLoss * factor,
      netLoss = point.netLoss * factor,
      bondPayout = point.bondPayout * factor
    )

  private def lossByBasis(grossLoss: Double, cededLoss: Double, netLoss: Double, lossBasis: String): Double =
    lossBasis match {
      case "gross" => grossLoss
      case "ceded" => cededLoss
      case _       => netLoss
    }

  private def sanitizeScaleFactor(value: Double): Double =
    if (value.isFinite && value > 0d) value else 1d

  private def summaryJson(result: Result, stats: Hurdat2PropertyCatPricingYltSimulator.SummaryStats): ujson.Obj = {
    val obj = ujson.Obj(
      "currency" -> ujson.Str(result.portfolio.currency),
      "simulatedYears" -> ujson.Num(result.params.normalizedSimulatedYears),
      "p50Loss" -> ujson.Num(round(stats.p50Loss, 2)),
      "p90Loss" -> ujson.Num(round(stats.p90Loss, 2)),
      "p99Loss" -> ujson.Num(round(stats.p99Loss, 2)),
      "maxLoss" -> ujson.Num(round(stats.maxLoss, 2))
    )

    if (result.params.includeSummaryPercentiles) {
      obj("percentiles") = ujson.Obj(
        "p50" -> ujson.Num(round(stats.p50Loss, 2)),
        "p90" -> ujson.Num(round(stats.p90Loss, 2)),
        "p99" -> ujson.Num(round(stats.p99Loss, 2))
      )
    }
    obj
  }

  private def yltRowJson(
      row: Hurdat2PropertyCatPricingYltSimulator.SimulatedYearLoss,
      lossBasis: String
  ): ujson.Obj = {
    val selectedLoss = lossBasis match {
      case "gross" => row.grossLoss
      case "ceded" => row.cededLoss
      case _       => row.netLoss
    }

    // attachmentReached and bondExhausted are intentionally omitted here:
    // there is no layer / cat-bond tower in the current financial model, so
    // both are placeholder concepts. Phase 3 introduces a real LayerTower
    // and will re-emit these with real attachment/exhaustion logic.
    ujson.Obj(
      "yearIndex" -> ujson.Num(row.yearIndex),
      "sourceYear" -> ujson.Num(row.sourceYear),
      "eventCount" -> ujson.Num(row.eventCount),
      "grossLoss" -> ujson.Num(round(row.grossLoss, 2)),
      "retainedLoss" -> ujson.Num(round(row.cededLoss, 2)),
      "netLoss" -> ujson.Num(round(row.netLoss, 2)),
      "loss" -> ujson.Num(round(selectedLoss, 2))
    )
  }

  private def yearOutcomeJson(row: Hurdat2PropertyCatPricingYltSimulator.SimulatedYearLoss): ujson.Obj =
    // bondExhausted is omitted (no layer configured). aggregateCededLoss is
    // renamed to aggregateRetainedLoss because under the current model the
    // field represents the site-level retention (groundUp - insured), not
    // ceded reinsurance. Phase 3's layer tower will add true cession fields.
    ujson.Obj(
      "yearIndex" -> ujson.Num(row.yearIndex),
      "eventCount" -> ujson.Num(row.eventCount),
      "aggregateGrossLoss" -> ujson.Num(round(row.grossLoss, 2)),
      "aggregateRetainedLoss" -> ujson.Num(round(row.cededLoss, 2)),
      "aggregateNetLoss" -> ujson.Num(round(row.netLoss, 2))
    )

  private def riskMetricsJson(risk: Hurdat2PropertyCatPricingYltSimulator.RiskMetrics): ujson.Obj =
    ujson.Obj(
      "currency" -> ujson.Str(risk.currency),
      "expectedLoss" -> ujson.Num(round(risk.expectedLoss, 2)),
      "expectedLossRate" -> ujson.Num(round(risk.expectedLossRate)),
      "stdDevLoss" -> ujson.Num(round(risk.stdDevLoss, 2)),
      "attachmentProbability" -> ujson.Num(round(risk.attachmentProbability)),
      "exhaustionProbability" -> ujson.Num(round(risk.exhaustionProbability)),
      "var99" -> ujson.Num(round(risk.var99, 2)),
      "tvar99" -> ujson.Num(round(risk.tvar99, 2)),
      "oep" -> ujson.Arr.from(risk.oep.map(returnPeriodPointJson)),
      "aep" -> ujson.Arr.from(risk.aep.map(returnPeriodPointJson))
    )

  private def returnPeriodPointJson(point: Hurdat2PropertyCatPricingYltSimulator.ReturnPeriodPoint): ujson.Obj =
    ujson.Obj(
      "returnPeriodYears" -> ujson.Num(point.returnPeriodYears),
      "grossLoss" -> ujson.Num(round(point.grossLoss, 2)),
      "netLoss" -> ujson.Num(round(point.netLoss, 2)),
      "bondPayout" -> ujson.Num(round(point.bondPayout, 2))
    )

  private def readJsonObjectFile(path: Path, label: String): Either[String, ujson.Obj] = {
    val normalized = path.toAbsolutePath.normalize()
    for {
      text <- Try(new String(Files.readAllBytes(normalized), StandardCharsets.UTF_8))
        .toEither
        .left
        .map(ex => s"failed to read ${normalized}: ${ex.getMessage}")
      json <- Try(ujson.read(text)).toEither.left.map(ex => s"invalid JSON in ${normalized}: ${ex.getMessage}")
      obj <- asObj(json, label)
    } yield obj
  }

  private def writeOutput(rendered: String, outputPath: Option[Path]): Either[String, Unit] =
    outputPath match {
      case Some(path) =>
        Try {
          val parent = Option(path.toAbsolutePath.normalize().getParent)
          parent.foreach(p => Files.createDirectories(p))
          Files.write(path, rendered.getBytes(StandardCharsets.UTF_8))
        }.toEither.left.map(ex => s"failed to write ${path}: ${ex.getMessage}").map(_ => ())
      case None =>
        println(rendered)
        Right(())
    }

  private def resolvePath(raw: String, baseDir: Path): Path = {
    val p = Paths.get(raw)
    if (p.isAbsolute) p.normalize() else baseDir.resolve(p).normalize()
  }

  private def findNestedObject(parent: Option[ujson.Obj], key: String): Option[ujson.Obj] =
    parent.flatMap(_.value.get(key)).flatMap(asObjOpt)

  private final case class NodeLookup(root: ujson.Obj, nested: Option[ujson.Obj]) {
    def value(key: String): Option[ujson.Value] =
      root.value.get(key).orElse(nested.flatMap(_.value.get(key)))

    def findObject(key: String): Option[ujson.Obj] =
      value(key).flatMap(asObjOpt)

    def optionalString(key: String): Option[String] =
      value(key).flatMap(asStringOpt)

    def optionalInt(key: String): Option[Int] =
      value(key).flatMap(asIntOpt)

    def requiredString(key: String): Either[String, String] =
      optionalString(key).toRight(s"missing required string field: $key")
  }

  private def asObj(value: ujson.Value, label: String): Either[String, ujson.Obj] =
    value match {
      case obj: ujson.Obj => Right(obj)
      case _              => Left(s"$label must be a JSON object")
    }

  private def asObjOpt(value: ujson.Value): Option[ujson.Obj] =
    value match {
      case obj: ujson.Obj => Some(obj)
      case _              => None
    }

  private def asStringOpt(value: ujson.Value): Option[String] =
    value match {
      case ujson.Str(v) =>
        val t = v.trim
        if (t.nonEmpty) Some(t) else None
      case _ => None
    }

  private def asDoubleOpt(value: ujson.Value): Option[Double] =
    value match {
      case ujson.Num(v) if v.isFinite => Some(v)
      case _                          => None
    }

  private def asIntOpt(value: ujson.Value): Option[Int] =
    asDoubleOpt(value).map(_.toInt)

  private def asBooleanOpt(value: ujson.Value): Option[Boolean] =
    value match {
      case ujson.Bool(v) => Some(v)
      case _             => None
    }

  private def optionalString(obj: ujson.Obj, key: String): Option[String] =
    obj.value.get(key).flatMap(asStringOpt)

  private def optionalDouble(obj: ujson.Obj, key: String): Option[Double] =
    obj.value.get(key).flatMap(asDoubleOpt)

  private def optionalInt(obj: ujson.Obj, key: String): Option[Int] =
    obj.value.get(key).flatMap(asIntOpt)

  private def optionalBoolean(obj: ujson.Obj, key: String): Option[Boolean] =
    obj.value.get(key).flatMap(asBooleanOpt)

  private def optionalIntVector(obj: ujson.Obj, key: String): Option[Vector[Int]] =
    obj.value.get(key) match {
      case Some(arr: ujson.Arr) =>
        val values = arr.value.flatMap(asIntOpt).filter(_ > 0).distinct.sorted.toVector
        if (values.nonEmpty) Some(values) else None
      case _ => None
    }

  private def optionalStringVector(obj: ujson.Obj, key: String): Option[Vector[String]] =
    obj.value.get(key) match {
      case Some(arr: ujson.Arr) =>
        val values = arr.value.flatMap(asStringOpt).map(_.trim).filter(_.nonEmpty).distinct.toVector
        if (values.nonEmpty) Some(values) else None
      case _ => None
    }

  private def firstNonEmpty(values: Option[String]*): Option[String] =
    values.collectFirst { case Some(v) if v.trim.nonEmpty => v.trim }

  private def usage(error: Option[String]): String = {
    val base =
      """Usage: Hurdat2PropertyCatPricingYltCli --input <json-file> [--output <json-file>] [--hurdat2 <file>] [--portfolio <json-file>]
        |
        |Reads a Canopy run payload (or worker handoff payload) and emits a PosteriorBundle-compatible
        |property-cat pricing result using HURDAT2 tracks and a property portfolio JSON.
        |""".stripMargin.trim
    error match {
      case Some(msg) if msg.nonEmpty => s"$msg\n$base"
      case _                         => base
    }
  }

  private def round(value: Double, digits: Int = 6): Double =
    BigDecimal(value).setScale(digits, BigDecimal.RoundingMode.HALF_UP).toDouble

  private def clamp01(value: Double): Double =
    math.max(0d, math.min(1d, if (value.isFinite) value else 0d))
}
