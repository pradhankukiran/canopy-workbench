package canopy.engine.property.financial

import canopy.engine.property.Hurdat2PropertyCatPricingYltSimulator.{PropertyLocation, SimulatedYearLoss}
import scala.collection.immutable.Map

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

  /** Phase 3.6: per-peril ground-up losses + sublimits + per-peril
    * deductibles, summed and bounded by the site-level limit. Returns
    * (totalGroundUp, totalInsured) so the caller can compute ceded =
    * totalGroundUp - totalInsured.
    *
    * Pipeline per peril:
    *   cappedGross = min(groundUp, sublimit(peril))
    *   insured     = max(0, cappedGross - deductible(peril))
    * Site-wide:
    *   totalGross  = sum(cappedGross)
    *   totalInsured = min(siteLimit, sum(insured))
    *
    * Values in location.perilDeductibles / location.sublimits are
    * interpreted as fractions of TIV when in (0, 1] and as absolute
    * currency amounts otherwise. Missing peril keys fall back to the
    * site-level deductible / no sublimit respectively.
    */
  def applyPerilTerms(
      perilGroundLoss: Map[String, Double],
      loc: PropertyLocation
  ): (Double, Double) = {
    if (perilGroundLoss.isEmpty) return (0d, 0d)

    val contributions = perilGroundLoss.toVector.map { case (peril, gross) =>
      val perilKey = peril.trim.toUpperCase
      val cappedGross = math.min(math.max(0d, gross), resolveSublimit(perilKey, loc))
      val deductible = resolveDeductible(perilKey, loc)
      val insured = math.max(0d, cappedGross - deductible)
      (cappedGross, insured)
    }

    val totalGross = contributions.map(_._1).sum
    val rawInsured = contributions.map(_._2).sum
    val siteLimit = if (loc.limit > 0d) loc.limit else loc.tiv
    val totalInsured = math.min(siteLimit, rawInsured)
    (totalGross, totalInsured)
  }

  /** Resolve the effective deductible for a peril: per-peril override
    * if configured, else the site-level deductible. Fractional values
    * in (0, 1] are treated as % of TIV. Map keys are matched case-
    * insensitively so callers don't have to normalise. */
  private def resolveDeductible(perilKey: String, loc: PropertyLocation): Double = {
    val perPeril = findCaseInsensitive(loc.perilDeductibles, perilKey)
    val raw = perPeril.getOrElse(loc.deductible)
    toAbsolute(raw, loc.tiv)
  }

  /** Resolve the effective sublimit for a peril. When no override is
    * configured, returns TIV (effectively no sublimit). */
  private def resolveSublimit(perilKey: String, loc: PropertyLocation): Double = {
    findCaseInsensitive(loc.sublimits, perilKey).map(toAbsolute(_, loc.tiv)).getOrElse(loc.tiv)
  }

  private def findCaseInsensitive(map: Map[String, Double], key: String): Option[Double] = {
    val upper = key.trim.toUpperCase
    map.find { case (k, _) => k.trim.toUpperCase == upper }.map(_._2)
  }

  private def toAbsolute(value: Double, tiv: Double): Double = {
    if (value <= 0d) 0d
    else if (value <= 1d) value * tiv
    else value
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
