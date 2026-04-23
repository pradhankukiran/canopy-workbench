package canopy.engine.trigger

import canopy.data.hurdat2.Hurdat2Parser
import canopy.inference.rainier.MpiRainierCalibrator

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path, Paths}
import java.time.Instant

import scala.util.Try

object Hurdat2IlsTriggerCli {
  private final case class CliArgs(inputPath: Path, outputPath: Option[Path], hurdat2Override: Option[Path])

  private final case class RunInput(
      runId: String,
      workspaceId: Option[String],
      hurdat2Path: Path,
      params: Hurdat2IlsParametricTriggerSimulator.Params,
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
      result = Hurdat2IlsParametricTriggerSimulator.simulate(dataset, runInput.params)
      bundleJson = buildPosteriorBundle(runInput, result)
      rendered = ujson.write(bundleJson, indent = 2)
      _ <- writeOutput(rendered, cliArgs.outputPath)
    } yield ()
  }

  private def parseCliArgs(args: Array[String]): Either[String, CliArgs] = {
    var input: Option[Path] = None
    var output: Option[Path] = None
    var hurdat2: Option[Path] = None
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
            case Left(err) => return Left(usage(err))
            case Right(v)  => input = Some(Paths.get(v))
          }
        case "-o" | "--output" =>
          requireValue(args(idx)) match {
            case Left(err) => return Left(usage(err))
            case Right(v)  => output = Some(Paths.get(v))
          }
        case "--hurdat2" =>
          requireValue(args(idx)) match {
            case Left(err) => return Left(usage(err))
            case Right(v)  => hurdat2 = Some(Paths.get(v))
          }
        case "-h" | "--help" =>
          return Left(usage(None))
        case other =>
          return Left(usage(s"unknown argument: $other"))
      }
      idx += 1
    }

    input match {
      case Some(path) => Right(CliArgs(path, output, hurdat2))
      case None       => Left(usage("missing required --input <json-file>"))
    }
  }

  private def parseRunInput(cliArgs: CliArgs): Either[String, RunInput] = {
    val inputPath = cliArgs.inputPath.toAbsolutePath.normalize()
    val inputDir = Option(inputPath.getParent).getOrElse(Paths.get(".").toAbsolutePath.normalize())
    val text =
      Try(new String(Files.readAllBytes(inputPath), StandardCharsets.UTF_8))
        .toEither
        .left
        .map(ex => s"failed to read ${inputPath}: ${ex.getMessage}")
    for {
      rawText <- text
      root <- Try(ujson.read(rawText)).toEither.left.map(ex => s"invalid JSON in ${inputPath}: ${ex.getMessage}")
      rootObj <- asObj(root, "input root")
      runId <- requiredString(rootObj, "runId")
      workspaceId = optionalString(rootObj, "workspaceId")
      engineProfile = optionalString(rootObj, "engineProfile")
      randomSeed = optionalInt(rootObj, "randomSeed").getOrElse(42)
      currency = optionalString(rootObj, "currency").getOrElse("USD")
      hurdat2PathString = cliArgs.hurdat2Override.map(_.toString).orElse(optionalString(rootObj, "hurdat2Path"))
      hurdat2Path = resolvePath(hurdat2PathString.getOrElse("test-data/hurdat2/sample_atlantic_subset.hurdat2"), inputDir)
      ilsObj <- locateIlsParams(rootObj)
      attachment = optionalDouble(ilsObj, "attachmentThreshold").getOrElse(74d)
      exhaustion = optionalDouble(ilsObj, "exhaustionThreshold").getOrElse(attachment + 30d)
      params = Hurdat2IlsParametricTriggerSimulator.Params(
        triggerIndexName = optionalString(ilsObj, "triggerIndexName").getOrElse("maxWindKt"),
        regionCode = optionalString(ilsObj, "regionCode").getOrElse("GLOBAL"),
        perilCode = optionalString(ilsObj, "perilCode").getOrElse("TC"),
        attachmentThreshold = attachment,
        exhaustionThreshold = exhaustion,
        payoutCurve = optionalString(ilsObj, "payoutCurve").getOrElse("linear"),
        simulationCount = optionalInt(ilsObj, "simulationCount").getOrElse(1000),
        includeEventLevelOutcomes = optionalBoolean(ilsObj, "includeEventLevelOutcomes").getOrElse(false),
        notional = optionalDouble(ilsObj, "notional").orElse(optionalDouble(rootObj, "notional")).getOrElse(1000000d),
        currency = optionalString(ilsObj, "currency").getOrElse(currency),
        randomSeed = randomSeed
      )
    } yield RunInput(
      runId = runId,
      workspaceId = workspaceId,
      hurdat2Path = hurdat2Path,
      params = params,
      engineProfile = engineProfile
    )
  }

  private def locateIlsParams(rootObj: ujson.Obj): Either[String, ujson.Obj] = {
    val moduleParams = rootObj.value.get("moduleParameters").flatMap(asObjOpt)
    val candidates = Vector(
      moduleParams.flatMap(_.value.get("ilsParametricTrigger")).flatMap(asObjOpt),
      moduleParams.flatMap(_.value.get("ilsParametricTriggerSimulator")).flatMap(asObjOpt),
      moduleParams.flatMap(_.value.get("parametricTriggerSimulation")).flatMap(asObjOpt),
      rootObj.value.get("ilsParametricTrigger").flatMap(asObjOpt),
      rootObj.value.get("ilsParametricTriggerSimulator").flatMap(asObjOpt),
      rootObj.value.get("ilsParams").flatMap(asObjOpt)
    ).flatten

    candidates.headOption.toRight(
      "missing ILS parameters: expected one of moduleParameters.ilsParametricTrigger, moduleParameters.ilsParametricTriggerSimulator, ilsParametricTrigger, or ilsParams"
    )
  }

  private def buildPosteriorBundle(
      runInput: RunInput,
      result: Hurdat2IlsParametricTriggerSimulator.Result
  ): ujson.Obj = {
    // Phase-4-style: stop multiplying every output by a uniform
    // Rainier scale factor. That approach inflated per-event payouts
    // above the bond's notional when the Gaussian approximation of the
    // posterior exceeded 1.0, and collapsed them toward zero when it
    // was below 1.0 - neither is a valid reinsurance cash flow. Keep
    // the deterministic simulator output as the quoted numbers; emit
    // the calibration's scale factor on rainierCalibration.scaleFactor
    // only, so downstream consumers can apply a calibration-adjusted
    // view explicitly if they want one.
    val calibrationAttempt = calibrateWithRainier(runInput, result)
    val calibrationApplied = calibrationAttempt.toOption
    val scaledHistoricalYears = result.historicalYears
    val scaledSimulatedYears = result.simulatedYears
    val scaledHistoricalEvents = result.historicalEvents
    val risk = result.riskMetrics
    val triggerModuleOutput = ujson.Obj(
      "currency" -> ujson.Str(result.params.normalizedCurrency),
      "triggerMetric" -> ujson.Str("maxWindKt"),
      "triggerIndexName" -> ujson.Str(result.params.triggerIndexName),
      "regionCode" -> ujson.Str(result.params.regionCode),
      "perilCode" -> ujson.Str(result.params.perilCode),
      "attachmentThreshold" -> ujson.Num(round(result.params.normalizedAttachmentThreshold)),
      "exhaustionThreshold" -> ujson.Num(round(result.params.normalizedExhaustionThreshold)),
      "payoutCurve" -> ujson.Str(result.params.normalizedPayoutCurve),
      "notional" -> ujson.Num(round(result.params.normalizedNotional, 2)),
      "historicalYearCount" -> ujson.Num(result.historicalYearCount),
      "simulationCount" -> ujson.Num(scaledSimulatedYears.size),
      "annualTriggerProbability" -> ujson.Num(round(risk.attachmentProbability)),
      "annualExhaustionProbability" -> ujson.Num(round(risk.exhaustionProbability)),
      "expectedPayout" -> ujson.Num(round(risk.expectedLoss, 2)),
      "triggerSimulation" -> ujson.Arr.from(scaledSimulatedYears.map(simulatedYearJson)),
      "historicalYearOutcomes" -> ujson.Arr.from(scaledHistoricalYears.map(historicalYearJson)),
      "triggerSummaryTable" -> triggerSummaryTableJson(result, risk)
    )
    triggerModuleOutput("rainierCalibration") = rainierCalibrationJson(runInput, calibrationAttempt)

    if (result.params.includeEventLevelOutcomes) {
      triggerModuleOutput("historicalStormEvents") = ujson.Arr.from(scaledHistoricalEvents.map(stormEventJson))
    }

    val moduleOutputs = ujson.Obj("ilsParametricTrigger" -> triggerModuleOutput)

    val bundle = ujson.Obj(
      "runId" -> ujson.Str(runInput.runId),
      "generatedAt" -> ujson.Str(Instant.now().toString),
      "modelVersion" ->
        ujson.Str(
          calibrationApplied match {
            case Some(_) => "canopy-engine-trigger-hurdat2-v1+rainier"
            case None    => "canopy-engine-trigger-hurdat2-v1"
          }
        ),
      "priorVersion" ->
        ujson.Str(
          calibrationApplied match {
            case Some(_) => "rainier-ils-payout-rate-logit-normal-v1"
            case None    => "deterministic-ils-priors-v1"
          }
        ),
      "posteriorSampleCount" ->
        ujson.Num(calibrationApplied.map(_.posteriorSampleCount.toDouble).getOrElse(scaledSimulatedYears.size.toDouble)),
      "riskMetrics" -> riskMetricsJson(risk),
      "yearOutcomes" -> ujson.Arr.from(scaledSimulatedYears.map(yearOutcomeJson)),
      "moduleOutputs" -> moduleOutputs,
      "diagnostics" -> diagnosticsJson(calibrationApplied, scaledSimulatedYears.size)
    )

    runInput.workspaceId.foreach(ws => bundle("workspaceId") = ujson.Str(ws))
    bundle
  }

  private def calibrateWithRainier(
      runInput: RunInput,
      result: Hurdat2IlsParametricTriggerSimulator.Result
  ): Either[MpiRainierCalibrator.CalibrationFailure, MpiRainierCalibrator.Output] = {
    val observedHistoricalRates =
      result.historicalYears.map(year => clamp01(year.annualPayoutAmount / result.params.normalizedNotional))
    val observedRates =
      if (observedHistoricalRates.size >= 4) observedHistoricalRates
      else result.simulatedYears.map(year => clamp01(year.payoutAmount / result.params.normalizedNotional))

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

  // Convergence gates mirror the Pricing engine (phase 4.3). R-hat is
  // the primary convergence indicator; ESS gates the precision of
  // posterior statistics. Low ESS with near-perfect R-hat reflects a
  // concentrated posterior, not a broken sampler, so we accept that
  // case at a lower ESS bar.
  private val RHatConvergedMax: Double = 1.05d
  private val RHatNearPerfect: Double = 1.02d
  private val EssConvergedMin: Double = 100d
  private val RHatWarningMax: Double = 1.10d
  private val EssWarningMin: Double = 30d

  private def diagnosticsJson(
      calibration: Option[MpiRainierCalibrator.Output],
      @annotation.unused fallbackSampleCount: Int
  ): ujson.Obj =
    calibration match {
      case Some(output) =>
        output.diagnostics match {
          case Some(d) =>
            val chainsMixed = d.rHatMax <= RHatConvergedMax
            val essOk = d.essMin >= EssConvergedMin
            val rhatNearPerfect = d.rHatMax <= RHatNearPerfect
            val status =
              if (chainsMixed && (essOk || rhatNearPerfect)) "converged"
              else if (d.rHatMax <= RHatWarningMax && d.essMin >= EssWarningMin) "warning"
              else "failed"
            val warnings = Vector(
              if (!chainsMixed) Some(f"R-hat ${d.rHatMax}%.3f exceeds ${RHatConvergedMax}") else None,
              if (!essOk && !rhatNearPerfect)
                Some(f"ESS ${d.essMin}%.0f below ${EssConvergedMin}%.0f") else None
            ).flatten
            val obj = ujson.Obj(
              "status" -> ujson.Str(status),
              "rHatMax" -> ujson.Num(round(d.rHatMax)),
              "rHatThreshold" -> ujson.Num(RHatConvergedMax),
              "essMin" -> ujson.Num(round(d.essMin, 2)),
              "essThreshold" -> ujson.Num(EssConvergedMin),
              "source" -> ujson.Str("rainier-mcmc")
            )
            if (rhatNearPerfect && !essOk) {
              obj("note") = ujson.Str(
                "R-hat near 1.0 with low ESS typically indicates a narrow, concentrated posterior rather than a sampling problem."
              )
            }
            if (warnings.nonEmpty) {
              obj("warnings") = ujson.Arr.from(warnings.map(ujson.Str(_)))
            }
            obj
          case None =>
            ujson.Obj(
              "status" -> ujson.Str("no_mcmc_diagnostics"),
              "reason" -> ujson.Str(
                "Rainier calibration ran a non-MCMC path so no R-hat/ESS are available."
              )
            )
        }
      case None =>
        ujson.Obj(
          "status" -> ujson.Str("skipped"),
          "reason" -> ujson.Str(
            "Rainier calibration was not applied for this run."
          )
        )
    }

  // scaleStormEvents / scaleHistoricalYears / scaleSimulatedYears /
  // scaleRiskMetrics / scaleReturnPeriodPoint were removed. They applied
  // a uniform Rainier scale factor to every output - the same phase-1
  // shortcut that the Pricing engine carried and that was fixed in
  // f51bf20. In the Trigger module the bug was particularly visible
  // because the scale multiplied per-event payouts, which caused
  // individual years to report payoutAmount > notional.

  private def riskMetricsJson(risk: Hurdat2IlsParametricTriggerSimulator.RiskMetrics): ujson.Obj =
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

  private def returnPeriodPointJson(
      point: Hurdat2IlsParametricTriggerSimulator.ReturnPeriodPoint
  ): ujson.Obj =
    ujson.Obj(
      "returnPeriodYears" -> ujson.Num(point.returnPeriodYears),
      "grossLoss" -> ujson.Num(round(point.grossLoss, 2)),
      "netLoss" -> ujson.Num(round(point.netLoss, 2)),
      "bondPayout" -> ujson.Num(round(point.bondPayout, 2))
    )

  private def yearOutcomeJson(
      row: Hurdat2IlsParametricTriggerSimulator.SimulatedYearOutcome
  ): ujson.Obj = {
    val obj = ujson.Obj(
      "yearIndex" -> ujson.Num(row.yearIndex),
      "eventCount" -> ujson.Num(row.eventCount),
      "aggregateGrossLoss" -> ujson.Num(round(row.payoutAmount, 2)),
      "aggregateCededLoss" -> ujson.Num(round(row.payoutAmount, 2)),
      "aggregateNetLoss" -> ujson.Num(round(row.payoutAmount, 2)),
      "bondExhausted" -> ujson.Bool(row.exhausted)
    )
    obj
  }

  private def simulatedYearJson(
      row: Hurdat2IlsParametricTriggerSimulator.SimulatedYearOutcome
  ): ujson.Obj = {
    val obj = ujson.Obj(
      "yearIndex" -> ujson.Num(row.yearIndex),
      "sourceYear" -> ujson.Num(row.sourceYear),
      "eventCount" -> ujson.Num(row.eventCount),
      "triggeredEventCount" -> ujson.Num(row.triggeredEventCount),
      "annualMaxWindKt" -> ujson.Num(row.annualMaxWindKt),
      "payoutPct" -> ujson.Num(round(row.payoutPct)),
      "payoutAmount" -> ujson.Num(round(row.payoutAmount, 2)),
      "triggered" -> ujson.Bool(row.triggered),
      "exhausted" -> ujson.Bool(row.exhausted)
    )
    if (row.sourceEvents.nonEmpty) {
      obj("events") = ujson.Arr.from(row.sourceEvents.map(stormEventJson))
    }
    obj
  }

  private def historicalYearJson(
      row: Hurdat2IlsParametricTriggerSimulator.HistoricalYearSummary
  ): ujson.Obj =
    ujson.Obj(
      "sourceYear" -> ujson.Num(row.sourceYear),
      "eventCount" -> ujson.Num(row.eventCount),
      "triggeredEventCount" -> ujson.Num(row.triggeredEventCount),
      "annualMaxWindKt" -> ujson.Num(row.annualMaxWindKt),
      "payoutPct" -> ujson.Num(round(row.annualPayoutPct)),
      "payoutAmount" -> ujson.Num(round(row.annualPayoutAmount, 2)),
      "triggered" -> ujson.Bool(row.triggered),
      "exhausted" -> ujson.Bool(row.exhausted)
    )

  private def stormEventJson(
      event: Hurdat2IlsParametricTriggerSimulator.StormTriggerEvent
  ): ujson.Obj =
    ujson.Obj(
      "stormId" -> ujson.Str(event.stormId),
      "stormName" -> ujson.Str(event.stormName),
      "basin" -> ujson.Str(event.basin),
      "sourceYear" -> ujson.Num(event.sourceYear),
      "trackDate" -> ujson.Str(event.trackDate),
      "trackTime" -> ujson.Str(event.trackTime),
      "status" -> ujson.Str(event.status),
      "latitude" -> ujson.Num(round(event.latitude)),
      "longitude" -> ujson.Num(round(event.longitude)),
      "maxWindKt" -> ujson.Num(event.maxWindKt),
      "payoutPct" -> ujson.Num(round(event.payoutPct)),
      "payoutAmount" -> ujson.Num(round(event.payoutAmount, 2)),
      "triggered" -> ujson.Bool(event.triggered),
      "exhausted" -> ujson.Bool(event.exhausted)
    )

  private def triggerSummaryTableJson(
      result: Hurdat2IlsParametricTriggerSimulator.Result,
      risk: Hurdat2IlsParametricTriggerSimulator.RiskMetrics
  ): ujson.Obj = {
    val columns = ujson.Arr(
      ujson.Obj("key" -> "metric", "label" -> "Metric"),
      ujson.Obj("key" -> "value", "label" -> "Value")
    )

    val rows = ujson.Arr(
      summaryRow("historicalYears", "Historical years", ujson.Num(result.historicalYearCount)),
      summaryRow("simulationCount", "Simulation count", ujson.Num(result.simulatedYears.size)),
      summaryRow("annualTriggerProbability", "Annual trigger probability", ujson.Num(round(risk.attachmentProbability))),
      summaryRow("annualExhaustionProbability", "Annual exhaustion probability", ujson.Num(round(risk.exhaustionProbability))),
      summaryRow("expectedPayout", "Expected annual payout", ujson.Num(round(risk.expectedLoss, 2))),
      summaryRow("attachmentThreshold", "Attachment threshold (kt)", ujson.Num(round(result.params.normalizedAttachmentThreshold))),
      summaryRow("exhaustionThreshold", "Exhaustion threshold (kt)", ujson.Num(round(result.params.normalizedExhaustionThreshold)))
    )

    ujson.Obj(
      "tableId" -> ujson.Str("ils-parametric-trigger-summary"),
      "title" -> ujson.Str("ILS Parametric Trigger Summary"),
      "columns" -> columns,
      "rows" -> rows
    )
  }

  private def summaryRow(rowKey: String, rowLabel: String, value: ujson.Value): ujson.Obj =
    ujson.Obj(
      "rowKey" -> ujson.Str(rowKey),
      "rowLabel" -> ujson.Str(rowLabel),
      "values" -> ujson.Obj(
        "metric" -> ujson.Str(rowLabel),
        "value" -> value
      )
    )

  private def writeOutput(rendered: String, outputPath: Option[Path]): Either[String, Unit] =
    outputPath match {
      case None =>
        println(rendered)
        Right(())
      case Some(path) =>
        val target = path.toAbsolutePath.normalize()
        Try {
          Option(target.getParent).foreach(Files.createDirectories(_))
          Files.write(target, (rendered + System.lineSeparator()).getBytes(StandardCharsets.UTF_8))
          ()
        }.toEither.left.map(ex => s"failed to write ${target}: ${ex.getMessage}")
    }

  private def usage(error: String): String =
    s"""$error
       |Usage: canopy-engine-trigger HURDAT2 ILS simulator
       |  --input, -i   Path to JSON run input (required)
       |  --output, -o  Path to write PosteriorBundle JSON (optional; default stdout)
       |  --hurdat2     Path to HURDAT2 file (optional; overrides JSON hurdat2Path)
       |""".stripMargin

  private def usage(maybeError: Option[String]): String =
    maybeError match {
      case Some(error) => usage(error)
      case None        => usage("help")
    }

  private def resolvePath(raw: String, baseDir: Path): Path = {
    val path = Paths.get(raw)
    if (path.isAbsolute) path.normalize() else baseDir.resolve(path).normalize()
  }

  private def asObj(value: ujson.Value, context: String): Either[String, ujson.Obj] =
    value match {
      case obj: ujson.Obj => Right(obj)
      case _              => Left(s"$context must be a JSON object")
    }

  private def asObjOpt(value: ujson.Value): Option[ujson.Obj] =
    value match {
      case obj: ujson.Obj => Some(obj)
      case _              => None
    }

  private def requiredString(obj: ujson.Obj, key: String): Either[String, String] =
    optionalString(obj, key).filter(_.nonEmpty).toRight(s"missing required string field '$key'")

  private def optionalString(obj: ujson.Obj, key: String): Option[String] =
    obj.value.get(key).flatMap {
      case ujson.Str(value) => Some(value)
      case _                => None
    }

  private def optionalBoolean(obj: ujson.Obj, key: String): Option[Boolean] =
    obj.value.get(key).flatMap {
      case ujson.Bool(value) => Some(value)
      case _                 => None
    }

  private def optionalInt(obj: ujson.Obj, key: String): Option[Int] =
    obj.value.get(key).flatMap {
      case ujson.Num(value) => Some(value.toInt)
      case _                => None
    }

  private def optionalDouble(obj: ujson.Obj, key: String): Option[Double] =
    obj.value.get(key).flatMap {
      case ujson.Num(value) => Some(value)
      case _                => None
    }

  private def clamp01(value: Double): Double =
    math.max(0d, math.min(1d, value))

  private def round(value: Double, scale: Int = 6): Double = {
    val factor = math.pow(10d, scale.toDouble)
    math.round(value * factor).toDouble / factor
  }
}
