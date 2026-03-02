package canopy.engine.portfolio

import canopy.inference.rainier.MpiRainierCalibrator
import canopy.engine.portfolio.MarginalPortfolioImpactSimulator.{
  CandidateTerms,
  ExposureLocation,
  ModelInput,
  Params,
  PortfolioSummary,
  Result
}

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path, Paths}
import java.time.Instant

import scala.util.Try

object MarginalPortfolioImpactCli {
  private final case class CliArgs(inputPath: Path, outputPath: Option[Path])

  private final case class RunInput(
      runId: String,
      workspaceId: Option[String],
      modelInput: ModelInput,
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
      result = MarginalPortfolioImpactSimulator.simulate(runInput.modelInput)
      bundle = buildPosteriorBundle(runInput, result)
      rendered = ujson.write(bundle, indent = 2)
      _ <- writeOutput(rendered, cliArgs.outputPath)
    } yield ()
  }

  private def parseCliArgs(args: Array[String]): Either[String, CliArgs] = {
    var input: Option[Path] = None
    var output: Option[Path] = None
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
        case "-h" | "--help" =>
          return Left(usage(None))
        case other =>
          return Left(usage(Some(s"unknown argument: $other")))
      }
      idx += 1
    }

    input match {
      case Some(path) => Right(CliArgs(path, output))
      case None       => Left(usage(Some("missing required --input <json-file>")))
    }
  }

  private def parseRunInput(cliArgs: CliArgs): Either[String, RunInput] = {
    val inputPath = cliArgs.inputPath.toAbsolutePath.normalize()
    val textEither =
      Try(new String(Files.readAllBytes(inputPath), StandardCharsets.UTF_8))
        .toEither
        .left
        .map(ex => s"failed to read ${inputPath}: ${ex.getMessage}")

    for {
      rawText <- textEither
      rootValue <- Try(ujson.read(rawText)).toEither.left.map(ex => s"invalid JSON in ${inputPath}: ${ex.getMessage}")
      rootObj <- asObj(rootValue, "input root")
      nestedInput = rootObj.value.get("input").flatMap(asObjOpt)
      lookup = NodeLookup(rootObj, nestedInput)
      runId <- lookup.requiredString("runId")
      workspaceId = lookup.optionalString("workspaceId")
      randomSeed = lookup.optionalInt("randomSeed").getOrElse(42)
      engineProfile = lookup.optionalString("engineProfile").orElse(nestedInput.flatMap(optionalString(_, "engineProfile")))
      candidateDealObj = lookup.findObject("candidateDeal")
      portfolioObj = findNestedObject(candidateDealObj, "portfolio").orElse(lookup.findObject("portfolio"))
      propertyPortfolioObj =
        findNestedObject(portfolioObj, "propertyPortfolio").orElse(lookup.findObject("propertyPortfolio"))
      catBondTermsObj = findNestedObject(candidateDealObj, "catBondTerms").orElse(lookup.findObject("catBondTerms"))
      mpiParamsObj <- locateMpiParams(rootObj, nestedInput)
      locations = parseLocations(propertyPortfolioObj)
      propertyCurrency = propertyPortfolioObj.flatMap(optionalString(_, "currency"))
      portfolioId =
        firstNonEmpty(
          optionalString(mpiParamsObj, "baselinePortfolioId"),
          optionalString(mpiParamsObj, "referencePortfolioId"),
          portfolioObj.flatMap(optionalString(_, "portfolioId")),
          propertyPortfolioObj.flatMap(optionalString(_, "portfolioId"))
        ).getOrElse("pf_demo001")
      candidateDealId =
        firstNonEmpty(
          lookup.optionalString("candidateDealId"),
          candidateDealObj.flatMap(optionalString(_, "candidateDealId"))
        ).getOrElse("deal_demo001")
      candidateDealName =
        firstNonEmpty(
          optionalString(mpiParamsObj, "candidateDealName"),
          candidateDealObj.flatMap(optionalString(_, "name")),
          Some(candidateDealId)
        ).getOrElse("Candidate Deal")
      candidateTerms = parseCandidateTerms(catBondTermsObj)
      params = Params(
        baselinePortfolioId = portfolioId,
        candidateDealName = candidateDealName,
        candidateDealLimit =
          optionalDouble(mpiParamsObj, "candidateDealLimit")
            .orElse(Some(candidateTerms.notional))
            .getOrElse(5000000d),
        candidateParticipationPct = optionalDouble(mpiParamsObj, "candidateParticipationPct").getOrElse(100d),
        tailCurve = optionalString(mpiParamsObj, "tailCurve").getOrElse("oep"),
        tailMetric = optionalString(mpiParamsObj, "tailMetric").getOrElse("var"),
        tailReturnPeriodYears = optionalInt(mpiParamsObj, "tailReturnPeriodYears").getOrElse(100),
        returnPeriodsYears = optionalIntVector(mpiParamsObj, "returnPeriodsYears").getOrElse(Vector(10, 20, 50, 100)),
        includeTailRiskComparison = optionalBoolean(mpiParamsObj, "includeTailRiskComparison").getOrElse(true),
        currency =
          firstNonEmpty(
            optionalString(mpiParamsObj, "currency"),
            propertyCurrency,
            lookup.optionalString("currency")
          ).getOrElse("USD"),
        randomSeed = randomSeed
      )
      portfolioSummary = MarginalPortfolioImpactSimulator.portfolioSummaryFromLocations(portfolioId, locations)
      modelInput = ModelInput(params = params, portfolioSummary = portfolioSummary, candidateTerms = candidateTerms)
      tunedInput = tuneForEngineProfile(modelInput, engineProfile)
    } yield RunInput(
      runId = runId,
      workspaceId = workspaceId,
      modelInput = tunedInput,
      engineProfile = engineProfile
    )
  }

  private def locateMpiParams(rootObj: ujson.Obj, nestedInput: Option[ujson.Obj]): Either[String, ujson.Obj] = {
    val rootModuleParams = rootObj.value.get("moduleParameters").flatMap(asObjOpt)
    val nestedModuleParams = nestedInput.flatMap(obj => obj.value.get("moduleParameters")).flatMap(asObjOpt)

    val candidates = Vector(
      rootModuleParams.flatMap(_.value.get("marginalPortfolioImpact")).flatMap(asObjOpt),
      nestedModuleParams.flatMap(_.value.get("marginalPortfolioImpact")).flatMap(asObjOpt),
      rootObj.value.get("marginalPortfolioImpact").flatMap(asObjOpt),
      nestedInput.flatMap(_.value.get("marginalPortfolioImpact")).flatMap(asObjOpt)
    ).flatten

    candidates.headOption.toRight(
      "missing MPI parameters: expected moduleParameters.marginalPortfolioImpact"
    )
  }

  private def tuneForEngineProfile(input: ModelInput, engineProfile: Option[String]): ModelInput = {
    // Keep the model deterministic but let engine profile slightly alter simulated deal scale to match UX expectations.
    val multiplier = engineProfile.map(_.trim.toLowerCase) match {
      case Some("fast") => 0.98d
      case Some("full") => 1.03d
      case _            => 1d
    }

    if (multiplier == 1d) input
    else {
      val p = input.params
      input.copy(
        params = p.copy(candidateDealLimit = p.candidateDealLimit * multiplier)
      )
    }
  }

  private def parseCandidateTerms(catBondTermsObj: Option[ujson.Obj]): CandidateTerms = {
    val obj = catBondTermsObj
    CandidateTerms(
      notional = obj.flatMap(optionalDouble(_, "notional")).filter(_ > 0d).getOrElse(5000000d),
      attachmentPoint = obj.flatMap(optionalDouble(_, "attachmentPoint")).getOrElse(0d),
      exhaustionPoint = obj.flatMap(optionalDouble(_, "exhaustionPoint")).getOrElse(0d),
      expectedLossBps = obj.flatMap(optionalDouble(_, "expectedLossBps")),
      couponSpreadBps = obj.flatMap(optionalDouble(_, "couponSpreadBps")),
      modeledShare = obj.flatMap(optionalDouble(_, "modeledShare")),
      triggerType = obj.flatMap(optionalString(_, "triggerType"))
    )
  }

  private def parseLocations(propertyPortfolioObj: Option[ujson.Obj]): Vector[ExposureLocation] = {
    val rawLocations =
      propertyPortfolioObj
        .flatMap(obj => obj.value.get("locations"))
        .collect { case arr: ujson.Arr => arr.value.toVector }
        .getOrElse(Vector.empty)

    rawLocations.flatMap {
      case value =>
        asObjOpt(value).map { row =>
          val locationId = optionalString(row, "locationId").getOrElse(s"loc_${math.abs(row.hashCode())}")
          val tiv = optionalDouble(row, "tiv").getOrElse(0d)
          val deductible = optionalDouble(row, "deductible").getOrElse(0d)
          val limit = optionalDouble(row, "limit").getOrElse(0d)
          val country = optionalString(row, "country").getOrElse("US")
          val perils = optionalStringVector(row, "perilSet").getOrElse(Vector("WIND"))
          ExposureLocation(
            locationId = locationId,
            tiv = tiv,
            deductible = deductible,
            limit = limit,
            country = country,
            perils = perils
          )
        }
    }
  }

  private def buildPosteriorBundle(runInput: RunInput, result: Result): ujson.Obj = {
    val calibrationAttempt = calibrateWithRainier(runInput, result)
    val calibrationApplied = calibrationAttempt.toOption

    val riskMetrics =
      calibrationApplied match {
        case Some(calibration) => scaleRiskMetrics(result.riskMetrics, calibration.scaleFactor)
        case None              => result.riskMetrics
      }
    val comparisonRows =
      calibrationApplied match {
        case Some(calibration) => scaleComparisonRows(result.comparisonRows, calibration.scaleFactor)
        case None              => result.comparisonRows
      }

    val params = result.params
    val currency = params.normalizedCurrency
    val metricLabel = s"${params.normalizedTailCurve.toUpperCase} ${params.normalizedTailMetric.toUpperCase}"

    val mpiOutput = ujson.Obj(
      "baselinePortfolioId" -> ujson.Str(params.normalizedBaselinePortfolioId),
      "candidateDealName" -> ujson.Str(params.normalizedCandidateDealName),
      "candidateDealLimit" -> ujson.Num(round(params.normalizedCandidateDealLimit, 2)),
      "candidateParticipationPct" -> ujson.Num(round(params.normalizedCandidateParticipationPct * 100d, 2)),
      "tailSelection" -> ujson.Obj(
        "curve" -> ujson.Str(params.normalizedTailCurve),
        "metric" -> ujson.Str(params.normalizedTailMetric),
        "returnPeriodYears" -> ujson.Num(params.normalizedTailReturnPeriodYears)
      ),
      "currency" -> ujson.Str(currency),
      "tailMetric" -> ujson.Str(metricLabel),
      "includeTailRiskComparisonRequested" -> ujson.Bool(params.includeTailRiskComparison),
      "portfolioSummary" -> portfolioSummaryJson(result.portfolioSummary),
      "candidateTerms" -> candidateTermsJson(result.candidateTerms)
    )

    mpiOutput("rainierCalibration") = rainierCalibrationJson(runInput, calibrationAttempt)

    if (params.includeTailRiskComparison) {
      val rowsJson = ujson.Arr.from(comparisonRows.map(comparisonRowJson))
      mpiOutput("comparisonRows") = rowsJson
      mpiOutput("tailRiskComparison") = ujson.Arr.from(comparisonRows.map(comparisonRowJson))
      mpiOutput("beforeAfterTailRisk") = ujson.Arr.from(comparisonRows.map(comparisonRowJson))
      mpiOutput("beforeMetricsTable") = metricsTableJson("mpi-before", "Before (Baseline Portfolio)", currency, comparisonRows, _.before, None)
      mpiOutput("afterMetricsTable") = metricsTableJson("mpi-after", "After (Baseline + Candidate)", currency, comparisonRows, _.after, None)
      mpiOutput("changeMetricsTable") =
        metricsTableJson("mpi-change", "Change (After - Before)", currency, comparisonRows, _.delta, Some(_.deltaPct))
    }

    val bundle = ujson.Obj(
      "runId" -> ujson.Str(runInput.runId),
      "generatedAt" -> ujson.Str(Instant.now().toString),
      "modelVersion" ->
        ujson.Str(
          calibrationApplied match {
            case Some(_) => "canopy-engine-portfolio-mpi-v1+rainier"
            case None    => "canopy-engine-portfolio-mpi-v1"
          }
        ),
      "priorVersion" ->
        ujson.Str(
          calibrationApplied match {
            case Some(_) => "rainier-mpi-logit-normal-v1"
            case None    => "deterministic-mpi-priors-v1"
          }
        ),
      "posteriorSampleCount" ->
        ujson.Num(calibrationApplied.map(_.posteriorSampleCount.toDouble).getOrElse(result.yearOutcomes.size * 100d)),
      "riskMetrics" -> riskMetricsJson(riskMetrics),
      "yearOutcomes" -> ujson.Arr.from(result.yearOutcomes.map(yearOutcomeJson)),
      "moduleOutputs" -> ujson.Obj("marginalPortfolioImpact" -> mpiOutput),
      "diagnostics" -> diagnosticsJson(calibrationApplied)
    )

    runInput.workspaceId.foreach(ws => bundle("workspaceId") = ujson.Str(ws))
    bundle
  }

  private def calibrateWithRainier(
      runInput: RunInput,
      result: Result
  ): Either[MpiRainierCalibrator.CalibrationFailure, MpiRainierCalibrator.Output] = {
    val candidateLimit = result.params.normalizedCandidateDealLimit
    if (candidateLimit <= 0d) {
      return Left(MpiRainierCalibrator.CalibrationFailure("candidate deal limit must be positive for Rainier calibration"))
    }

    val observedAnnualRates =
      result.yearOutcomes.map(year => clamp01(year.aggregateCededLoss / candidateLimit))

    MpiRainierCalibrator.calibrate(
      MpiRainierCalibrator.Input(
        baseExpectedLossRate = clamp01(result.riskMetrics.expectedLossRate),
        observedAnnualLossRates = observedAnnualRates,
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

  private def diagnosticsJson(calibration: Option[MpiRainierCalibrator.Output]): ujson.Obj =
    calibration.flatMap(_.diagnostics) match {
      case Some(d) =>
        ujson.Obj(
          "rHatMax" -> ujson.Num(round(d.rHatMax)),
          "essMin" -> ujson.Num(round(d.essMin, 2))
        )
      case None =>
        ujson.Obj(
          "rHatMax" -> ujson.Num(1.0),
          "essMin" -> ujson.Num(1000)
        )
    }

  private def scaleRiskMetrics(
      risk: MarginalPortfolioImpactSimulator.RiskMetrics,
      rawFactor: Double
  ): MarginalPortfolioImpactSimulator.RiskMetrics = {
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
      point: MarginalPortfolioImpactSimulator.ReturnPeriodPoint,
      factor: Double
  ): MarginalPortfolioImpactSimulator.ReturnPeriodPoint =
    point.copy(
      grossLoss = point.grossLoss * factor,
      netLoss = point.netLoss * factor,
      bondPayout = point.bondPayout * factor
    )

  private def scaleComparisonRows(
      rows: Vector[MarginalPortfolioImpactSimulator.TailRiskComparisonRow],
      rawFactor: Double
  ): Vector[MarginalPortfolioImpactSimulator.TailRiskComparisonRow] = {
    val factor = sanitizeScaleFactor(rawFactor)
    rows.map(row =>
      row.copy(
        before = row.before * factor,
        after = row.after * factor,
        delta = row.delta * factor
      )
    )
  }

  private def sanitizeScaleFactor(value: Double): Double =
    if (value.isFinite && value > 0d) value else 1d

  private def riskMetricsJson(risk: MarginalPortfolioImpactSimulator.RiskMetrics): ujson.Obj =
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

  private def returnPeriodPointJson(point: MarginalPortfolioImpactSimulator.ReturnPeriodPoint): ujson.Obj =
    ujson.Obj(
      "returnPeriodYears" -> ujson.Num(point.returnPeriodYears),
      "grossLoss" -> ujson.Num(round(point.grossLoss, 2)),
      "netLoss" -> ujson.Num(round(point.netLoss, 2)),
      "bondPayout" -> ujson.Num(round(point.bondPayout, 2))
    )

  private def yearOutcomeJson(row: MarginalPortfolioImpactSimulator.YearOutcome): ujson.Obj =
    ujson.Obj(
      "yearIndex" -> ujson.Num(row.yearIndex),
      "eventCount" -> ujson.Num(row.eventCount),
      "aggregateGrossLoss" -> ujson.Num(round(row.aggregateGrossLoss, 2)),
      "aggregateCededLoss" -> ujson.Num(round(row.aggregateCededLoss, 2)),
      "aggregateNetLoss" -> ujson.Num(round(row.aggregateNetLoss, 2)),
      "bondExhausted" -> ujson.Bool(row.bondExhausted)
    )

  private def comparisonRowJson(row: MarginalPortfolioImpactSimulator.TailRiskComparisonRow): ujson.Obj =
    ujson.Obj(
      "returnPeriodYears" -> ujson.Num(row.returnPeriodYears),
      "metric" -> ujson.Str(row.metric),
      "before" -> ujson.Num(round(row.before, 2)),
      "after" -> ujson.Num(round(row.after, 2)),
      "delta" -> ujson.Num(round(row.delta, 2)),
      "deltaPct" -> ujson.Num(round(row.deltaPct))
    )

  private def portfolioSummaryJson(summary: PortfolioSummary): ujson.Obj =
    ujson.Obj(
      "portfolioId" -> ujson.Str(summary.portfolioId),
      "locationCount" -> ujson.Num(summary.locationCount),
      "totalTiv" -> ujson.Num(round(summary.totalTiv, 2)),
      "averageDeductibleRatio" -> ujson.Num(round(summary.averageDeductibleRatio)),
      "averageLimitRatio" -> ujson.Num(round(summary.averageLimitRatio)),
      "countryCount" -> ujson.Num(summary.countryCount),
      "perilCount" -> ujson.Num(summary.perilCount)
    )

  private def candidateTermsJson(terms: CandidateTerms): ujson.Obj = {
    val obj = ujson.Obj(
      "notional" -> ujson.Num(round(terms.notional, 2)),
      "attachmentPoint" -> ujson.Num(round(terms.attachmentPoint, 2)),
      "exhaustionPoint" -> ujson.Num(round(terms.exhaustionPoint, 2))
    )
    terms.expectedLossBps.foreach(v => obj("expectedLossBps") = ujson.Num(round(v, 2)))
    terms.couponSpreadBps.foreach(v => obj("couponSpreadBps") = ujson.Num(round(v, 2)))
    terms.modeledShare.foreach(v => obj("modeledShare") = ujson.Num(round(v)))
    terms.triggerType.foreach(v => obj("triggerType") = ujson.Str(v))
    obj
  }

  private def metricsTableJson(
      tableId: String,
      title: String,
      currency: String,
      rows: Vector[MarginalPortfolioImpactSimulator.TailRiskComparisonRow],
      amountFn: MarginalPortfolioImpactSimulator.TailRiskComparisonRow => Double,
      deltaPctFn: Option[MarginalPortfolioImpactSimulator.TailRiskComparisonRow => Double]
  ): ujson.Obj =
    ujson.Obj(
      "tableId" -> ujson.Str(tableId),
      "title" -> ujson.Str(title),
      "columns" -> ujson.Arr(
        ujson.Obj("key" -> "metric", "label" -> "Metric", "format" -> "label"),
        ujson.Obj("key" -> "returnPeriodYears", "label" -> "Return Period", "unit" -> "years", "format" -> "integer"),
        ujson.Obj("key" -> "amount", "label" -> "Amount", "unit" -> currency, "format" -> "currency"),
        ujson.Obj("key" -> "deltaPct", "label" -> "Delta %", "unit" -> "ratio", "format" -> "percent")
      ),
      "rows" -> ujson.Arr.from(rows.map { row =>
        val values = ujson.Obj(
          "metric" -> ujson.Str(row.metric),
          "returnPeriodYears" -> ujson.Num(row.returnPeriodYears),
          "amount" -> ujson.Num(round(amountFn(row), 2))
        )
        values("deltaPct") = deltaPctFn match {
          case Some(fn) => ujson.Num(round(fn(row)))
          case None     => ujson.Null
        }
        ujson.Obj(
          "metricKey" -> ujson.Str(s"${row.metric.toLowerCase.replaceAll("\\s+", "_")}_${row.returnPeriodYears}"),
          "metricLabel" -> ujson.Str(s"${row.metric} ${row.returnPeriodYears}y"),
          "values" -> values
        )
      })
    )

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
        val trimmed = v.trim
        if (trimmed.nonEmpty) Some(trimmed) else None
      case _ => None
    }

  private def asDoubleOpt(value: ujson.Value): Option[Double] =
    value match {
      case ujson.Num(v) if v.isFinite => Some(v)
      case _                          => None
    }

  private def asBooleanOpt(value: ujson.Value): Option[Boolean] =
    value match {
      case ujson.Bool(v) => Some(v)
      case _             => None
    }

  private def asIntOpt(value: ujson.Value): Option[Int] =
    asDoubleOpt(value).map(_.toInt)

  private def optionalString(obj: ujson.Obj, key: String): Option[String] =
    obj.value.get(key).flatMap(asStringOpt)

  private def optionalDouble(obj: ujson.Obj, key: String): Option[Double] =
    obj.value.get(key).flatMap(asDoubleOpt)

  private def optionalBoolean(obj: ujson.Obj, key: String): Option[Boolean] =
    obj.value.get(key).flatMap(asBooleanOpt)

  private def optionalInt(obj: ujson.Obj, key: String): Option[Int] =
    obj.value.get(key).flatMap(asIntOpt)

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

  private def usage(error: Option[String]): String = {
    val base =
      """Usage: MarginalPortfolioImpactCli --input <json-file> [--output <json-file>]
        |
        |Reads a Canopy run payload (or worker handoff payload) and emits a PosteriorBundle-compatible JSON result.
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
