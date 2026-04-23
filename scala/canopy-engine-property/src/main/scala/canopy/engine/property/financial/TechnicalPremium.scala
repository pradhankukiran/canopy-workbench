package canopy.engine.property.financial

/** Technical premium for a reinsurance layer or the overall program.
  *
  *   pureLoss             E[layer loss]  (the "fair" / actuarial mean)
  *   stdDevLoss           sigma(layer loss)
  *   riskLoadedPremium    pureLoss + k * sigma OR pureLoss * (1 + mu)
  *                        depending on `riskLoad` shape
  *   brokerage            off-the-top broker fee
  *   profitCommission     expected PC payout
  *   grossTechnicalPremium  the quoted premium the cedent would pay
  *   rateOnLine           grossTechnicalPremium / layer.limit
  *
  * Formula for grossTechnicalPremium when brokerage + PC are expressed
  * as percentages off the gross:
  *
  *   gross * (1 - brokerageRate - profitCommissionRate) = loaded
  *   => gross = loaded / (1 - brokerageRate - profitCommissionRate)
  *
  * with the denominator floored at 0.1 to avoid divide-by-zero when an
  * operator misconfigures excessive loads.
  */
final case class LayerPremium(
    layerName: String,
    pureLoss: Double,
    stdDevLoss: Double,
    riskLoadedPremium: Double,
    brokerage: Double,
    profitCommission: Double,
    grossTechnicalPremium: Double,
    rateOnLine: Double
)

/** Load shape for the risk load term.
  *
  *   Additive:        loaded = pure + coefficient * sigma
  *   Multiplicative:  loaded = pure * (1 + coefficient)
  */
sealed trait RiskLoadShape
object RiskLoadShape {
  case object Additive extends RiskLoadShape
  case object Multiplicative extends RiskLoadShape

  def fromString(s: String): RiskLoadShape = s.trim.toLowerCase match {
    case "multiplicative" | "mult" => Multiplicative
    case _                          => Additive
  }
}

final case class PremiumTerms(
    riskLoadShape: RiskLoadShape = RiskLoadShape.Additive,
    riskLoadCoefficient: Double = 0.25d,
    brokerageRate: Double = 0.05d,
    profitCommissionRate: Double = 0.0d
)

object TechnicalPremium {

  /** Price one layer given its annual losses across the simulated years. */
  def priceLayer(
      name: String,
      annualLosses: Vector[Double],
      limit: Double,
      terms: PremiumTerms
  ): LayerPremium = {
    val n = annualLosses.size.max(1)
    val pure = annualLosses.sum / n.toDouble
    val variance = annualLosses.iterator.map(v => math.pow(v - pure, 2d)).sum / n.toDouble
    val stddev = math.sqrt(variance)

    val loaded = terms.riskLoadShape match {
      case RiskLoadShape.Additive       => pure + terms.riskLoadCoefficient * stddev
      case RiskLoadShape.Multiplicative => pure * (1d + terms.riskLoadCoefficient)
    }

    val loadDenominator = math.max(0.1d, 1d - terms.brokerageRate - terms.profitCommissionRate)
    val gross = loaded / loadDenominator
    val brokerage = gross * terms.brokerageRate
    val pc = gross * terms.profitCommissionRate
    val rol = if (limit > 0d) gross / limit else 0d

    LayerPremium(
      layerName = name,
      pureLoss = pure,
      stdDevLoss = stddev,
      riskLoadedPremium = loaded,
      brokerage = brokerage,
      profitCommission = pc,
      grossTechnicalPremium = gross,
      rateOnLine = rol
    )
  }

  /** Price every layer in the tower. `perYearOutcomes` is outer-indexed
    * by simulated year and inner-indexed by layer, matching the shape
    * returned by LayerTower.runAll. */
  def priceTower(
      tower: LayerTower,
      perYearOutcomes: Vector[Vector[LayerYearOutcome]],
      terms: PremiumTerms
  ): Vector[LayerPremium] = {
    tower.layers.zipWithIndex.map { case (layer, idx) =>
      val losses = perYearOutcomes.map(yearOutcomes => yearOutcomes(idx).loss)
      priceLayer(layer.name, losses, layer.limit, terms)
    }
  }

  /** Compute TVaR at each configured return period. TVaR(p) is the mean
    * loss in the tail beyond the p-quantile (equivalently expected loss
    * given loss >= VaR(p)). */
  def tvarCurve(
      annualLosses: Vector[Double],
      returnPeriodsYears: Vector[Int]
  ): Vector[(Int, Double)] = {
    val sorted = annualLosses.sorted
    returnPeriodsYears.map { rp =>
      val p = 1d - (1d / rp.toDouble.max(1d))
      val varP = quantile(sorted, p)
      val tail = sorted.filter(_ >= varP)
      val tvar = if (tail.isEmpty) varP else tail.sum / tail.size.toDouble
      rp -> tvar
    }
  }

  private def quantile(sorted: Vector[Double], p: Double): Double = {
    if (sorted.isEmpty) return 0d
    val clamped = math.max(0d, math.min(1d, p))
    val pos = clamped * (sorted.size - 1).toDouble
    val lo = pos.toInt
    val hi = math.min(sorted.size - 1, lo + 1)
    val frac = pos - lo.toDouble
    if (hi == lo) sorted(lo) else sorted(lo) * (1d - frac) + sorted(hi) * frac
  }
}
