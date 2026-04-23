package canopy.engine.property.hazard

import org.scalatest.funsuite.AnyFunSuite

/** Verify that the Schwerdt translation-speed correction produces the
  * expected right-of-track bias in the northern hemisphere (and the
  * mirror bias in the southern hemisphere), and that missing heading or
  * speed data short-circuits to zero.
  */
class TranslationAsymmetrySpec extends AnyFunSuite {

  private val k = 0.55d
  private val stormLat = 28d
  private val stormLon = -92d

  /** A north-moving storm at (28N, 92W) and a site due east of it: the
    * site lies right of the track, so the asymmetry should boost its
    * wind by +k * V_trans. */
  test("NH northward-moving storm: site to the east gets the full positive boost") {
    val adj = TranslationAsymmetry.adjustment(
      stormLatDeg = stormLat,
      stormLonDeg = stormLon,
      headingDeg = Some(0d), // due north
      translationSpeed = Some(10d),
      siteLatDeg = stormLat,
      siteLonDeg = stormLon + 1d, // due east
      k = k
    )
    assert(math.abs(adj - k * 10d) < 0.5d, s"NH east of storm should see +$k*10; got $adj")
  }

  /** Site west of a north-moving storm is to the left of the track and
    * should see the mirror reduction. */
  test("NH northward-moving storm: site to the west sees a negative adjustment") {
    val adj = TranslationAsymmetry.adjustment(
      stormLatDeg = stormLat,
      stormLonDeg = stormLon,
      headingDeg = Some(0d),
      translationSpeed = Some(10d),
      siteLatDeg = stormLat,
      siteLonDeg = stormLon - 1d, // due west
      k = k
    )
    assert(adj < 0d, s"NH west of storm should see a negative adjustment; got $adj")
    assert(math.abs(adj + k * 10d) < 0.5d, s"expected approximately -$k*10; got $adj")
  }

  /** Directly ahead of the storm (bearing == heading, offset = 0): no
    * asymmetry boost. */
  test("site directly ahead of storm sees zero adjustment") {
    val adj = TranslationAsymmetry.adjustment(
      stormLatDeg = stormLat,
      stormLonDeg = stormLon,
      headingDeg = Some(0d), // north
      translationSpeed = Some(12d),
      siteLatDeg = stormLat + 0.5d, // north of storm
      siteLonDeg = stormLon,
      k = k
    )
    assert(math.abs(adj) < 0.5d, s"expected ~0 adjustment directly ahead; got $adj")
  }

  /** Southern-hemisphere storm: the maximum boost is on the LEFT of the
    * track, not the right. Verified by mirroring the NH east-side case
    * to a SH site at -28N with a south-moving storm. */
  test("SH storm inverts the asymmetry direction") {
    val north = TranslationAsymmetry.adjustment(
      stormLatDeg = 28d, stormLonDeg = -92d,
      headingDeg = Some(0d), translationSpeed = Some(10d),
      siteLatDeg = 28d, siteLonDeg = -91d,
      k = k
    )
    val south = TranslationAsymmetry.adjustment(
      stormLatDeg = -28d, stormLonDeg = -92d,
      headingDeg = Some(0d), translationSpeed = Some(10d),
      siteLatDeg = -28d, siteLonDeg = -91d,
      k = k
    )
    assert(north > 0d && south < 0d, s"NH=$north SH=$south should have opposite signs")
  }

  test("missing heading or speed returns zero adjustment") {
    val withoutHeading = TranslationAsymmetry.adjustment(
      stormLat, stormLon, None, Some(10d), 28.5d, -91.5d, k
    )
    val withoutSpeed = TranslationAsymmetry.adjustment(
      stormLat, stormLon, Some(45d), None, 28.5d, -91.5d, k
    )
    val withZeroSpeed = TranslationAsymmetry.adjustment(
      stormLat, stormLon, Some(45d), Some(0d), 28.5d, -91.5d, k
    )
    assert(withoutHeading == 0d)
    assert(withoutSpeed == 0d)
    assert(withZeroSpeed == 0d)
  }

  test("normalizeDeg wraps to (-180, 180]") {
    assert(TranslationAsymmetry.normalizeDeg(370) == 10)
    assert(TranslationAsymmetry.normalizeDeg(-190) == 170)
    assert(TranslationAsymmetry.normalizeDeg(180) == 180)
    assert(TranslationAsymmetry.normalizeDeg(0) == 0)
  }
}
