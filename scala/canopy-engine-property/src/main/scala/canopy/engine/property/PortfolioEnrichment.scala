package canopy.engine.property

import Hurdat2PropertyCatPricingYltSimulator.{PropertyLocation, PropertyPortfolio}

/** Phase-2.8 enrichment: fill missing v2 schema fields on a portfolio
  * from country/region defaults so the phase-2.9 vulnerability library
  * always has a curve to look up. Every defaulted field is recorded in
  * an EnrichmentLog per location so reviewers can see what was assumed.
  *
  * The defaults are deliberately conservative (US-coast residential-
  * looking properties) and sourced from Hazus HM4 climatological
  * distributions for the Atlantic coast. When the portfolio already
  * carries a field, we keep the caller's value untouched.
  *
  * This is an enrichment step, not a validation step: a location with
  * an unknown construction class gets filled with `wood_frame` (the
  * Hazus default for coastal US residential) and that gets logged, not
  * rejected. Phase 1.1's ajv validator is where rejection happens.
  */
object PortfolioEnrichment {

  final case class EnrichmentEntry(
      locationId: String,
      field: String,
      assumedValue: String,
      reason: String
  )

  final case class EnrichmentLog(entries: Vector[EnrichmentEntry]) {
    def ++(more: Vector[EnrichmentEntry]): EnrichmentLog = EnrichmentLog(entries ++ more)
  }
  object EnrichmentLog {
    val empty: EnrichmentLog = EnrichmentLog(Vector.empty)
  }

  final case class EnrichmentResult(
      portfolio: PropertyPortfolio,
      log: EnrichmentLog
  )

  /** Default build vintage for enrichment: loosely splits US coastal
    * housing stock into three code eras. Tied to the year-built bucket
    * in Hazus HM4 Table 5-12. */
  val DefaultYearBuilt: Int = 1985
  val DefaultNumberOfStories: Int = 1
  val DefaultConstructionClass: String = "wood_frame"
  val DefaultOccupancyClass: String = "residential_single_family"
  val DefaultRoofShape: String = "gable"
  val DefaultRoofCover: String = "asphalt_shingle"
  val DefaultSurfaceRoughnessClass: String = "suburban"

  def enrich(portfolio: PropertyPortfolio): EnrichmentResult = {
    val (locations, logs) = portfolio.locations
      .map(enrichLocation)
      .unzip
    EnrichmentResult(
      portfolio = portfolio.copy(locations = locations),
      log = EnrichmentLog(logs.flatten)
    )
  }

  /** Infer a code era from year-built buckets aligned to Hazus HM4
    * Table 5-12 (Atlantic coast residential). */
  def inferCodeEra(yearBuilt: Int): String =
    if (yearBuilt < 1970) "pre_code"
    else if (yearBuilt < 1995) "legacy_code"
    else if (yearBuilt < 2010) "moderate_code"
    else "high_code"

  /** Infer the Hazus-style occupancy class from the free-form v1
    * `occupancy` string. Only exact-substring matches; anything else
    * falls through to the default. */
  def inferOccupancyClass(freeform: String): Option[String] = {
    val s = freeform.trim.toLowerCase
    if (s.contains("industrial") && s.contains("heavy")) Some("industrial_heavy")
    else if (s.contains("industrial")) Some("industrial_light")
    else if (s.contains("hospitality")) Some("hospitality")
    else if (s.contains("office")) Some("commercial_office")
    else if (s.contains("retail")) Some("commercial_retail")
    else if (s.contains("commercial")) Some("commercial_office")
    else if (s.contains("residential") && s.contains("multi")) Some("residential_multi_family")
    else if (s.contains("residential")) Some("residential_single_family")
    else if (s.contains("healthcare") || s.contains("hospital")) Some("healthcare")
    else if (s.contains("school") || s.contains("education")) Some("education")
    else if (s.contains("warehouse")) Some("warehouse")
    else None
  }

  private def enrichLocation(loc: PropertyLocation): (PropertyLocation, Vector[EnrichmentEntry]) = {
    val buf = scala.collection.mutable.ArrayBuffer.empty[EnrichmentEntry]

    def logDefault(field: String, value: String, reason: String): Unit =
      buf += EnrichmentEntry(loc.locationId, field, value, reason)

    val occupancyClass = loc.occupancyClass.orElse {
      loc.occupancy.flatMap(inferOccupancyClass).map { inferred =>
        logDefault("occupancyClass", inferred, s"inferred from legacy occupancy '${loc.occupancy.get}'")
        inferred
      }
    }.orElse {
      logDefault("occupancyClass", DefaultOccupancyClass, "no occupancy data; Hazus default for US coastal residential")
      Some(DefaultOccupancyClass)
    }

    val constructionClass = loc.constructionClass.orElse {
      logDefault(
        "constructionClass",
        DefaultConstructionClass,
        "no construction data; Hazus default for US coastal residential"
      )
      Some(DefaultConstructionClass)
    }

    val yearBuilt = loc.yearBuilt.orElse {
      logDefault("yearBuilt", DefaultYearBuilt.toString, "no year-built data; Hazus coastal median")
      Some(DefaultYearBuilt)
    }

    val numberOfStories = loc.numberOfStories.orElse {
      logDefault("numberOfStories", DefaultNumberOfStories.toString, "no stories data; Hazus coastal single-family default")
      Some(DefaultNumberOfStories)
    }

    val codeEra = loc.codeEra.orElse {
      val inferred = yearBuilt.map(inferCodeEra).getOrElse("legacy_code")
      logDefault("codeEra", inferred, s"inferred from yearBuilt=${yearBuilt.getOrElse("default")}")
      Some(inferred)
    }

    val roofShape = loc.roofShape.orElse {
      logDefault("roofShape", DefaultRoofShape, "no roof-shape data; default gable")
      Some(DefaultRoofShape)
    }

    val roofCover = loc.roofCover.orElse {
      logDefault("roofCover", DefaultRoofCover, "no roof-cover data; default asphalt shingle")
      Some(DefaultRoofCover)
    }

    val roughness = loc.surfaceRoughnessClass.orElse {
      logDefault(
        "surfaceRoughnessClass",
        DefaultSurfaceRoughnessClass,
        "no terrain data; default suburban"
      )
      Some(DefaultSurfaceRoughnessClass)
    }

    val enriched = loc.copy(
      occupancyClass = occupancyClass,
      constructionClass = constructionClass,
      yearBuilt = yearBuilt,
      numberOfStories = numberOfStories,
      codeEra = codeEra,
      roofShape = roofShape,
      roofCover = roofCover,
      surfaceRoughnessClass = roughness
    )
    (enriched, buf.toVector)
  }
}
