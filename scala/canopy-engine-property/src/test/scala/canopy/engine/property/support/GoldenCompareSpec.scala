package canopy.engine.property.support

import org.scalatest.funsuite.AnyFunSuite

class GoldenCompareSpec extends AnyFunSuite {
  import GoldenCompare.Tolerance

  test("identical JSON objects produce no diff") {
    val a = ujson.read("""{"b": 1, "a": 2.0, "c": "x"}""")
    val b = ujson.read("""{"a": 2.0, "b": 1, "c": "x"}""")
    assert(GoldenCompare.diff(a, b, Tolerance.default).isEmpty)
  }

  test("numeric drift within relative tolerance is ignored") {
    val a = ujson.read("""{"ep": 123456789.0}""")
    val b = ujson.read("""{"ep": 123456789.000001}""")
    assert(GoldenCompare.diff(a, b, Tolerance.default).isEmpty)
  }

  test("numeric drift past relative tolerance is reported") {
    val a = ujson.read("""{"ep": 100.0}""")
    val b = ujson.read("""{"ep": 101.0}""")
    val diffs = GoldenCompare.diff(a, b, Tolerance.default)
    assert(diffs.nonEmpty)
    assert(diffs.head.contains("numeric drift"))
  }

  test("numeric drift inside absolute tolerance but outside relative is accepted near zero") {
    val a = ujson.read("""{"x": 0.0}""")
    val b = ujson.read("""{"x": 1e-13}""")
    assert(GoldenCompare.diff(a, b, Tolerance.default).isEmpty)
  }

  test("missing keys are reported with a path") {
    val a = ujson.read("""{"riskMetrics": {"oep": [1, 2]}}""")
    val b = ujson.read("""{"riskMetrics": {"oep": [1, 2], "tvar99": 42}}""")
    val diffs = GoldenCompare.diff(a, b, Tolerance.default)
    assert(diffs.exists(_.contains("$.riskMetrics.tvar99")))
  }

  test("ignored keys skip deep comparison") {
    val a = ujson.read("""{"generatedAt": "2026-04-23", "value": 1}""")
    val b = ujson.read("""{"generatedAt": "2026-04-30", "value": 1}""")
    val t = Tolerance.default.withIgnored("generatedAt")
    assert(GoldenCompare.diff(a, b, t).isEmpty)
  }

  test("array length mismatch is reported") {
    val a = ujson.read("""[1, 2, 3]""")
    val b = ujson.read("""[1, 2]""")
    val diffs = GoldenCompare.diff(a, b, Tolerance.default)
    assert(diffs.head.contains("length"))
  }

  test("type mismatches are reported") {
    val a = ujson.read("""{"x": 1}""")
    val b = ujson.read("""{"x": "one"}""")
    val diffs = GoldenCompare.diff(a, b, Tolerance.default)
    assert(diffs.head.contains("type mismatch"))
  }

  test("stochastic tolerance accepts larger relative drift") {
    val a = ujson.read("""{"p99": 1000.0}""")
    val b = ujson.read("""{"p99": 1005.0}""")
    assert(GoldenCompare.diff(a, b, Tolerance.stochastic).isEmpty)
  }

  test("render produces sorted-key normalized JSON") {
    val v = ujson.read("""{"b": 1, "a": {"z": 1, "y": 2}}""")
    val rendered = GoldenCompare.render(v)
    assert(rendered.indexOf("\"a\"") < rendered.indexOf("\"b\""))
    assert(rendered.indexOf("\"y\"") < rendered.indexOf("\"z\""))
  }
}
