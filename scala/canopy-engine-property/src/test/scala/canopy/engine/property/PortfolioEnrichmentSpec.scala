package canopy.engine.property

import org.scalatest.funsuite.AnyFunSuite

import Hurdat2PropertyCatPricingYltSimulator._

class PortfolioEnrichmentSpec extends AnyFunSuite {

  private def baseLoc(
      id: String,
      occupancy: Option[String] = None,
      constructionClass: Option[String] = None,
      yearBuilt: Option[Int] = None,
      numberOfStories: Option[Int] = None,
      codeEra: Option[String] = None
  ): PropertyLocation = PropertyLocation(
    locationId = id,
    latitude = 29.5,
    longitude = -90d,
    tiv = 1_000_000d,
    deductible = 50_000d,
    limit = 800_000d,
    occupancy = occupancy,
    perilSet = Vector("WIND"),
    country = Some("US"),
    constructionClass = constructionClass,
    yearBuilt = yearBuilt,
    numberOfStories = numberOfStories,
    codeEra = codeEra
  )

  test("fully-missing location is enriched with every default and logged per field") {
    val pf = PropertyPortfolio("pf_t1", "test", "USD", Vector(baseLoc("loc_a")))
    val result = PortfolioEnrichment.enrich(pf)
    val loc = result.portfolio.locations.head
    assert(loc.occupancyClass.contains("residential_single_family"))
    assert(loc.constructionClass.contains("wood_frame"))
    assert(loc.yearBuilt.contains(1985))
    assert(loc.numberOfStories.contains(1))
    assert(loc.codeEra.contains("legacy_code"))
    val fields = result.log.entries.map(_.field).toSet
    assert(fields.contains("occupancyClass"))
    assert(fields.contains("constructionClass"))
    assert(fields.contains("yearBuilt"))
    assert(fields.contains("codeEra"))
  }

  test("explicit fields on the input are preserved and not logged") {
    val pf = PropertyPortfolio(
      "pf_t2",
      "test",
      "USD",
      Vector(baseLoc("loc_b",
        constructionClass = Some("reinforced_concrete"),
        yearBuilt = Some(2005),
        numberOfStories = Some(6),
        codeEra = Some("modern_code")
      ))
    )
    val result = PortfolioEnrichment.enrich(pf)
    val loc = result.portfolio.locations.head
    assert(loc.constructionClass.contains("reinforced_concrete"))
    assert(loc.yearBuilt.contains(2005))
    assert(loc.numberOfStories.contains(6))
    assert(loc.codeEra.contains("modern_code"))
    val logged = result.log.entries.map(_.field).toSet
    assert(!logged.contains("constructionClass"))
    assert(!logged.contains("yearBuilt"))
    assert(!logged.contains("numberOfStories"))
    assert(!logged.contains("codeEra"))
  }

  test("free-form v1 occupancy is mapped to the Hazus-typed occupancyClass") {
    assert(PortfolioEnrichment.inferOccupancyClass("Commercial Office").contains("commercial_office"))
    assert(PortfolioEnrichment.inferOccupancyClass("Industrial Heavy").contains("industrial_heavy"))
    assert(PortfolioEnrichment.inferOccupancyClass("Residential").contains("residential_single_family"))
    assert(PortfolioEnrichment.inferOccupancyClass("Multi-Family Residential").contains("residential_multi_family"))
    assert(PortfolioEnrichment.inferOccupancyClass("Hospitality / Hotel").contains("hospitality"))
    assert(PortfolioEnrichment.inferOccupancyClass("Warehouse distribution").contains("warehouse"))
    assert(PortfolioEnrichment.inferOccupancyClass("Healthcare / Hospital").contains("healthcare"))
    assert(PortfolioEnrichment.inferOccupancyClass("Moonbase").isEmpty)
  }

  test("codeEra inference buckets years correctly") {
    assert(PortfolioEnrichment.inferCodeEra(1960) == "pre_code")
    assert(PortfolioEnrichment.inferCodeEra(1989) == "legacy_code")
    assert(PortfolioEnrichment.inferCodeEra(2000) == "moderate_code")
    assert(PortfolioEnrichment.inferCodeEra(2018) == "high_code")
  }

  test("codeEra is inferred from an explicit yearBuilt rather than defaulted") {
    val pf = PropertyPortfolio(
      "pf_t3", "test", "USD",
      Vector(baseLoc("loc_c", yearBuilt = Some(2015)))
    )
    val result = PortfolioEnrichment.enrich(pf)
    assert(result.portfolio.locations.head.codeEra.contains("high_code"))
    val codeEraLog = result.log.entries.find(_.field == "codeEra")
    assert(codeEraLog.exists(_.reason.contains("yearBuilt=2015")))
  }

  test("empty portfolio produces empty log") {
    val pf = PropertyPortfolio("pf_t4", "test", "USD", Vector.empty)
    val result = PortfolioEnrichment.enrich(pf)
    assert(result.portfolio.locations.isEmpty)
    assert(result.log.entries.isEmpty)
  }
}
