package canopy.engine.property.hazard

import canopy.data.hurdat2._
import org.scalatest.funsuite.AnyFunSuite

import java.time.{LocalDate, LocalTime}

import canopy.engine.property.Hurdat2PropertyCatPricingYltSimulator.{PricingParameters, PropertyLocation}

class StormSurgeSpec extends AnyFunSuite {

  private def point(lat: Double, lon: Double, windKt: Int, hour: Int = 0): Hurdat2TrackPoint =
    Hurdat2TrackPoint(
      date = LocalDate.of(2005, 9, 1),
      time = LocalTime.of(hour, 0),
      recordIdentifier = None,
      status = "HU",
      latitude = lat,
      longitude = lon,
      maxWindKt = windKt,
      minPressureMb = Some(950),
      windRadii34KtNm = None,
      windRadii50KtNm = None,
      windRadii64KtNm = None
    )

  private def storm(peakWind: Int): Hurdat2Storm = Hurdat2Storm(
    header = Hurdat2StormHeader(Hurdat2StormId("AL012005", "AL", 1, 2005), "SURGE-TEST", 3),
    track = Vector(
      point(26.0, -93.0, math.max(peakWind - 30, 35)),
      point(28.5, -91.0, peakWind, hour = 6),      // peak near landfall
      point(30.2, -89.5, math.max(peakWind - 20, 35), hour = 12)
    )
  )

  private def loc(lat: Double, lon: Double, perils: Vector[String] = Vector("WIND", "STORM_SURGE"), tiv: Double = 10_000_000d): PropertyLocation =
    PropertyLocation(
      locationId = "loc_surge_test",
      latitude = lat,
      longitude = lon,
      tiv = tiv,
      deductible = 0d,
      limit = tiv,
      occupancy = Some("Commercial"),
      perilSet = perils,
      country = Some("US")
    )

  private val pp = PricingParameters(useStormSurge = true)

  test("TS-range storm produces zero surge") {
    val s = storm(40)
    val l = loc(28.5, -91.0)
    assert(StormSurge.peakSurgeFt(s, l) == 0d)
    assert(StormSurge.modeledSurgeLoss(s, l, pp) == 0d)
  }

  test("Cat 4 landfall near site produces substantial surge") {
    val s = storm(130)
    val l = loc(28.5, -91.0) // sitting right on the peak-intensity track point
    val h = StormSurge.peakSurgeFt(s, l)
    assert(h > 10d, s"Cat 4 on-track should produce > 10 ft; got $h")
  }

  test("surge decays with distance from track") {
    val s = storm(130)
    val onTrack = StormSurge.peakSurgeFt(s, loc(28.5, -91.0))
    val nearTrack = StormSurge.peakSurgeFt(s, loc(28.5, -90.5))
    val farTrack = StormSurge.peakSurgeFt(s, loc(28.5, -89.0))
    assert(nearTrack < onTrack, s"near-track ($nearTrack) should be less than on-track ($onTrack)")
    assert(farTrack < nearTrack, s"far-track ($farTrack) should be less than near-track ($nearTrack)")
  }

  test("surge is zero beyond the max relevant distance") {
    val s = storm(130)
    val veryFar = StormSurge.peakSurgeFt(s, loc(28.5, -70.0))
    assert(veryFar == 0d, s"beyond 100 km should be zero; got $veryFar")
  }

  test("surgeDamageRatio is zero below 1 ft") {
    assert(StormSurge.surgeDamageRatio(0d) == 0d)
    assert(StormSurge.surgeDamageRatio(0.9d) == 0d)
  }

  test("surgeDamageRatio is monotonic non-decreasing") {
    val heights = Seq(0d, 2d, 4d, 6d, 8d, 12d, 18d, 25d)
    val ratios = heights.map(StormSurge.surgeDamageRatio)
    ratios.sliding(2).filter(_.size == 2).foreach { case Seq(a, b) =>
      assert(b >= a - 1e-9, s"non-monotone: $a -> $b")
    }
  }

  test("locations without STORM_SURGE peril see zero surge loss") {
    val s = storm(130)
    val l = loc(28.5, -91.0, perils = Vector("WIND"))
    assert(StormSurge.modeledSurgeLoss(s, l, pp) == 0d)
  }

  test("flag disables surge entirely") {
    val s = storm(130)
    val l = loc(28.5, -91.0)
    assert(StormSurge.modeledSurgeLoss(s, l, pp.copy(useStormSurge = false)) == 0d)
  }
}
