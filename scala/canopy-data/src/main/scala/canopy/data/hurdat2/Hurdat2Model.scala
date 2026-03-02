package canopy.data.hurdat2

import java.time.{LocalDate, LocalTime}

final case class Hurdat2StormId(
    raw: String,
    basin: String,
    number: Int,
    year: Int
)

final case class Hurdat2StormHeader(
    id: Hurdat2StormId,
    name: String,
    advisoryCount: Int
)

final case class Hurdat2WindRadii(
    ne: Option[Int],
    se: Option[Int],
    sw: Option[Int],
    nw: Option[Int]
)

final case class Hurdat2TrackPoint(
    date: LocalDate,
    time: LocalTime,
    recordIdentifier: Option[String],
    status: String,
    latitude: Double,
    longitude: Double,
    maxWindKt: Int,
    minPressureMb: Option[Int],
    windRadii34KtNm: Option[Hurdat2WindRadii],
    windRadii50KtNm: Option[Hurdat2WindRadii],
    windRadii64KtNm: Option[Hurdat2WindRadii]
) {
  def dateTimeOrderingKey: (LocalDate, LocalTime) = (date, time)
}

final case class Hurdat2Storm(
    header: Hurdat2StormHeader,
    track: Vector[Hurdat2TrackPoint]
) {
  lazy val year: Int = track.headOption.map(_.date.getYear).getOrElse(header.id.year)
  lazy val maxWindKt: Option[Int] = track.map(_.maxWindKt).reduceOption(_ max _)
}

final case class Hurdat2Dataset(storms: Vector[Hurdat2Storm]) {
  lazy val years: Vector[Int] =
    storms.map(_.year).distinct.sorted

  lazy val stormsByYear: Map[Int, Vector[Hurdat2Storm]] =
    storms.groupBy(_.year).view.mapValues(_.toVector.sortBy(_.header.id.raw)).toMap
}

object Hurdat2Dataset {
  val empty: Hurdat2Dataset = Hurdat2Dataset(Vector.empty)
}

final case class Hurdat2ParseError(lineNumber: Int, message: String) {
  override def toString: String = s"HURDAT2 parse error at line $lineNumber: $message"
}
