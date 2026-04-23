package canopy.engine.property.financial

import org.scalatest.funsuite.AnyFunSuite

class LayerTowerSpec extends AnyFunSuite {

  private val layer10xs40 = Layer(name = "10M xs 40M", attachment = 40e6, limit = 10e6)

  test("occurrence layer captures single large event above attachment") {
    val events = Vector(5e6, 42e6, 3e6) // only the 42M event breaches attachment
    val outcomes = LayerTower.runYear(LayerTower(layer10xs40), events)
    // 42M - 40M = 2M in layer; layer loss = 2M
    assert(outcomes.head.loss == 2e6)
    assert(outcomes.head.attachmentReached)
    assert(!outcomes.head.exhausted)
  }

  test("occurrence layer aggregates multiple hits within limit") {
    val events = Vector(45e6, 48e6)
    val outcomes = LayerTower.runYear(LayerTower(layer10xs40), events)
    // Event 1: min(10M, 45M-40M) = 5M
    // Event 2: min(10M, 48M-40M) = 8M
    // Year total = 13M but limit*1 = 10M; capped.
    assert(outcomes.head.loss == 10e6)
    assert(outcomes.head.exhausted)
  }

  test("reinstatements expand annual capacity") {
    val events = Vector(45e6, 48e6, 52e6)
    val layer = layer10xs40.copy(reinstatements = 2)
    val outcomes = LayerTower.runYear(LayerTower(layer), events)
    // Per event: 5M, 8M, 10M. Sum 23M. Capacity = 10M * (2+1) = 30M.
    assert(outcomes.head.loss == 23e6)
    assert(!outcomes.head.exhausted)
  }

  test("aggregate layer attaches to year total") {
    val agg = Layer("agg 20M xs 30M", attachment = 30e6, limit = 20e6, basis = LayerBasis.Aggregate)
    val events = Vector(10e6, 15e6, 25e6) // sum = 50M
    val outcomes = LayerTower.runYear(LayerTower(agg), events)
    // agg - attachment = 50 - 30 = 20; min(limit=20, 20) = 20M
    assert(outcomes.head.loss == 20e6)
    assert(outcomes.head.exhausted)
  }

  test("share reduces cedent take") {
    val half = layer10xs40.copy(share = 0.5d)
    val events = Vector(50e6)
    val outcomes = LayerTower.runYear(LayerTower(half), events)
    // In-layer = 10M * 0.5 share = 5M.
    assert(outcomes.head.loss == 5e6)
    // exhausted check uses capacity*share = 10M*0.5 = 5M; 5M >= 5M so exhausted.
    assert(outcomes.head.exhausted)
  }

  test("empty tower yields no outcomes") {
    val outcomes = LayerTower.runYear(LayerTower.empty, Vector(10e6, 20e6))
    assert(outcomes.isEmpty)
  }

  test("zero-loss year hits no layers") {
    val outcomes = LayerTower.runYear(LayerTower(layer10xs40), Vector.empty)
    assert(outcomes.head.loss == 0d)
    assert(!outcomes.head.attachmentReached)
  }

  test("tower with multiple independent layers computes each") {
    val l1 = Layer("L1 5 xs 10", attachment = 10e6, limit = 5e6)
    val l2 = Layer("L2 10 xs 20", attachment = 20e6, limit = 10e6)
    val l3 = Layer("L3 20 xs 40", attachment = 40e6, limit = 20e6)
    val events = Vector(35e6)
    val outcomes = LayerTower.runYear(LayerTower(l1, l2, l3), events)
    // 35M: L1 captures 5M (saturated), L2 captures 10M (saturated), L3 captures 0.
    assert(outcomes(0).loss == 5e6)
    assert(outcomes(0).exhausted)
    assert(outcomes(1).loss == 10e6)
    assert(outcomes(1).exhausted)
    assert(outcomes(2).loss == 0d)
    assert(!outcomes(2).attachmentReached)
  }

  test("reject zero or negative limit at construction") {
    assertThrows[IllegalArgumentException](Layer("bad", attachment = 10e6, limit = 0d))
    assertThrows[IllegalArgumentException](Layer("bad", attachment = 10e6, limit = -1d))
  }

  test("reject share outside (0, 1]") {
    assertThrows[IllegalArgumentException](Layer("bad", 10e6, 10e6, share = 0d))
    assertThrows[IllegalArgumentException](Layer("bad", 10e6, 10e6, share = 1.1d))
  }
}
