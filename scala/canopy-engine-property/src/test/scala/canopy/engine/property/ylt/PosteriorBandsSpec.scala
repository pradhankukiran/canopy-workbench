package canopy.engine.property.ylt

import org.scalatest.funsuite.AnyFunSuite

import scala.util.Random

class PosteriorBandsSpec extends AnyFunSuite {

  private val losses: Vector[Double] = (1 to 500).map(i => i.toDouble).toVector

  test("bands collapse to deterministic quantile when no scale posterior is provided") {
    val rng = new Random(42)
    val bands = PosteriorBands.compute(
      annualLosses = losses,
      returnPeriodsYears = Vector(100),
      bootstrapSamples = 200,
      scalePosterior = None,
      rng = rng
    )
    val b = bands.head
    assert(b.mean > 0d)
    // Deterministic q99 is 500 * 0.99 = ~495. Bootstrap variance shrinks mean
    // slightly but the 5th percentile of the bootstrap shouldn't fall below
    // a reasonable floor.
    assert(b.p05 > 400d, s"p05 $b.p05 too low")
    assert(b.p95 > b.p05, s"p95 $b.p95 not above p05 $b.p05")
  }

  test("p05 <= mean <= p95 always") {
    val bands = PosteriorBands.compute(
      losses,
      Vector(10, 50, 100, 250),
      bootstrapSamples = 300,
      scalePosterior = Some(PosteriorBands.ScalePosterior(mean = 1.2d, sigma = 0.1d)),
      rng = new Random(7)
    )
    bands.foreach { b =>
      assert(b.p05 <= b.mean + 1e-6, s"p05 $b.p05 > mean ${b.mean}")
      assert(b.mean <= b.p95 + 1e-6, s"mean ${b.mean} > p95 ${b.p95}")
    }
  }

  test("applying a mean-greater-than-1 scale posterior shifts bands upward") {
    val rngA = new Random(11)
    val a = PosteriorBands.compute(losses, Vector(100), scalePosterior = None, rng = rngA)
    val rngB = new Random(11)
    val b = PosteriorBands.compute(
      losses,
      Vector(100),
      scalePosterior = Some(PosteriorBands.ScalePosterior(mean = 1.5d, sigma = 0.2d)),
      rng = rngB
    )
    assert(b.head.mean > a.head.mean * 1.2d, s"expected band mean to shift up with scale 1.5; a=${a.head.mean}, b=${b.head.mean}")
  }

  test("wider sigma widens the credible band at the same RP") {
    val lossesFlat = Vector.fill(500)(100d) // fixed series so spread is from scale only
    val tight = PosteriorBands.compute(
      lossesFlat,
      Vector(100),
      scalePosterior = Some(PosteriorBands.ScalePosterior(1d, 0.05d)),
      rng = new Random(1)
    ).head
    val wide = PosteriorBands.compute(
      lossesFlat,
      Vector(100),
      scalePosterior = Some(PosteriorBands.ScalePosterior(1d, 0.50d)),
      rng = new Random(1)
    ).head
    val tightWidth = tight.p95 - tight.p05
    val wideWidth = wide.p95 - wide.p05
    assert(wideWidth > tightWidth * 3, s"wider sigma should widen band; got ${tightWidth} vs ${wideWidth}")
  }

  test("monotonic band means in return period") {
    val bands = PosteriorBands.compute(
      losses,
      Vector(10, 50, 100, 250, 500),
      bootstrapSamples = 300,
      rng = new Random(3)
    )
    bands.sliding(2).filter(_.size == 2).foreach { case Seq(a, b) =>
      assert(b.mean >= a.mean - 1e-6, s"band mean not monotone in RP: ${a.returnPeriodYears}:${a.mean} -> ${b.returnPeriodYears}:${b.mean}")
    }
  }

  test("seeded rng produces reproducible bands") {
    val a = PosteriorBands.compute(losses, Vector(100, 250), rng = new Random(99))
    val b = PosteriorBands.compute(losses, Vector(100, 250), rng = new Random(99))
    assert(a == b)
  }

  test("empty inputs yield empty output") {
    assert(PosteriorBands.compute(Vector.empty, Vector(100)).isEmpty)
    assert(PosteriorBands.compute(losses, Vector.empty).isEmpty)
  }
}
