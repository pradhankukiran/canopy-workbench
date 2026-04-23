package canopy.engine.property.ylt

import org.scalatest.funsuite.AnyFunSuite

import scala.util.Random

class FrequencyModelSpec extends AnyFunSuite {

  test("fitLambda returns the arithmetic mean of annual event counts") {
    assert(FrequencyModel.fitLambda(Vector(10, 12, 8, 11, 9)) == 10d)
    assert(FrequencyModel.fitLambda(Vector.empty) == 0d)
    assert(FrequencyModel.fitLambda(Vector(0)) == 0d)
  }

  test("poisson(0) always returns 0") {
    val rng = new Random(1)
    (1 to 100).foreach(_ => assert(FrequencyModel.poisson(0d, rng) == 0))
  }

  test("poisson(lambda) sample mean matches lambda within 5%") {
    val rng = new Random(42)
    val lambda = 8d
    val n = 10000
    val sum = (1 to n).map(_ => FrequencyModel.poisson(lambda, rng)).sum
    val sampleMean = sum.toDouble / n
    assert(math.abs(sampleMean - lambda) / lambda < 0.05d, s"sample mean $sampleMean far from $lambda")
  }

  test("poisson(lambda) sample variance is roughly lambda (equidispersion)") {
    val rng = new Random(42)
    val lambda = 8d
    val n = 10000
    val xs = (1 to n).map(_ => FrequencyModel.poisson(lambda, rng)).toArray
    val mean = xs.sum.toDouble / n
    val varSum = xs.foldLeft(0d)((acc, x) => acc + (x - mean) * (x - mean))
    val sampleVar = varSum / n
    assert(math.abs(sampleVar - lambda) / lambda < 0.10d, s"sample variance $sampleVar far from lambda $lambda")
  }

  test("seeded rng produces reproducible sequence") {
    val a = {
      val rng = new Random(7)
      (1 to 50).map(_ => FrequencyModel.poisson(5d, rng))
    }
    val b = {
      val rng = new Random(7)
      (1 to 50).map(_ => FrequencyModel.poisson(5d, rng))
    }
    assert(a == b)
  }
}
