package canopy.engine.property.ylt

import canopy.engine.property.Hurdat2PropertyCatPricingYltSimulator.{EventLoss, PricingParameters, SimulatedYearLoss}

import scala.util.Random

/** Event-level bootstrap. Each simulated year draws N ~ Poisson(lambda)
  * events sampled uniformly with replacement from the historical event
  * pool, then sums their contributions to build the year's gross / net /
  * ceded losses.
  *
  * Phase 3.1 replacement for the phase-1 "copy one historical year
  * wholesale" sampler. Key property: simulated years now have variable
  * event counts, and the AEP/OEP curves become genuine aggregate- vs
  * max-event quantiles instead of a flat 0.94 scale relation.
  *
  * Reproducibility: all draws come from the supplied `rng`, which the
  * simulator seeds from `params.randomSeed`.
  */
object EventBootstrap {

  /** Build `n` simulated years by drawing event counts from Poisson
    * and sampling events from the historical pool. Returns a vector
    * with one SimulatedYearLoss per year, each carrying the list of
    * events that contributed to its losses so downstream metrics can
    * compute per-event quantiles for the real OEP curve.
    */
  def simulate(
      historicalEvents: Vector[EventLoss],
      lambda: Double,
      numYears: Int,
      rng: Random,
      pp: PricingParameters = PricingParameters.default
  ): Vector[SimulatedYearLoss] = {
    if (historicalEvents.isEmpty || numYears <= 0) return Vector.empty

    val poolSize = historicalEvents.size
    Vector.tabulate(numYears) { idx =>
      val eventCount = FrequencyModel.poisson(lambda, rng)
      val events = Vector.tabulate(eventCount) { _ =>
        val raw = historicalEvents(rng.nextInt(poolSize))
        if (pp.useEventPerturbation) EventPerturbation.perturb(raw, rng, pp.eventPerturbationSigma) else raw
      }
      val grossLoss = events.iterator.map(_.grossLoss).sum
      val cededLoss = events.iterator.map(_.cededLoss).sum
      val netLoss = events.iterator.map(_.netLoss).sum
      val maxEventGross = events.iterator.map(_.grossLoss).maxOption.getOrElse(0d)
      val maxEventNet = events.iterator.map(_.netLoss).maxOption.getOrElse(0d)
      val maxEventCeded = events.iterator.map(_.cededLoss).maxOption.getOrElse(0d)

      SimulatedYearLoss(
        yearIndex = idx + 1,
        sourceYear = if (events.nonEmpty) events.head.sourceYear else 0,
        eventCount = eventCount,
        grossLoss = grossLoss,
        cededLoss = cededLoss,
        netLoss = netLoss,
        maxEventGrossLoss = maxEventGross,
        maxEventNetLoss = maxEventNet,
        maxEventCededLoss = maxEventCeded,
        eventNetLosses = events.map(_.netLoss)
      )
    }
  }
}
