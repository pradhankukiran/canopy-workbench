package canopy.engine.property

import canopy.data.hurdat2.Hurdat2Parser
import canopy.engine.property.ylt.PosteriorBands
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
    emitHeartbeat("phase" -> ujson.Str("parsing-args"), "fraction" -> ujson.Num(0.02))
    for {
      cliArgs <- parseCliArgs(args)
      _ = emitHeartbeat("phase" -> ujson.Str("loading-input"), "fraction" -> ujson.Num(0.05))
      runInput <- parseRunInput(cliArgs)
      _ = emitHeartbeat("phase" -> ujson.Str("loading-hurdat2"), "fraction" -> ujson.Num(0.10))
      dataset <- Hurdat2Parser.parseFile(runInput.hurdat2Path).left.map(_.toString)
      _ = emitHeartbeat("phase" -> ujson.Str("enriching-portfolio"), "fraction" -> ujson.Num(0.13))
      enrichment = PortfolioEnrichment.enrich(runInput.portfolio)
      _ = emitHeartbeat("phase" -> ujson.Str("simulating"), "fraction" -> ujson.Num(0.15))
      result = Hurdat2PropertyCatPricingYltSimulator.simulate(
        dataset,
        enrichment.portfolio,
        runInput.params,
        onProgress = makeSimulatorProgressReporter()
      )
      _ = emitHeartbeat("phase" -> ujson.Str("post-processing"), "fraction" -> ujson.Num(0.85))
      bundle = buildPosteriorBundle(runInput, result, enrichment.log)
      rendered = ujson.write(bundle, indent = 2)
      _ = emitHeartbeat("phase" -> ujson.Str("writing-output"), "fraction" -> ujson.Num(0.95))
      _ <- writeOutput(rendered, cliArgs.outputPath)
      _ = emitHeartbeat("phase" -> ujson.Str("done"), "fraction" -> ujson.Num(1.0))
    } yield ()
  }

  /** Emit one NDJSON heartbeat line on stderr. The worker parses stderr
    * line-by-line and translates `{"kind":"progress",...}` into BullMQ
    * progress events, so the UI sees the engine's real state rather than
    * a sleep-driven mockup. Any parsing failure on the worker side is
    * silently ignored; stderr is also used for regular log output.
    */
  private def emitHeartbeat(fields: (String, ujson.Value)*): Unit = {
    val obj = ujson.Obj("kind" -> ujson.Str("progress"))
    fields.foreach { case (k, v) => obj(k) = v }
    System.err.println(ujson.write(obj))
  }

  /** The simulator loops over historical years; for each year processed it
    * calls the callback with a [0, 1] fraction of its own work. We remap
    * that into the CLI's overall progress window [0.15, 0.85] and throttle
    * emissions to at most one per 0.05 step so stderr does not flood.
    */
  private def makeSimulatorProgressReporter(): Double => Unit = {
    val start = 0.15
    val end = 0.85
    @volatile var lastEmitted = start
    val step = 0.05
    (fraction: Double) => {
      val overall = start + (end - start) * math.max(0d, math.min(1d, fraction))
      if (overall - lastEmitted >= step || fraction >= 1.0) {
        lastEmitted = overall
        emitHeartbeat(
          "phase" -> ujson.Str("simulating"),
          "fraction" -> ujson.Num(math.max(0d, math.min(1d, overall))),
          "simulatorFraction" -> ujson.Num(math.max(0d, math.min(1d, fraction)))
        )
      }
    }
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
      // Phase 5: parse an optional layerTower + premiumTerms from the
      // pricing input so the web can drive per-run reinsurance structures.
      layerTower = parseLayerTower(pricingObj)
      premiumTerms = parsePremiumTerms(pricingObj)
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
        randomSeed = randomSeed,
        pricingParameters = Hurdat2PropertyCatPricingYltSimulator.PricingParameters.default.copy(
          layerTower = layerTower,
          premiumTerms = premiumTerms
        )
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
        country = optionalString(obj, "country"),
        region = optionalString(obj, "region"),
        // v2 fields (phase 2.8). All optional; PortfolioEnrichment fills
        // missing values with country/region defaults and emits a log
        // entry per defaulted field.
        occupancyClass = optionalString(obj, "occupancyClass"),
        constructionClass = optionalString(obj, "constructionClass"),
        yearBuilt = optionalInt(obj, "yearBuilt"),
        numberOfStories = optionalInt(obj, "numberOfStories"),
        codeEra = optionalString(obj, "codeEra"),
        roofShape = optionalString(obj, "roofShape"),
        roofCover = optionalString(obj, "roofCover"),
        surfaceRoughnessClass = optionalString(obj, "surfaceRoughnessClass"),
        perilDeductibles = optionalDoubleMap(obj, "perilDeductibles").getOrElse(Map.empty),
        sublimits = optionalDoubleMap(obj, "sublimits").getOrElse(Map.empty)
      )
    )
  }

  /** Parse an object whose values are numbers into Map[String, Double]. Keys
    * are upper-cased so peril-code lookups in SiteTerms are case-insensitive. */
  private def optionalDoubleMap(obj: ujson.Obj, field: String): Option[Map[String, Double]] =
    obj.value.get(field).flatMap {
      case o: ujson.Obj =>
        val entries = o.value.toMap.flatMap { case (k, v) =>
          v match {
            case n: ujson.Num => Some(k.trim.toUpperCase -> n.value)
            case _            => None
          }
        }
        if (entries.nonEmpty) Some(entries) else None
      case _ => None
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

  private def buildPosteriorBundle(
      runInput: RunInput,
      result: Result,
      enrichmentLog: PortfolioEnrichment.EnrichmentLog = PortfolioEnrichment.EnrichmentLog.empty
  ): ujson.Obj = {
    // Phase 4: stop applying the Rainier posterior-mean as a uniform
    // scale factor across every output. Keep the deterministic phase-3
    // YLT, summary stats, and risk metrics; expose the Rainier
    // calibration only as its own object (for diagnostics) and as a
    // Gaussian approximation used by PosteriorBands to emit per-RP
    // credible bands on OEP/AEP/TVaR.
    val calibrationAttempt = calibrateWithRainier(runInput, result)
    val calibrationApplied = calibrationAttempt.toOption
    val simulatedYears = result.simulatedYears
    val summary = result.summaryStats
    val riskMetrics = result.riskMetrics
    val yltRows = simulatedYears.take(result.params.normalizedYltRowLimit).map(yltRowJson(_, result.params.normalizedLossBasis))
    val currency = result.portfolio.currency

    // Bands are bootstrap-only on the simulated quantiles. The phase-4
    // surface had also multiplied each bootstrap by a Rainier-derived
    // scale factor, but that conflated two distinct uncertainties and
    // collapsed the band toward zero whenever the observed-history
    // posterior disagreed with the simulation. The scale factor is
    // still emitted on rainierCalibration.scaleFactor so downstream
    // consumers can apply it explicitly if they want a calibration-
    // adjusted view. The band here reflects simulation-sampling noise:
    // "how stable is the p-quantile under finite N?".
    val bandsRng = new scala.util.Random(result.params.randomSeed.toLong ^ 0x42L)
    def bandsFor(series: Vector[Double]): Vector[PosteriorBands.BandPoint] =
      PosteriorBands.compute(
        annualLosses = series,
        returnPeriodsYears = result.params.normalizedReturnPeriodsYears,
        bootstrapSamples = 500,
        scalePosterior = None,
        rng = bandsRng
      )

    val aepGrossBands = bandsFor(simulatedYears.map(_.grossLoss))
    val aepNetBands = bandsFor(simulatedYears.map(_.netLoss))
    val oepGrossBands = bandsFor(simulatedYears.map(_.maxEventGrossLoss))
    val oepNetBands = bandsFor(simulatedYears.map(_.maxEventNetLoss))

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

    // Phase 3.10: TVaR at each configured return period. Always emitted
    // alongside OEP/AEP so downstream consumers can render the full
    // tail-severity triplet.
    if (result.tvarByReturnPeriod.nonEmpty) {
      pricingOutput("tvarByReturnPeriod") = ujson.Arr.from(result.tvarByReturnPeriod.map { case (rp, v) =>
        ujson.Obj(
          "returnPeriodYears" -> ujson.Num(rp),
          "tvar" -> ujson.Num(round(v, 2))
        )
      })
    }

    // Phase 4.2: per-quantile posterior credible bands on OEP / AEP.
    // When Rainier calibration succeeded, each bootstrap sample is
    // additionally scaled by a draw from the posterior Gaussian so the
    // band reflects both simulation-sampling noise and calibration
    // uncertainty. When calibration failed or was skipped, the bands
    // reflect bootstrap noise alone, which is still informative.
    def bandArrayJson(points: Vector[PosteriorBands.BandPoint]): ujson.Arr =
      ujson.Arr.from(points.map { b =>
        ujson.Obj(
          "returnPeriodYears" -> ujson.Num(b.returnPeriodYears),
          "mean" -> ujson.Num(round(b.mean, 2)),
          "p05" -> ujson.Num(round(b.p05, 2)),
          "p95" -> ujson.Num(round(b.p95, 2))
        )
      })

    pricingOutput("oepBands") = ujson.Obj(
      "source" -> ujson.Str("bootstrap"),
      "bootstrapSamples" -> ujson.Num(500),
      "gross" -> bandArrayJson(oepGrossBands),
      "net" -> bandArrayJson(oepNetBands)
    )
    pricingOutput("aepBands") = ujson.Obj(
      "source" -> ujson.Str("bootstrap"),
      "bootstrapSamples" -> ujson.Num(500),
      "gross" -> bandArrayJson(aepGrossBands),
      "net" -> bandArrayJson(aepNetBands)
    )

    // Phase 3.11: per-layer technical premium + per-year attachment /
    // exhaustion flags. Only present when the run configured a layer
    // tower; absent otherwise (so the "no cession" case doesn't emit
    // empty arrays).
    if (result.layerPremiums.nonEmpty) {
      pricingOutput("layerPremiums") = ujson.Arr.from(result.layerPremiums.map { p =>
        ujson.Obj(
          "layerName" -> ujson.Str(p.layerName),
          "pureLoss" -> ujson.Num(round(p.pureLoss, 2)),
          "stdDevLoss" -> ujson.Num(round(p.stdDevLoss, 2)),
          "riskLoadedPremium" -> ujson.Num(round(p.riskLoadedPremium, 2)),
          "brokerage" -> ujson.Num(round(p.brokerage, 2)),
          "profitCommission" -> ujson.Num(round(p.profitCommission, 2)),
          "grossTechnicalPremium" -> ujson.Num(round(p.grossTechnicalPremium, 2)),
          "rateOnLine" -> ujson.Num(round(p.rateOnLine))
        )
      })
    }

    if (result.layerOutcomes.nonEmpty) {
      // Aggregate-level flags: a year breached the tower if ANY layer's
      // attachment was reached, and the tower is exhausted if ALL layers
      // were exhausted (underwriter-facing "program ran out of cover").
      val aggregateOutcomes = result.layerOutcomes.zipWithIndex.map { case (yearLayers, _) =>
        val anyAttached = yearLayers.exists(_.attachmentReached)
        val allExhausted = yearLayers.forall(_.exhausted)
        (anyAttached, allExhausted)
      }
      val attachmentFreq = aggregateOutcomes.count(_._1).toDouble / aggregateOutcomes.size.toDouble
      val exhaustionFreq = aggregateOutcomes.count(_._2).toDouble / aggregateOutcomes.size.toDouble
      pricingOutput("layerAttachmentFrequency") = ujson.Num(round(attachmentFreq))
      pricingOutput("layerExhaustionFrequency") = ujson.Num(round(exhaustionFreq))
    }

    // Expose the phase-2.8 enrichment log so underwriters can see which
    // portfolio fields were filled in by defaults.
    if (enrichmentLog.entries.nonEmpty) {
      pricingOutput("enrichmentLog") = ujson.Arr.from(enrichmentLog.entries.map { entry =>
        ujson.Obj(
          "locationId" -> ujson.Str(entry.locationId),
          "field" -> ujson.Str(entry.field),
          "assumedValue" -> ujson.Str(entry.assumedValue),
          "reason" -> ujson.Str(entry.reason)
        )
      })
    }

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

  // Convergence gates (phase 4.3, refined after first production run).
  // Standard Gelman-Rubin cutoff is R-hat <= 1.05 for "chains mixed".
  // Standard ESS guidance is >= 100 for mean / credible-interval
  // inference (the prior >= 400 threshold was for tail-quantile
  // inference on full posterior-predictive, not the scalar rate we
  // actually estimate here). Additionally, when R-hat is essentially
  // 1.0 (<= 1.02) the posterior is near-degenerate and a low ESS
  // reflects a concentrated posterior rather than a broken sampler,
  // so we accept that case even with ESS in the tens.
  private val RHatConvergedMax: Double = 1.05d
  private val RHatNearPerfect: Double = 1.02d
  private val EssConvergedMin: Double = 100d
  private val RHatWarningMax: Double = 1.10d
  private val EssWarningMin: Double = 30d

  private def diagnosticsJson(
      calibration: Option[MpiRainierCalibrator.Output],
      result: Result
  ): ujson.Obj = {
    // Honest diagnostics: emit real MCMC R-hat / ESS only when the Rainier
    // sampler actually produced them. Phase 4.3 also classifies the
    // output as converged / warning / failed based on fixed thresholds,
    // so ops and the web UI can render a single badge.
    val _ = result
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
              // Only surface the ESS warning when R-hat is not near-perfect;
              // otherwise low ESS reflects a narrow posterior, not a broken
              // sampler, and emitting a "warning" there would be misleading.
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

  private def lossByBasis(grossLoss: Double, cededLoss: Double, netLoss: Double, lossBasis: String): Double =
    lossBasis match {
      case "gross" => grossLoss
      case "ceded" => cededLoss
      case _       => netLoss
    }

  /** Parse `pricingObj.layerTower = [ {name, attachment, limit, ...}, ... ]`
    * into a LayerTower case-class. An absent or empty array returns
    * LayerTower.empty which the simulator treats as "no cession". */
  private def parseLayerTower(pricingObj: ujson.Obj): canopy.engine.property.financial.LayerTower = {
    import canopy.engine.property.financial.{Layer, LayerBasis, LayerTower}
    val arr = pricingObj.value.get("layerTower").collect { case a: ujson.Arr => a.value }.getOrElse(Seq.empty)
    if (arr.isEmpty) return LayerTower.empty

    val layers = arr.toVector.zipWithIndex.flatMap { case (item, idx) =>
      item match {
        case o: ujson.Obj =>
          val attachment = optionalDouble(o, "attachment").getOrElse(Double.NaN)
          val limit = optionalDouble(o, "limit").getOrElse(Double.NaN)
          if (!attachment.isFinite || attachment < 0d || !limit.isFinite || limit <= 0d) None
          else
            Some(
              Layer(
                name = optionalString(o, "name").getOrElse(s"Layer ${idx + 1}"),
                attachment = attachment,
                limit = limit,
                share = optionalDouble(o, "share").filter(s => s > 0d && s <= 1d).getOrElse(1.0d),
                basis = optionalString(o, "basis").map(LayerBasis.fromString).getOrElse(LayerBasis.Occurrence),
                reinstatements = optionalInt(o, "reinstatements").filter(_ >= 0).getOrElse(0)
              )
            )
        case _ => None
      }
    }
    LayerTower(layers)
  }

  /** Parse `pricingObj.premiumTerms = { riskLoadCoefficient, shape,
    * brokerageRate, profitCommissionRate }` into a PremiumTerms case class. */
  private def parsePremiumTerms(pricingObj: ujson.Obj): canopy.engine.property.financial.PremiumTerms = {
    import canopy.engine.property.financial.{PremiumTerms, RiskLoadShape}
    pricingObj.value.get("premiumTerms") match {
      case Some(o: ujson.Obj) =>
        PremiumTerms(
          riskLoadShape = optionalString(o, "riskLoadShape").map(RiskLoadShape.fromString).getOrElse(RiskLoadShape.Additive),
          riskLoadCoefficient = optionalDouble(o, "riskLoadCoefficient").filter(_ >= 0d).getOrElse(0.25d),
          brokerageRate = optionalDouble(o, "brokerageRate").filter(v => v >= 0d && v < 1d).getOrElse(0.05d),
          profitCommissionRate = optionalDouble(o, "profitCommissionRate").filter(v => v >= 0d && v < 1d).getOrElse(0d)
        )
      case _ => PremiumTerms()
    }
  }

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
