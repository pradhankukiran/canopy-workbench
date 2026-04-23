ThisBuild / organization := "com.canopy"
ThisBuild / version := "0.1.0-SNAPSHOT"
ThisBuild / scalaVersion := "2.13.14"

lazy val commonSettings = Seq(
  scalacOptions ++= Seq("-deprecation", "-feature", "-unchecked"),
  Test / parallelExecution := false,
  libraryDependencies ++= Seq(
    "org.scalatest" %% "scalatest" % "3.2.19" % Test,
    "org.scalatestplus" %% "scalacheck-1-18" % "3.2.19.0" % Test,
    "org.scalacheck" %% "scalacheck" % "1.18.1" % Test
  )
)

def canopyModule(moduleId: String): Project =
  Project(id = moduleId, base = file(s"scala/$moduleId"))
    .settings(commonSettings: _*)
    .settings(
      name := moduleId
    )

lazy val canopyData = canopyModule("canopy-data")

lazy val canopyScenarios = canopyModule("canopy-scenarios")

lazy val canopyInferenceRainier =
  canopyModule("canopy-inference-rainier")
    .settings(
      libraryDependencies ++= Seq(
        "com.stripe" %% "rainier-core" % "0.3.5",
        "com.stripe" %% "rainier-sampler" % "0.3.5"
      )
    )

lazy val canopyEngineProperty =
  canopyModule("canopy-engine-property")
    .dependsOn(canopyData, canopyInferenceRainier)
    .settings(
      libraryDependencies ++= Seq(
        "com.lihaoyi" %% "ujson" % "3.1.4"
      ),
      Compile / mainClass := Some("canopy.engine.property.Hurdat2PropertyCatPricingYltCli")
    )

lazy val canopyEngineTrigger =
  canopyModule("canopy-engine-trigger")
    .dependsOn(canopyData, canopyInferenceRainier)
    .settings(
      libraryDependencies ++= Seq(
        "com.lihaoyi" %% "ujson" % "3.1.4"
      ),
      Compile / mainClass := Some("canopy.engine.trigger.Hurdat2IlsTriggerCli")
    )

lazy val canopyEnginePortfolio =
  canopyModule("canopy-engine-portfolio")
    .dependsOn(canopyInferenceRainier)
    .settings(
      libraryDependencies ++= Seq(
        "com.lihaoyi" %% "ujson" % "3.1.4"
      ),
      Compile / mainClass := Some("canopy.engine.portfolio.MarginalPortfolioImpactCli")
    )

lazy val canopyRiskMetrics = canopyModule("canopy-risk-metrics")

lazy val root = (project in file("."))
  .aggregate(
    canopyData,
    canopyScenarios,
    canopyInferenceRainier,
    canopyEngineProperty,
    canopyEngineTrigger,
    canopyEnginePortfolio,
    canopyRiskMetrics
  )
  .settings(
    name := "canopy-workbench",
    publish / skip := true
  )
