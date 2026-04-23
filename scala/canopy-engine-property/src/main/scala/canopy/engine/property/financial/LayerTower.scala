package canopy.engine.property.financial

/** Layer tower for reinsurance cession. A tower is an ordered list of
  * layers; each simulated year's per-event net losses flow through each
  * layer in isolation (layers are independent cessions, not stacked).
  *
  * Phase 3.7 implementation scope:
  *   - Attachment point + layer width
  *   - Cedent share (0-1)
  *   - Occurrence vs Aggregate basis
  *   - Paid + free reinstatements (reinstatement count = total capacity
  *     multiplier above the initial layer)
  *   - Annual layer capacity = (reinstatements + 1) * limit
  *   - Tracks attachment / exhaustion flags per year per layer
  *
  * What's intentionally NOT in this phase:
  *   - Hours clauses / event definition nuances
  *   - Quota-share interactions with excess-of-loss layers
  *   - Non-concentric tower structures
  *   - Reinstatement premium calculation (lands in TechnicalPremium)
  *
  * Semantics:
  *
  *   Occurrence layer:
  *     For each event e in year y:
  *       layerLoss_e = share * min(limit, max(0, e - attachment))
  *     Year cession, pre-reinstatement cap:
  *       annualLoss = sum over events (layerLoss_e)
  *     After reinstatement capacity:
  *       annualLossCapped = min(annualLoss, share * limit * (reinstatements + 1))
  *
  *   Aggregate layer:
  *     annualLoss = share * min(limit, max(0, sum(e_i) - attachment))
  *     Reinstatements do not apply to aggregate layers in this phase.
  */

sealed trait LayerBasis
object LayerBasis {
  case object Occurrence extends LayerBasis
  case object Aggregate extends LayerBasis

  def fromString(s: String): LayerBasis = s.trim.toLowerCase match {
    case "aggregate" | "agg" => Aggregate
    case _                    => Occurrence
  }
}

final case class Layer(
    name: String,
    attachment: Double,
    limit: Double,
    share: Double = 1.0d,
    basis: LayerBasis = LayerBasis.Occurrence,
    reinstatements: Int = 0
) {
  require(attachment >= 0d, s"attachment must be non-negative; got $attachment")
  require(limit > 0d, s"limit must be positive; got $limit")
  require(share > 0d && share <= 1d, s"share must be in (0, 1]; got $share")
  require(reinstatements >= 0, s"reinstatements must be non-negative; got $reinstatements")
}

final case class LayerYearOutcome(
    layerIndex: Int,
    layerName: String,
    loss: Double,
    attachmentReached: Boolean,
    exhausted: Boolean
)

final case class LayerTower(layers: Vector[Layer]) {
  val isEmpty: Boolean = layers.isEmpty
}

object LayerTower {
  val empty: LayerTower = LayerTower(Vector.empty)

  def apply(layers: Layer*): LayerTower = LayerTower(layers.toVector)

  /** Apply the tower to one simulated year's per-event net losses.
    * Returns a LayerYearOutcome per configured layer. */
  def runYear(tower: LayerTower, eventNetLosses: Vector[Double]): Vector[LayerYearOutcome] = {
    tower.layers.zipWithIndex.map { case (layer, idx) =>
      val outcome = applyLayer(layer, eventNetLosses)
      LayerYearOutcome(idx, layer.name, outcome._1, outcome._2, outcome._3)
    }
  }

  /** Apply the tower to many simulated years, returning a Vector[Vector[…]].
    * The outer index is the year, matching the caller's simulatedYears
    * index; the inner index is the layer. */
  def runAll(tower: LayerTower, perYearEventLosses: Vector[Vector[Double]]): Vector[Vector[LayerYearOutcome]] =
    perYearEventLosses.map(runYear(tower, _))

  /** (annualLoss, attachmentReached, exhausted) for a single layer in a
    * single year. */
  private def applyLayer(layer: Layer, eventNetLosses: Vector[Double]): (Double, Boolean, Boolean) = {
    val aggregateGross = eventNetLosses.sum
    val annualLoss = layer.basis match {
      case LayerBasis.Occurrence =>
        val perEvent = eventNetLosses.map { e =>
          math.min(layer.limit, math.max(0d, e - layer.attachment))
        }
        val raw = perEvent.sum
        val capacity = layer.limit * (layer.reinstatements + 1).toDouble
        math.min(raw, capacity) * layer.share
      case LayerBasis.Aggregate =>
        val inLayer = math.min(layer.limit, math.max(0d, aggregateGross - layer.attachment))
        inLayer * layer.share
    }
    val capacityForFlag = layer.basis match {
      case LayerBasis.Occurrence => layer.limit * (layer.reinstatements + 1).toDouble * layer.share
      case LayerBasis.Aggregate => layer.limit * layer.share
    }
    val attachmentReached = annualLoss > 0d
    val exhausted = annualLoss >= capacityForFlag - 1e-9
    (annualLoss, attachmentReached, exhausted)
  }
}
