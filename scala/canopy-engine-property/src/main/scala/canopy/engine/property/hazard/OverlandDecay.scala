package canopy.engine.property.hazard

/** Kaplan-DeMaria (1995) inland tropical-cyclone decay.
  *
  * Once a storm crosses the coast, its maximum sustained wind decays
  * exponentially toward a background value:
  *
  *     V(t) = V_b + (R * V_0 - V_b) * exp(-a * t)
  *
  * where
  *
  *     V_0   wind at landfall (kt)
  *     V_b   asymptotic background wind over land (kt), ~26 kt Atlantic
  *     R     reduction factor from open-ocean to landfall, ~0.9
  *     a     decay rate (hr^-1), ~0.095 for Atlantic
  *     t     hours since landfall
  *
  * The Atlantic coefficients come from Kaplan & DeMaria (1995); Gulf
  * coefficients are slightly different (faster decay) but we use a
  * single parameter set for simplicity. Real implementations track
  * basin-specific constants and the storm's last-over-water V_max;
  * phase-3 expansion can plug in a proper basin classifier.
  *
  * Reference: Kaplan, J. and M. DeMaria (1995), "A simple empirical
  * model for predicting the decay of tropical cyclone winds after
  * landfall", Journal of Applied Meteorology 34, 2499-2512.
  */
object OverlandDecay {

  val BackgroundWindKt: Double = 26.7d
  val LandfallReductionFactor: Double = 0.9d
  val DecayRatePerHour: Double = 0.095d

  /** Apply the Kaplan-DeMaria formula to an open-ocean V_max and an
    * elapsed time since landfall. Zero time returns V_max (modulo the
    * small coastline reduction R); long time asymptotes to V_b. */
  def decayedWindKt(
      openOceanVMaxKt: Double,
      hoursSinceLandfall: Double,
      vBackgroundKt: Double = BackgroundWindKt,
      reductionFactor: Double = LandfallReductionFactor,
      decayRatePerHour: Double = DecayRatePerHour
  ): Double = {
    if (openOceanVMaxKt <= 0d) return 0d
    val t = math.max(0d, hoursSinceLandfall)
    val r0 = reductionFactor * openOceanVMaxKt
    val asymptote = math.min(vBackgroundKt, r0)
    asymptote + (r0 - asymptote) * math.exp(-decayRatePerHour * t)
  }
}
