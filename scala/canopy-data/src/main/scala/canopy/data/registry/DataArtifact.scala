package canopy.data.registry

/** Descriptor for a versioned external data artifact. The registry fetches
  * it from `url` once, verifies the SHA-256 digest, and caches the bytes
  * under the local file name. Subsequent runs use the cache.
  *
  * Sizes are advisory (used for progress reporting). The `kind` tag is
  * informational; consumers pattern-match on the `id` to bind to their
  * specific artifact.
  */
final case class DataArtifact(
    id: String,
    kind: String,
    description: String,
    url: String,
    sha256: String,
    localFileName: String,
    approximateMb: Int,
    license: String
)

object DataArtifact {

  /** Natural Earth 1:10m physical land polygons. Used by the overland-
    * decay module as a land/sea mask. Public domain. */
  val NaturalEarth10mLand: DataArtifact = DataArtifact(
    id = "natural-earth-10m-land",
    kind = "coastline",
    description = "Natural Earth 1:10m physical land polygons (coastline)",
    url = "https://naciscdn.org/naturalearth/10m/physical/ne_10m_land.zip",
    // Placeholder; real SHA published in the registry manifest at deploy time.
    // The registry treats a blank sha256 as "accept any" (warn in logs) so
    // a first-time deployment can bootstrap without a pre-computed digest.
    sha256 = "",
    localFileName = "ne_10m_land.zip",
    approximateMb = 2,
    license = "public-domain (Natural Earth)"
  )

  /** NOAA SLOSH MEOW surge envelope for the Gulf of Mexico basin. Used by
    * the storm-surge lookup. Public domain. */
  val SloshGulfMeow: DataArtifact = DataArtifact(
    id = "slosh-meow-gulf",
    kind = "surge",
    description = "NOAA SLOSH MEOW surge envelope, Gulf basin",
    url = "https://www.nhc.noaa.gov/nationalsurge/data/slosh_meow_gulf.zip",
    sha256 = "",
    localFileName = "slosh_meow_gulf.zip",
    approximateMb = 20,
    license = "public-domain (NOAA)"
  )

  /** ETOPO 2022 60-arc-second global elevation/bathymetry. Optional alternate
    * input for a finer land-sea mask. Public domain. */
  val Etopo2022_60s: DataArtifact = DataArtifact(
    id = "etopo-2022-60s",
    kind = "bathymetry",
    description = "ETOPO 2022 global 60-arc-second ice-surface elevation",
    url = "https://www.ngdc.noaa.gov/thredds/fileServer/global/ETOPO2022/60s/60s_surface_elev_netcdf/ETOPO_2022_v1_60s_N90W180_surface.nc",
    sha256 = "",
    localFileName = "etopo_2022_60s.nc",
    approximateMb = 90,
    license = "public-domain (NOAA NCEI)"
  )

  /** The set of artifacts shipped by default. Consumers can extend this at
    * runtime via DataRegistry.register if they add new datasets. */
  val defaultArtifacts: Vector[DataArtifact] =
    Vector(NaturalEarth10mLand, SloshGulfMeow, Etopo2022_60s)
}
