package canopy.engine.property.support

import ujson.Value

/** Tolerance-based structural comparison for engine outputs.
  *
  * Engine outputs are semi-deterministic JSON: most numbers should match
  * exactly under a fixed seed, but stochastic outputs (posterior bands,
  * distribution-sampled quantiles) need wiggle room. Exact `==` is too
  * brittle; unstructured text diffing is too loose.
  *
  * Usage:
  *
  *   val diff = GoldenCompare.diff(
  *     actual = ujson.read(actualJson),
  *     expected = ujson.read(goldenJson),
  *     tolerance = GoldenCompare.Tolerance.default
  *   )
  *   assert(diff.isEmpty, diff.mkString("
"))
  */
object GoldenCompare {

  final case class Tolerance(
      relative: Double = 1e-9,
      absolute: Double = 1e-12,
      ignoreKeys: Set[String] = Set.empty
  ) {
    def withIgnored(more: String*): Tolerance = copy(ignoreKeys = ignoreKeys ++ more)
    def relaxed(rel: Double, abs: Double): Tolerance =
      copy(relative = rel, absolute = abs)
  }

  object Tolerance {

    /** Default tolerance for deterministic phases. Floating-point jitter in
      * summation order can shift numbers at the 1e-12 level; tighter than
      * that is a false positive. */
    val default: Tolerance = Tolerance()

    /** For stochastic outputs where only summary statistics are stable.
      * Use in phases 3+ when event-level sampling introduces variance across
      * reasonable implementation choices. */
    val stochastic: Tolerance = Tolerance(relative = 1e-2, absolute = 1e-3)
  }

  /** Return a list of human-readable diff strings. Empty list = match. */
  def diff(actual: Value, expected: Value, tolerance: Tolerance): Seq[String] =
    diffAtPath(actual, expected, tolerance, path = "$")

  private def diffAtPath(
      actual: Value,
      expected: Value,
      t: Tolerance,
      path: String
  ): Seq[String] = (actual, expected) match {
    case (a: ujson.Obj, e: ujson.Obj) =>
      val keys = (a.value.keySet ++ e.value.keySet).diff(t.ignoreKeys)
      keys.toSeq.sorted.flatMap { key =>
        (a.value.get(key), e.value.get(key)) match {
          case (Some(av), Some(ev)) =>
            diffAtPath(av, ev, t, s"$path.$key")
          case (Some(_), None) =>
            Seq(s"$path.$key: present in actual, missing in expected")
          case (None, Some(_)) =>
            Seq(s"$path.$key: missing in actual, present in expected")
          case (None, None) => Seq.empty
        }
      }

    case (a: ujson.Arr, e: ujson.Arr) =>
      if (a.value.length != e.value.length)
        Seq(s"$path: length ${a.value.length} != ${e.value.length}")
      else
        a.value.zip(e.value).zipWithIndex.flatMap { case ((ai, ei), idx) =>
          diffAtPath(ai, ei, t, s"$path[$idx]")
        }.toSeq

    case (ujson.Num(an), ujson.Num(en)) =>
      if (numberEquals(an, en, t)) Seq.empty
      else
        Seq(
          f"$path: numeric drift actual=$an%.12g expected=$en%.12g (relTol=${t.relative}, absTol=${t.absolute})"
        )

    case (ujson.Str(as), ujson.Str(es)) =>
      if (as == es) Seq.empty else Seq(s"$path: string $as != $es")

    case (ujson.Bool(ab), ujson.Bool(eb)) =>
      if (ab == eb) Seq.empty else Seq(s"$path: bool $ab != $eb")

    case (ujson.Null, ujson.Null) => Seq.empty

    case _ =>
      Seq(s"$path: type mismatch actual=${kind(actual)} expected=${kind(expected)}")
  }

  private def numberEquals(a: Double, b: Double, t: Tolerance): Boolean = {
    if (a == b) return true
    if (a.isNaN || b.isNaN) return false
    if (a.isInfinite || b.isInfinite) return false
    val diff = math.abs(a - b)
    if (diff <= t.absolute) return true
    val scale = math.max(math.abs(a), math.abs(b))
    diff <= t.relative * scale
  }

  private def kind(v: Value): String = v match {
    case _: ujson.Obj  => "object"
    case _: ujson.Arr  => "array"
    case _: ujson.Num  => "number"
    case _: ujson.Str  => "string"
    case _: ujson.Bool => "bool"
    case ujson.Null    => "null"
  }

  /** Stable, normalized JSON rendering: sorted keys, fixed indent. Use this
    * when freezing a golden so textual diffs are meaningful. */
  def render(value: Value): String = {
    val sorted = normalize(value)
    ujson.write(sorted, indent = 2)
  }

  private def normalize(value: Value): Value = value match {
    case obj: ujson.Obj =>
      val entries = obj.value.toSeq.sortBy(_._1).map { case (k, v) => k -> normalize(v) }
      ujson.Obj.from(entries)
    case arr: ujson.Arr => ujson.Arr.from(arr.value.map(normalize))
    case other          => other
  }
}
