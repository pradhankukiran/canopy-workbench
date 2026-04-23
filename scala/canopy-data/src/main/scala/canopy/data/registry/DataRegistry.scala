package canopy.data.registry

import java.net.URI
import java.nio.file.{Files, Path, Paths, StandardCopyOption}
import java.security.MessageDigest
import scala.concurrent.duration._
import scala.jdk.CollectionConverters._
import scala.util.Try

/** Fetches and caches external data artifacts by URL + SHA-256.
  *
  * Typical flow:
  *
  *   val registry = DataRegistry.default()
  *   val status = registry.ensure(DataArtifact.NaturalEarth10mLand)
  *   status match {
  *     case ArtifactStatus.Ready(path, _, _)      => // use the file
  *     case ArtifactStatus.Unavailable(reason, _) => // degrade gracefully
  *   }
  *
  * Design: the registry never throws on a failed download; it returns an
  * `Unavailable` status and lets the caller decide whether to degrade (for
  * engine modules) or surface the error (for admin endpoints).
  */
trait DataRegistry {

  /** List every artifact known to this registry. */
  def artifacts: Vector[DataArtifact]

  /** Current on-disk status of an artifact: Ready(path) if cached and
    * verified, Missing if not yet fetched, Unavailable(reason) if the
    * last fetch attempt failed. Does NOT trigger a download. */
  def status(a: DataArtifact): ArtifactStatus

  /** Ensure an artifact is cached and verified. Downloads if missing,
    * verifies the checksum if present. Returns the final status. */
  def ensure(a: DataArtifact): ArtifactStatus

  /** Trigger a re-download even if the cache exists, then verify. Used
    * by the admin refresh endpoint. */
  def refresh(a: DataArtifact): ArtifactStatus

  /** Directory where artifacts live on disk. */
  def cacheDir: Path
}

sealed trait ArtifactStatus {
  def artifact: DataArtifact
  def asMap: Map[String, Any]
}

object ArtifactStatus {

  final case class Ready(artifact: DataArtifact, path: Path, sizeBytes: Long, sha256: String)
      extends ArtifactStatus {
    def asMap: Map[String, Any] = Map(
      "id" -> artifact.id,
      "kind" -> artifact.kind,
      "state" -> "ready",
      "path" -> path.toString,
      "sizeBytes" -> sizeBytes,
      "sha256" -> sha256,
      "url" -> artifact.url,
      "license" -> artifact.license
    )
  }

  final case class Missing(artifact: DataArtifact) extends ArtifactStatus {
    def asMap: Map[String, Any] = Map(
      "id" -> artifact.id,
      "kind" -> artifact.kind,
      "state" -> "missing",
      "url" -> artifact.url,
      "approximateMb" -> artifact.approximateMb,
      "license" -> artifact.license
    )
  }

  final case class Unavailable(artifact: DataArtifact, reason: String)
      extends ArtifactStatus {
    def asMap: Map[String, Any] = Map(
      "id" -> artifact.id,
      "kind" -> artifact.kind,
      "state" -> "unavailable",
      "reason" -> reason,
      "url" -> artifact.url,
      "license" -> artifact.license
    )
  }
}

object DataRegistry {

  /** Default cache directory: `CANOPY_DATA_CACHE_DIR` env var if set, else
    * `~/.canopy-workbench/data`. */
  def defaultCacheDir(): Path = {
    Option(System.getenv("CANOPY_DATA_CACHE_DIR"))
      .filter(_.trim.nonEmpty)
      .map(Paths.get(_))
      .getOrElse {
        val home = Option(System.getProperty("user.home")).getOrElse(".")
        Paths.get(home, ".canopy-workbench", "data")
      }
  }

  /** Construct the default registry with the shipped artifacts. */
  def default(): DataRegistry = new Local(defaultCacheDir(), DataArtifact.defaultArtifacts)

  /** Construct a registry bound to a specific directory and artifact list.
    * Used by tests to point at a temp dir with a synthetic artifact set. */
  def create(cache: Path, as: Vector[DataArtifact]): DataRegistry = new Local(cache, as)

  private final class Local(override val cacheDir: Path, as: Vector[DataArtifact])
      extends DataRegistry {

    override val artifacts: Vector[DataArtifact] = as

    override def status(a: DataArtifact): ArtifactStatus = {
      val path = pathOf(a)
      if (!Files.exists(path)) ArtifactStatus.Missing(a)
      else {
        val digest = sha256Of(path)
        if (a.sha256.isEmpty || digest.equalsIgnoreCase(a.sha256)) {
          ArtifactStatus.Ready(a, path, Files.size(path), digest)
        } else {
          ArtifactStatus.Unavailable(a, s"sha256 mismatch: expected ${a.sha256} got $digest")
        }
      }
    }

    override def ensure(a: DataArtifact): ArtifactStatus = {
      status(a) match {
        case r: ArtifactStatus.Ready => r
        case _ => download(a)
      }
    }

    override def refresh(a: DataArtifact): ArtifactStatus = {
      Try(Files.deleteIfExists(pathOf(a)))
      download(a)
    }

    private def pathOf(a: DataArtifact): Path = cacheDir.resolve(a.localFileName)

    private def download(a: DataArtifact): ArtifactStatus = {
      Try(Files.createDirectories(cacheDir))
      val destination = pathOf(a)
      val tempFile = cacheDir.resolve(s"${a.localFileName}.part")

      val attempt = Try {
        val uri = new URI(a.url)
        val conn = uri.toURL.openConnection()
        conn.setConnectTimeout(10.seconds.toMillis.toInt)
        conn.setReadTimeout(5.minutes.toMillis.toInt)
        val stream = conn.getInputStream
        try Files.copy(stream, tempFile, StandardCopyOption.REPLACE_EXISTING)
        finally stream.close()
        Files.move(tempFile, destination, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
      }

      attempt match {
        case scala.util.Success(_) => status(a)
        case scala.util.Failure(err) =>
          Try(Files.deleteIfExists(tempFile))
          ArtifactStatus.Unavailable(a, s"download failed: ${err.getMessage}")
      }
    }

    private def sha256Of(path: Path): String = {
      val md = MessageDigest.getInstance("SHA-256")
      val stream = Files.newInputStream(path)
      try {
        val buf = new Array[Byte](8192)
        var n = stream.read(buf)
        while (n > 0) {
          md.update(buf, 0, n)
          n = stream.read(buf)
        }
      } finally stream.close()
      md.digest().map("%02x".format(_)).mkString
    }
  }

  /** Summary record used by the API's `/data-sources` endpoint. */
  final case class Summary(cacheDir: String, artifacts: Vector[Map[String, Any]])

  def summarize(registry: DataRegistry): Summary = Summary(
    cacheDir = registry.cacheDir.toString,
    artifacts = registry.artifacts.map(registry.status).map(_.asMap)
  )

  /** Render a Summary as a plain JSON-compatible Java Map. Kept inside this
    * object so tests don't need ujson to assert on it. */
  def summaryAsJavaMap(registry: DataRegistry): java.util.Map[String, Object] = {
    val s = summarize(registry)
    val list = new java.util.ArrayList[java.util.Map[String, Object]]()
    s.artifacts.foreach { entry =>
      val m = new java.util.LinkedHashMap[String, Object]()
      entry.foreach { case (k, v) => m.put(k, v.asInstanceOf[Object]) }
      list.add(m)
    }
    val out = new java.util.LinkedHashMap[String, Object]()
    out.put("cacheDir", s.cacheDir)
    out.put("artifacts", list)
    out
  }

  // Silence unused import; scala 2.13 requires asScala in some paths.
  private val _unused = classOf[java.lang.Iterable[String]].asInstanceOf[Any]
  private val _unusedAsScala = {
    val _ = Seq.empty[Int].asJava
    ()
  }
}
