package canopy.data.hurdat2

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}
import java.time.{LocalDate, LocalTime}

import scala.util.Try
import scala.util.matching.Regex

object Hurdat2Parser {
  private val StormIdPattern: Regex = "^([A-Za-z]{2})(\\d{2})(\\d{4})$".r

  def parseFile(path: Path): Either[Hurdat2ParseError, Hurdat2Dataset] = {
    val bytes = Files.readAllBytes(path)
    parse(new String(bytes, StandardCharsets.UTF_8))
  }

  def parse(text: String): Either[Hurdat2ParseError, Hurdat2Dataset] = {
    val rawLines = text.replace("\r\n", "\n").replace('\r', '\n').split("\n", -1).toVector
    val lines = if (rawLines.nonEmpty && rawLines.last.trim.isEmpty) rawLines.dropRight(1) else rawLines

    val storms = Vector.newBuilder[Hurdat2Storm]
    var lineIndex = 0

    while (lineIndex < lines.length) {
      val headerLine = lines(lineIndex).trim
      if (headerLine.isEmpty) {
        lineIndex += 1
      } else {
        parseHeader(headerLine, lineIndex + 1) match {
          case Left(err) => return Left(err)
          case Right(header) =>
            lineIndex += 1
            val track = Vector.newBuilder[Hurdat2TrackPoint]
            var parsedCount = 0

            while (parsedCount < header.advisoryCount) {
              if (lineIndex >= lines.length) {
                return Left(
                  Hurdat2ParseError(
                    lineIndex + 1,
                    s"unexpected end of file while reading storm ${header.id.raw}; expected ${header.advisoryCount} advisories"
                  )
                )
              }

              val row = lines(lineIndex).trim
              if (row.isEmpty) {
                return Left(Hurdat2ParseError(lineIndex + 1, "blank line within storm advisory rows"))
              }

              parseTrackPoint(row, lineIndex + 1) match {
                case Left(err)     => return Left(err)
                case Right(point)  => track += point
              }

              parsedCount += 1
              lineIndex += 1
            }

            storms += Hurdat2Storm(header, track.result())
        }
      }
    }

    Right(Hurdat2Dataset(storms.result()))
  }

  private def parseHeader(line: String, lineNumber: Int): Either[Hurdat2ParseError, Hurdat2StormHeader] = {
    val cols = splitColumns(line)
    if (cols.length < 3) {
      Left(Hurdat2ParseError(lineNumber, s"invalid header row, expected at least 3 columns but found ${cols.length}"))
    } else {
      parseStormId(cols(0), lineNumber).flatMap { stormId =>
        parseInt(cols(2), lineNumber, "advisory count").flatMap { advisoryCount =>
          if (advisoryCount < 0) {
            Left(Hurdat2ParseError(lineNumber, s"advisory count must be >= 0 but was $advisoryCount"))
          } else {
            Right(
              Hurdat2StormHeader(
                id = stormId,
                name = cols(1),
                advisoryCount = advisoryCount
              )
            )
          }
        }
      }
    }
  }

  private def parseTrackPoint(line: String, lineNumber: Int): Either[Hurdat2ParseError, Hurdat2TrackPoint] = {
    val cols = splitColumns(line)
    if (cols.length < 8) {
      Left(Hurdat2ParseError(lineNumber, s"invalid track row, expected at least 8 columns but found ${cols.length}"))
    } else {
      for {
        date <- parseDate(cols(0), lineNumber)
        time <- parseTime(cols(1), lineNumber)
        status = cols(3).toUpperCase
        lat <- parseLatitude(cols(4), lineNumber)
        lon <- parseLongitude(cols(5), lineNumber)
        wind <- parseInt(cols(6), lineNumber, "max wind")
        pressure <- parseOptionalInt(cols.lift(7), lineNumber, "minimum pressure")
        radii34 <- parseRadii(cols.slice(8, 12), lineNumber, "34kt")
        radii50 <- parseRadii(cols.slice(12, 16), lineNumber, "50kt")
        radii64 <- parseRadii(cols.slice(16, 20), lineNumber, "64kt")
      } yield Hurdat2TrackPoint(
        date = date,
        time = time,
        recordIdentifier = cols.lift(2).map(_.trim).filter(_.nonEmpty),
        status = status,
        latitude = lat,
        longitude = lon,
        maxWindKt = wind,
        minPressureMb = pressure,
        windRadii34KtNm = radii34,
        windRadii50KtNm = radii50,
        windRadii64KtNm = radii64
      )
    }
  }

  private def parseStormId(raw: String, lineNumber: Int): Either[Hurdat2ParseError, Hurdat2StormId] =
    raw.toUpperCase match {
      case StormIdPattern(basin, number, year) =>
        Right(
          Hurdat2StormId(
            raw = raw.toUpperCase,
            basin = basin.toUpperCase,
            number = number.toInt,
            year = year.toInt
          )
        )
      case _ =>
        Left(Hurdat2ParseError(lineNumber, s"invalid storm id '$raw'"))
    }

  private def parseDate(raw: String, lineNumber: Int): Either[Hurdat2ParseError, LocalDate] =
    if (raw.length != 8 || !raw.forall(_.isDigit)) {
      Left(Hurdat2ParseError(lineNumber, s"invalid date '$raw'"))
    } else {
      Try(LocalDate.of(raw.substring(0, 4).toInt, raw.substring(4, 6).toInt, raw.substring(6, 8).toInt))
        .toEither
        .left
        .map(ex => Hurdat2ParseError(lineNumber, s"invalid date '$raw': ${ex.getMessage}"))
    }

  private def parseTime(raw: String, lineNumber: Int): Either[Hurdat2ParseError, LocalTime] = {
    val digits = raw.filter(_.isDigit)
    val normalized =
      if (digits.length == 4) digits
      else if (digits.nonEmpty && digits.length < 4) ("0" * (4 - digits.length)) + digits
      else digits
    if (normalized.length != 4 || !normalized.forall(_.isDigit)) {
      Left(Hurdat2ParseError(lineNumber, s"invalid time '$raw'"))
    } else {
      Try(LocalTime.of(normalized.substring(0, 2).toInt, normalized.substring(2, 4).toInt))
        .toEither
        .left
        .map(ex => Hurdat2ParseError(lineNumber, s"invalid time '$raw': ${ex.getMessage}"))
    }
  }

  private def parseLatitude(raw: String, lineNumber: Int): Either[Hurdat2ParseError, Double] =
    parseSignedCoordinate(raw, positiveSuffix = 'N', negativeSuffix = 'S', "latitude", lineNumber)

  private def parseLongitude(raw: String, lineNumber: Int): Either[Hurdat2ParseError, Double] =
    parseSignedCoordinate(raw, positiveSuffix = 'E', negativeSuffix = 'W', "longitude", lineNumber)

  private def parseSignedCoordinate(
      raw: String,
      positiveSuffix: Char,
      negativeSuffix: Char,
      fieldName: String,
      lineNumber: Int
  ): Either[Hurdat2ParseError, Double] = {
    val value = raw.trim.toUpperCase
    if (value.length < 2) {
      Left(Hurdat2ParseError(lineNumber, s"invalid $fieldName '$raw'"))
    } else {
      val suffix = value.last
      val numeric = value.dropRight(1)
      parseDouble(numeric, lineNumber, fieldName).flatMap { magnitude =>
        suffix match {
          case s if s == positiveSuffix => Right(magnitude)
          case s if s == negativeSuffix => Right(-magnitude)
          case _ =>
            Left(
              Hurdat2ParseError(
                lineNumber,
                s"invalid $fieldName hemisphere '$suffix' in '$raw' (expected $positiveSuffix/$negativeSuffix)"
              )
            )
        }
      }
    }
  }

  private def parseRadii(
      cols: Seq[String],
      lineNumber: Int,
      label: String
  ): Either[Hurdat2ParseError, Option[Hurdat2WindRadii]] = {
    if (cols.isEmpty) {
      Right(None)
    } else if (cols.length < 4) {
      Left(Hurdat2ParseError(lineNumber, s"incomplete $label wind radii columns"))
    } else {
      for {
        ne <- parseOptionalInt(Some(cols(0)), lineNumber, s"$label radii NE")
        se <- parseOptionalInt(Some(cols(1)), lineNumber, s"$label radii SE")
        sw <- parseOptionalInt(Some(cols(2)), lineNumber, s"$label radii SW")
        nw <- parseOptionalInt(Some(cols(3)), lineNumber, s"$label radii NW")
      } yield {
        val radii = Hurdat2WindRadii(ne, se, sw, nw)
        if (Seq(ne, se, sw, nw).forall(_.isEmpty)) None else Some(radii)
      }
    }
  }

  private def parseOptionalInt(
      raw: Option[String],
      lineNumber: Int,
      fieldName: String
  ): Either[Hurdat2ParseError, Option[Int]] =
    raw match {
      case None => Right(None)
      case Some(value) =>
        val trimmed = value.trim
        if (trimmed.isEmpty || trimmed == "-999" || trimmed == "-99") {
          Right(None)
        } else {
          parseInt(trimmed, lineNumber, fieldName).map(Some(_))
        }
    }

  private def parseInt(raw: String, lineNumber: Int, fieldName: String): Either[Hurdat2ParseError, Int] =
    Try(raw.trim.toInt)
      .toEither
      .left
      .map(_ => Hurdat2ParseError(lineNumber, s"invalid $fieldName '$raw'"))

  private def parseDouble(raw: String, lineNumber: Int, fieldName: String): Either[Hurdat2ParseError, Double] =
    Try(raw.trim.toDouble)
      .toEither
      .left
      .map(_ => Hurdat2ParseError(lineNumber, s"invalid $fieldName '$raw'"))

  private def splitColumns(line: String): Vector[String] =
    line.split(",", -1).iterator.map(_.trim).toVector
}
