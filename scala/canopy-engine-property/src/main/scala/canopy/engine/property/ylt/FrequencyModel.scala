package canopy.engine.property.ylt

import scala.util.Random

/** Poisson frequency model for tropical cyclones per simulated year.
  *
  * Fit the rate lambda (expected events per year) from a historical
  * catalog of annual event counts. Sampling draws N ~ Poisson(lambda)
  * via Knuth's algorithm - simple and O(lambda) per draw, fine for
  * typical Atlantic-basin rates (~10 events per year).
  *
  * For basins where the Poisson dispersion is wrong (some seasons are
  * clearly clustered), a negative-binomial or state-dependent model
  * is the next step. Phase 3.4 (deferred) adds that when justified.
  */
object FrequencyModel {

  /** Fit lambda as the arithmetic mean of annual event counts. */
  def fitLambda(annualEventCounts: Vector[Int]): Double = {
    if (annualEventCounts.isEmpty) 0d
    else annualEventCounts.map(_.toDouble).sum / annualEventCounts.size.toDouble
  }

  /** Draw one Poisson(lambda) sample via Knuth 1969. */
  def poisson(lambda: Double, rng: Random): Int = {
    if (lambda <= 0d) return 0
    val L = math.exp(-lambda)
    var k = 0
    var p = 1d
    while (p > L) {
      k += 1
      p *= rng.nextDouble()
    }
    k - 1
  }
}
