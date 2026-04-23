package canopy.engine.property.ylt

import scala.util.Random

/** Bootstrap-based per-quantile posterior credible bands on OEP / AEP /
  * TVaR.
  *
  * Phase 4 replaces the phase-1 "multiply everything by one posterior-mean
  * scale" trick. The scalar approach shifted the mean of every quantile by
  * the same factor, hiding both (a) the simulation's own sampling noise
  * (how tight is the 100-yr quantile on 200 simulated years?) and (b) the
  * calibration uncertainty (how hard does Rainier pull toward the
  * observed history?).
  *
  * The new method produces, for each (returnPeriodYears, loss_series)
  * combination, a triple:
  *
  *     {mean, p05, p95}
  *
  * by resampling the simulated years B times with replacement and, for
  * each bootstrap, drawing a scale factor from the Rainier posterior's
  * Gaussian approximation (mean, stddev) when a calibration is available.
  * The empirical distribution of the bootstrap * scale product is the
  * credible band.
  *
  * When no Rainier calibration is provided (`scalePosterior = None`) the
  * band collapses to pure simulation-sampling uncertainty, which is
  * still useful: the width of the band tells the underwriter how much
  * the RP loss would wobble across different 200-year catalogs.
  */
object PosteriorBands {

  final case class BandPoint(returnPeriodYears: Int, mean: Double, p05: Double, p95: Double)

  /** Summary statistics of a Gaussian posterior over the calibration
    * scale factor. When `sigma` is 0 or negative, every sample = mean. */
  final case class ScalePosterior(mean: Double, sigma: Double)

  /** Compute bands for a vector of return periods over a single loss
    * series (e.g. per-year gross aggregate loss).
    *
    * @param annualLosses    one value per simulated year; the quantile
    *                        distribution of interest
    * @param returnPeriodsYears e.g. Vector(10, 50, 100, 250)
    * @param bootstrapSamples number of bootstrap resamples (default 500)
    * @param scalePosterior  Gaussian approx of the Rainier scale posterior
    * @param rng             seeded RNG so bands are reproducible
    */
  def compute(
      annualLosses: Vector[Double],
      returnPeriodsYears: Vector[Int],
      bootstrapSamples: Int = 500,
      scalePosterior: Option[ScalePosterior] = None,
      rng: Random = new Random(0L)
  ): Vector[BandPoint] = {
    if (annualLosses.isEmpty || returnPeriodsYears.isEmpty) return Vector.empty

    val n = annualLosses.size
    // For each bootstrap b and each RP: quantile of the resampled series
    // scaled by the drawn posterior factor.
    val allSamples: Vector[Array[Double]] = Vector.tabulate(bootstrapSamples) { _ =>
      val resampled = Array.fill(n)(annualLosses(rng.nextInt(n)))
      java.util.Arrays.sort(resampled)
      val scale = scalePosterior match {
        case Some(sp) if sp.sigma > 0d => math.max(0d, sp.mean + sp.sigma * rng.nextGaussian())
        case Some(sp)                  => math.max(0d, sp.mean)
        case None                      => 1d
      }
      returnPeriodsYears.map { rp =>
        val p = 1d - (1d / rp.toDouble.max(1d))
        quantileFromSorted(resampled, p) * scale
      }.toArray
    }

    // Collect per-RP columns across all bootstraps and compute summary stats.
    returnPeriodsYears.zipWithIndex.map { case (rp, idx) =>
      val col = allSamples.map(_(idx)).toArray
      java.util.Arrays.sort(col)
      val mean = col.sum / col.length.toDouble
      val p05 = quantileFromSorted(col, 0.05d)
      val p95 = quantileFromSorted(col, 0.95d)
      BandPoint(rp, mean, p05, p95)
    }
  }

  private def quantileFromSorted(sorted: Array[Double], p: Double): Double = {
    if (sorted.length == 0) return 0d
    val clamped = math.max(0d, math.min(1d, p))
    val pos = clamped * (sorted.length - 1).toDouble
    val lo = pos.toInt
    val hi = math.min(sorted.length - 1, lo + 1)
    val frac = pos - lo.toDouble
    if (hi == lo) sorted(lo) else sorted(lo) * (1d - frac) + sorted(hi) * frac
  }
}
