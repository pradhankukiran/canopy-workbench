package canopy.engine.property.ylt

import canopy.engine.property.Hurdat2PropertyCatPricingYltSimulator.EventLoss

import scala.util.Random

/** Phase 3.3 event perturbation.
  *
  * The event-level bootstrap draws from a pool of historical events,
  * but every draw returns the exact historical loss the portfolio
  * incurred for that storm. That under-represents the true spread of
  * "what if the same storm landed 50 km further west" scenarios.
  *
  * A full treatment would perturb the underlying track (landfall lat/
  * lon, central pressure, Rmax, translation speed, heading) and re-run
  * the hazard/vulnerability pipeline per sampled event. That's
  * ~100x more expensive than the bootstrap and is deferred; phase 3.3
  * ships a loss-level surrogate that captures the bulk of the uncertainty.
  *
  * The surrogate: multiply the event's losses by a mean-1 lognormal
  * draw. Specifically if X ~ N(0, sigma^2) the multiplier is
  *
  *     m = exp(-sigma^2 / 2 + sigma * X)
  *
  * which has E[m] = 1 exactly, so the expected loss of the simulated
  * catalog is unchanged but the tail has additional spread.
  *
  * Typical sigma = 0.30 produces a ~35% coefficient of variation on
  * individual event losses, consistent with the event-level spread in
  * validation studies of catastrophe models against historical claims.
  */
object EventPerturbation {

  def perturb(event: EventLoss, rng: Random, sigma: Double): EventLoss = {
    if (sigma <= 0d) return event
    val m = meanOneLognormal(rng, sigma)
    event.copy(
      grossLoss = event.grossLoss * m,
      cededLoss = event.cededLoss * m,
      netLoss = event.netLoss * m
    )
  }

  /** Draw from lognormal(mu = -sigma^2/2, sigma) so the mean of the
    * resulting variable is 1.0. */
  def meanOneLognormal(rng: Random, sigma: Double): Double = {
    if (sigma <= 0d) return 1d
    val z = rng.nextGaussian()
    math.exp(-0.5d * sigma * sigma + sigma * z)
  }
}
