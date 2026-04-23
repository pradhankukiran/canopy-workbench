package canopy.engine.property

import org.scalatest.funsuite.AnyFunSuite

/** Smoke test replacing the placeholder object. Proves ScalaTest is wired up
  * and this module's identity is what the worker expects.
  */
class CanopyEnginePropertyModuleSpec extends AnyFunSuite {
  test("moduleId is canopy-engine-property") {
    assert(CanopyEnginePropertyModule.moduleId == "canopy-engine-property")
  }
}
