package canopy.engine.property.hazard

import org.scalatest.funsuite.AnyFunSuite

class OverlandDecaySpec extends AnyFunSuite {

  test("at t=0 wind equals R * V_0") {
    val v0 = 120d
    val decayed = OverlandDecay.decayedWindKt(v0, hoursSinceLandfall = 0d)
    val expected = OverlandDecay.LandfallReductionFactor * v0
    assert(math.abs(decayed - expected) < 0.1, s"expected $expected at t=0; got $decayed")
  }

  test("at large t wind asymptotes to V_b") {
    val v0 = 120d
    val decayed = OverlandDecay.decayedWindKt(v0, hoursSinceLandfall = 48d)
    assert(math.abs(decayed - OverlandDecay.BackgroundWindKt) < 1d, s"should asymptote to V_b ~ 26.7; got $decayed")
  }

  test("decay is monotonically non-increasing in time") {
    val v0 = 140d
    val times = Seq(0d, 3d, 6d, 12d, 24d, 48d)
    val winds = times.map(t => OverlandDecay.decayedWindKt(v0, t))
    winds.sliding(2).filter(_.size == 2).foreach { case Seq(a, b) =>
      assert(b <= a + 1e-9, s"non-monotonic decay: $a -> $b")
    }
  }

  test("zero V_max stays at zero") {
    assert(OverlandDecay.decayedWindKt(0d, 10d) == 0d)
  }

  test("small storms below V_b decay more slowly") {
    // Tropical storm (50 kt). R * V_0 = 45 kt > V_b = 26.7 kt, so decay
    // applies. At t=12 hr we should see something between.
    val decayed = OverlandDecay.decayedWindKt(50d, 12d)
    assert(decayed > OverlandDecay.BackgroundWindKt)
    assert(decayed < 50d)
  }

  test("filling formula: half-life roughly 7 hours") {
    // Half-life t_half = ln(2) / a ~ 7.3 hr for a=0.095.
    val v0 = 120d
    val start = 0.9d * v0
    val tHalf = math.log(2d) / OverlandDecay.DecayRatePerHour
    val midWind = OverlandDecay.decayedWindKt(v0, tHalf)
    val target = OverlandDecay.BackgroundWindKt + 0.5 * (start - OverlandDecay.BackgroundWindKt)
    assert(math.abs(midWind - target) < 1.0d, s"half-life check: at $tHalf hr expected ~$target; got $midWind")
  }
}
