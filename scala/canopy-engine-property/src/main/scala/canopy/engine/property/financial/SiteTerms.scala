package canopy.engine.property.financial

import canopy.engine.property.Hurdat2PropertyCatPricingYltSimulator.{PropertyLocation, SimulatedYearLoss}

/** Site-level financial terms: the first stage of the financial pipeline.
  *
  * Phase 1 baseline: one deductible + one limit applied to ground-up loss.
  * Phase 2.8 reads per-peril deductibles and sublimits from the v2 schema
  * (still within this module). Phase 3 adds a separate LayerTower module
  * for occurrence/aggregate reinsurance structures on top of site terms.
  */
object SiteTerms {

  /** Apply the site's deductible and limit to a ground-up loss, returning the
    * insured (net-of-deductible-capped-by-limit) amount. If the portfolio
    * didn't specify a limit we default to the TIV so the insured cannot
    * exceed the total value at risk. */
  def modeledInsuredLoss(loc: PropertyLocation, groundUpLoss: Double): Double = {
    if (groundUpLoss <= 0d) return 0d
    val deductible = math.max(0d, loc.deductible)
    val limit = math.max(0d, if (loc.limit > 0d) loc.limit else loc.tiv)
    math.min(limit, math.max(0d, groundUpLoss - deductible))
  }

  /** Pick the configured loss basis off a tuple of gross/ceded/net values. */
  def selectedBasisValue(lossBasis: String, gross: Double, ceded: Double, net: Double): Double =
    lossBasis match {
      case "gross" => gross
      case "ceded" => ceded
      case _       => net
    }

  /** Column extraction for a vector of simulated years. */
  def basisLosses(rows: Vector[SimulatedYearLoss], lossBasis: String): Vector[Double] =
    lossBasis match {
      case "gross" => rows.map(_.grossLoss)
      case "ceded" => rows.map(_.cededLoss)
      case _       => rows.map(_.netLoss)
    }
}
