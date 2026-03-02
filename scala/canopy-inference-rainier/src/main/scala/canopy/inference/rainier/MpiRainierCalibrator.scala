package canopy.inference.rainier

import com.stripe.rainier.compute._
import com.stripe.rainier.core._
import com.stripe.rainier.sampler._

import scala.util.control.NonFatal

object MpiRainierCalibrator {
  final case class Config(
      warmupIterations: Int,
      iterations: Int,
      nChains: Int,
      priorLogitStdDev: Double
  )

  final case class Input(
      baseExpectedLossRate: Double,
      observedAnnualLossRates: Vector[Double],
      randomSeed: Int,
      engineProfile: String
  )

  final case class DiagnosticsSummary(
      rHatMax: Double,
      essMin: Double
  )

  final case class Output(
      posteriorMeanRate: Double,
      posteriorMedianRate: Double,
      posteriorP05Rate: Double,
      posteriorP95Rate: Double,
      posteriorStdDevRate: Double,
      posteriorSampleCount: Int,
      diagnostics: Option[DiagnosticsSummary],
      mapRate: Option[Double],
      deterministicBaseRate: Double,
      observedRateCount: Int
  ) {
    def scaleFactor: Double =
      if (deterministicBaseRate <= 0d) 1d
      else posteriorMeanRate / deterministicBaseRate
  }

  final case class CalibrationFailure(message: String, cause: Option[String] = None) {
    override def toString: String =
      cause match {
        case Some(value) if value.nonEmpty => s"$message ($value)"
        case _                             => message
      }
  }

  def calibrate(input: Input): Either[CalibrationFailure, Output] = {
    val baseRate = clampRate(input.baseExpectedLossRate)
    val observedRates = input.observedAnnualLossRates.map(clampRate).filter(v => v > 0d && v < 1d)

    if (observedRates.size < 4) {
      return Left(CalibrationFailure("not enough observed annual loss rates for Rainier calibration"))
    }

    val cfg = configForEngineProfile(input.engineProfile)
    val priorMeanLogit = logit(baseRate)
    val observedLogits = observedRates.map(logit)

    try {
      implicit val rng: RNG = SeededRng(input.randomSeed)
      implicit val progress: Progress = SilentProgress

      val mu = Normal(priorMeanLogit, cfg.priorLogitStdDev).latent
      val sigma = Exponential(20.0).latent
      val model = Model.observe(observedLogits, Normal(mu, sigma))

      val trace = model.sample(EHMC(cfg.warmupIterations, cfg.iterations), cfg.nChains)
      val posteriorRates =
        trace
          .predict(mu.logistic)
          .iterator
          .flatMap(value => asFiniteDouble(value))
          .map(value => clampRate(value))
          .toVector

      if (posteriorRates.isEmpty) {
        Left(CalibrationFailure("Rainier returned no posterior samples"))
      } else {
        val sorted = posteriorRates.sorted
        val mean = posteriorRates.sum / posteriorRates.size.toDouble
        val variance =
          posteriorRates.iterator.map(v => math.pow(v - mean, 2d)).sum / posteriorRates.size.toDouble
        val diagnostics =
          try {
            val ds = trace.diagnostics
            if (ds.nonEmpty) {
              Some(
                DiagnosticsSummary(
                  rHatMax = ds.iterator.map(_.rHat).max,
                  essMin = ds.iterator.map(_.effectiveSampleSize).min
                )
              )
            } else None
          } catch {
            case NonFatal(_) => None
          }

        val mapRate =
          try {
            Some(clampRate(asFiniteDouble(model.optimize(mu.logistic)).getOrElse(mean)))
          } catch {
            case NonFatal(_) => None
          }

        Right(
          Output(
            posteriorMeanRate = mean,
            posteriorMedianRate = quantile(sorted, 0.50d),
            posteriorP05Rate = quantile(sorted, 0.05d),
            posteriorP95Rate = quantile(sorted, 0.95d),
            posteriorStdDevRate = math.sqrt(variance),
            posteriorSampleCount = posteriorRates.size,
            diagnostics = diagnostics,
            mapRate = mapRate,
            deterministicBaseRate = baseRate,
            observedRateCount = observedRates.size
          )
        )
      }
    } catch {
      case NonFatal(ex) =>
        Left(CalibrationFailure("Rainier calibration failed", Some(ex.getMessage)))
    }
  }

  private def configForEngineProfile(engineProfile: String): Config =
    Option(engineProfile).map(_.trim.toLowerCase) match {
      case Some("fast") =>
        Config(warmupIterations = 30, iterations = 40, nChains = 2, priorLogitStdDev = 1.2d)
      case Some("full") =>
        Config(warmupIterations = 100, iterations = 120, nChains = 4, priorLogitStdDev = 1.0d)
      case _ =>
        Config(warmupIterations = 60, iterations = 80, nChains = 2, priorLogitStdDev = 1.0d)
    }

  private final case class SeededRng(seed: Int) extends RNG {
    private val random = new scala.util.Random(seed.toLong)
    override def standardUniform: Double = random.nextDouble()
    override def standardNormal: Double = random.nextGaussian()
  }

  private def asFiniteDouble(value: Any): Option[Double] =
    value match {
      case d: Double if d.isFinite => Some(d)
      case f: Float if f.isFinite  => Some(f.toDouble)
      case i: Int                  => Some(i.toDouble)
      case l: Long                 => Some(l.toDouble)
      case _                       => None
    }

  private def clampRate(rate: Double): Double =
    math.max(1e-6d, math.min(1d - 1e-6d, if (rate.isFinite) rate else 1e-6d))

  private def logit(p: Double): Double = {
    val x = clampRate(p)
    math.log(x / (1d - x))
  }

  private def quantile(sorted: Vector[Double], p: Double): Double = {
    if (sorted.isEmpty) return 0d
    val q = math.max(0d, math.min(1d, p))
    val pos = q * (sorted.size - 1).toDouble
    val lo = pos.toInt
    val hi = math.min(sorted.size - 1, lo + 1)
    val frac = pos - lo.toDouble
    if (lo == hi) sorted(lo)
    else sorted(lo) * (1d - frac) + sorted(hi) * frac
  }
}
