package canopy.data.registry

import org.scalatest.BeforeAndAfterEach
import org.scalatest.funsuite.AnyFunSuite

import java.nio.file.{Files, Path}

class DataRegistrySpec extends AnyFunSuite with BeforeAndAfterEach {

  private var tempDir: Path = _
  private val synthetic: DataArtifact = DataArtifact(
    id = "synthetic",
    kind = "test",
    description = "synthetic artifact for tests",
    url = "file:///does/not/exist",
    sha256 = "", // empty = accept any
    localFileName = "synthetic.bin",
    approximateMb = 1,
    license = "test"
  )

  override def beforeEach(): Unit = {
    tempDir = Files.createTempDirectory("canopy-registry-test-")
  }

  override def afterEach(): Unit = {
    if (tempDir != null) {
      val files = Files.walk(tempDir)
      try {
        files.sorted(java.util.Comparator.reverseOrder()).forEach { p =>
          Files.deleteIfExists(p)
          ()
        }
      } finally files.close()
    }
  }

  test("status returns Missing for unfetched artifact") {
    val r = DataRegistry.create(tempDir, Vector(synthetic))
    r.status(synthetic) match {
      case _: ArtifactStatus.Missing => succeed
      case other                     => fail(s"expected Missing; got $other")
    }
  }

  test("status returns Ready when the file exists on disk") {
    val path = tempDir.resolve(synthetic.localFileName)
    Files.createDirectories(path.getParent)
    Files.write(path, "hello".getBytes("UTF-8"))
    val r = DataRegistry.create(tempDir, Vector(synthetic))
    r.status(synthetic) match {
      case ArtifactStatus.Ready(_, p, size, sha) =>
        assert(p == path)
        assert(size == 5L)
        assert(sha.length == 64)
      case other => fail(s"expected Ready; got $other")
    }
  }

  test("status detects sha256 mismatch when the descriptor pins a hash") {
    val path = tempDir.resolve(synthetic.localFileName)
    Files.createDirectories(path.getParent)
    Files.write(path, "hello".getBytes("UTF-8"))
    val pinned = synthetic.copy(sha256 = "deadbeef")
    val r = DataRegistry.create(tempDir, Vector(pinned))
    r.status(pinned) match {
      case ArtifactStatus.Unavailable(_, reason) =>
        assert(reason.toLowerCase.contains("sha256"))
      case other => fail(s"expected Unavailable; got $other")
    }
  }

  test("ensure() on a pre-cached artifact returns Ready without downloading") {
    val path = tempDir.resolve(synthetic.localFileName)
    Files.createDirectories(path.getParent)
    Files.write(path, "cached".getBytes("UTF-8"))
    val r = DataRegistry.create(tempDir, Vector(synthetic))
    val s = r.ensure(synthetic)
    assert(s.isInstanceOf[ArtifactStatus.Ready])
  }

  test("ensure() on a missing artifact with a bad URL returns Unavailable") {
    val r = DataRegistry.create(tempDir, Vector(synthetic))
    val s = r.ensure(synthetic)
    s match {
      case ArtifactStatus.Unavailable(_, reason) =>
        assert(reason.toLowerCase.contains("download"))
      case other => fail(s"expected Unavailable; got $other")
    }
  }

  test("summarize reports every configured artifact") {
    val a2 = synthetic.copy(id = "synthetic2", localFileName = "syn2.bin")
    val r = DataRegistry.create(tempDir, Vector(synthetic, a2))
    val s = DataRegistry.summarize(r)
    assert(s.artifacts.size == 2)
    assert(s.cacheDir == tempDir.toString)
    val ids = s.artifacts.flatMap(_.get("id").map(_.toString)).toSet
    assert(ids == Set("synthetic", "synthetic2"))
  }

  test("default artifact list contains the shipped defaults") {
    val defaults = DataArtifact.defaultArtifacts.map(_.id).toSet
    assert(defaults.contains("natural-earth-10m-land"))
    assert(defaults.contains("slosh-meow-gulf"))
  }
}
