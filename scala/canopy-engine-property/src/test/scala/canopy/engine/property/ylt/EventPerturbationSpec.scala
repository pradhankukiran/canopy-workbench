package canopy.engine.property.ylt

import canopy.engine.property.Hurdat2PropertyCatPricingYltSimulator.EventLoss
import org.scalatest.funsuite.AnyFunSuite

import scala.util.Random

class EventPerturbationSpec extends AnyFunSuite {

  private def baseEvent(gross: Double): EventLoss = EventLoss(
    stormId = "AL012005",
    stormName = "TEST",
    sourceYear = 2005,
    eventCountContribution = 1,
    grossLoss = gross,
    cededLoss = gross * 0.2d,
    netLoss = gross * 0.8d,
    peakStormWindKt = 120,
    peakSiteWindKt = 100d
  )

  test("mean-1 lognormal has expected value 1 over many draws") {
    val rng = new Random(42)
    val sigma = 0.30d
    val n = 50000
    val sum = (1 to n).foldLeft(0d)((acc, _) => acc + EventPerturbation.meanOneLognormal(rng, sigma))
    val mean = sum / n
    assert(math.abs(mean - 1d) < 0.02d, s"sample mean $mean far from 1")
  }

  test("perturbation preserves gross/net/ceded ratios") {
    val rng = new Random(1)
    val e = baseEvent(1_000_000d)
    val perturbed = EventPerturbation.perturb(e, rng, 0.30d)
    val gratio = perturbed.grossLoss / e.grossLoss
    assert(math.abs(perturbed.netLoss / e.netLoss - gratio) < 1e-9)
    assert(math.abs(perturbed.cededLoss / e.cededLoss - gratio) < 1e-9)
  }

  test("sigma=0 returns the input unchanged") {
    val rng = new Random(1)
    val e = baseEvent(1_000_000d)
    val perturbed = EventPerturbation.perturb(e, rng, 0d)
    assert(perturbed == e)
  }

  test("perturbation widens the distribution around the mean") {
    val rng = new Random(2)
    val e = baseEvent(1_000_000d)
    val xs = (1 to 2000).map(_ => EventPerturbation.perturb(e, rng, 0.30d).grossLoss)
    val max = xs.max
    val min = xs.min
    assert(max > 1_300_000d, s"expected max > 1.3M at sigma=0.3; got $max")
    assert(min < 700_000d, s"expected min < 700k at sigma=0.3; got $min")
  }

  test("seeded RNG produces reproducible perturbations") {
    val e = baseEvent(1_000_000d)
    val a = {
      val rng = new Random(9)
      (1 to 20).map(_ => EventPerturbation.perturb(e, rng, 0.25d).grossLoss)
    }
    val b = {
      val rng = new Random(9)
      (1 to 20).map(_ => EventPerturbation.perturb(e, rng, 0.25d).grossLoss)
    }
    assert(a == b)
  }

  test("perturbed events never produce negative losses") {
    val rng = new Random(3)
    val e = baseEvent(100_000d)
    (1 to 1000).foreach { _ =>
      val p = EventPerturbation.perturb(e, rng, 0.6d)
      assert(p.grossLoss >= 0d)
      assert(p.netLoss >= 0d)
      assert(p.cededLoss >= 0d)
    }
  }
}
