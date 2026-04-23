package canopy.engine.property.financial

import org.scalatest.funsuite.AnyFunSuite

class TechnicalPremiumSpec extends AnyFunSuite {

  private val uniformLosses = Vector(0d, 0d, 1e6, 2e6, 3e6, 0d, 500_000d, 1e6)

  test("pure loss equals sample mean") {
    val p = TechnicalPremium.priceLayer("L", uniformLosses, limit = 10e6, PremiumTerms())
    val expectedMean = uniformLosses.sum / uniformLosses.size
    assert(math.abs(p.pureLoss - expectedMean) < 1e-9)
  }

  test("additive risk load adds k * sigma") {
    val terms = PremiumTerms(riskLoadCoefficient = 0.5d, riskLoadShape = RiskLoadShape.Additive)
    val p = TechnicalPremium.priceLayer("L", uniformLosses, 10e6, terms)
    val expected = p.pureLoss + 0.5d * p.stdDevLoss
    assert(math.abs(p.riskLoadedPremium - expected) < 1e-9)
  }

  test("multiplicative risk load scales pure by (1 + k)") {
    val terms = PremiumTerms(riskLoadCoefficient = 0.25d, riskLoadShape = RiskLoadShape.Multiplicative)
    val p = TechnicalPremium.priceLayer("L", uniformLosses, 10e6, terms)
    val expected = p.pureLoss * 1.25d
    assert(math.abs(p.riskLoadedPremium - expected) < 1e-9)
  }

  test("brokerage is a fraction of gross premium, not of loaded") {
    val terms = PremiumTerms(brokerageRate = 0.10d, riskLoadCoefficient = 0d)
    val p = TechnicalPremium.priceLayer("L", uniformLosses, 10e6, terms)
    assert(math.abs(p.brokerage - p.grossTechnicalPremium * 0.10d) < 1e-9)
  }

  test("gross technical premium = loaded / (1 - brokerage - PC)") {
    val terms = PremiumTerms(
      brokerageRate = 0.05d,
      profitCommissionRate = 0.03d,
      riskLoadCoefficient = 0d
    )
    val p = TechnicalPremium.priceLayer("L", uniformLosses, 10e6, terms)
    val expectedGross = p.pureLoss / (1d - 0.05d - 0.03d)
    assert(math.abs(p.grossTechnicalPremium - expectedGross) < 1e-9)
  }

  test("rate-on-line = gross premium / limit") {
    val p = TechnicalPremium.priceLayer("L", uniformLosses, limit = 10e6, PremiumTerms())
    assert(math.abs(p.rateOnLine - p.grossTechnicalPremium / 10e6) < 1e-9)
  }

  test("empty loss vector yields zero pure loss without error") {
    val p = TechnicalPremium.priceLayer("L", Vector.empty, 10e6, PremiumTerms())
    assert(p.pureLoss == 0d)
    assert(p.stdDevLoss == 0d)
  }

  test("tvarCurve: TVaR >= quantile at same RP") {
    val losses = (1 to 1000).map(_.toDouble).toVector
    val curve = TechnicalPremium.tvarCurve(losses, Vector(10, 50, 100, 250))
    curve.foreach { case (rp, tvar) =>
      assert(tvar > 0d, s"RP $rp TVaR should be positive; got $tvar")
    }
    // TVaR should be monotonically non-decreasing in RP
    val values = curve.map(_._2)
    values.sliding(2).filter(_.size == 2).foreach { case Seq(a, b) =>
      assert(b >= a, s"TVaR not monotone: $a -> $b")
    }
  }

  test("priceTower emits one LayerPremium per layer, in order") {
    val l1 = Layer("L1", 10e6, 5e6)
    val l2 = Layer("L2", 20e6, 10e6)
    val tower = LayerTower(l1, l2)
    val outcomes = Vector(
      Vector(LayerYearOutcome(0, "L1", 2e6, true, false), LayerYearOutcome(1, "L2", 0d, false, false)),
      Vector(LayerYearOutcome(0, "L1", 5e6, true, true), LayerYearOutcome(1, "L2", 3e6, true, false))
    )
    val prems = TechnicalPremium.priceTower(tower, outcomes, PremiumTerms())
    assert(prems.size == 2)
    assert(prems(0).layerName == "L1")
    assert(prems(1).layerName == "L2")
    assert(math.abs(prems(0).pureLoss - 3.5e6) < 1e-9)
    assert(math.abs(prems(1).pureLoss - 1.5e6) < 1e-9)
  }
}
