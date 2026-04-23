package canopy.engine.property.hazard

/** Holland (1980) parametric radial wind profile.
  *
  * The gradient-wind formulation is
  *
  *     V_g(r) = sqrt( B (Rmax/r)^B (Pn - Pc) / rho exp(-(Rmax/r)^B)
  *                   + (r f / 2)^2 ) - r f / 2
  *
  * where
  *
  *     r        radial distance from storm center (m)
  *     Rmax     radius of maximum winds (m)
  *     Pn       environmental (far-field) pressure (Pa)
  *     Pc       central pressure (Pa)
  *     rho      air density (kg/m^3)
  *     f        Coriolis parameter = 2 * Omega * sin(|lat|)
  *     B        Holland's profile-shape parameter (dimensionless)
  *
  * B is derived from the HURDAT2 maxWindKt report via the analytic
  * maximum of the gradient wind
  *
  *     V_max^2 approx B (Pn - Pc) / (e rho)
  *  => B = e V_max^2 rho / (Pn - Pc)
  *
  * with V_max converted from knots to m/s. B is clamped to [0.8, 2.5],
  * the range observed in Atlantic hurricanes across a century of record.
  *
  * This module computes gradient wind and converts to a surface (10 m,
  * 1-minute) wind using a simple surface-wind reduction factor. More
  * sophisticated boundary-layer handling (translation asymmetry,
  * overland decay, surface roughness) lives in subsequent phases
  * (2.4-2.6) and composes on top of this base profile.
  *
  * References:
  *   Holland, G. J. (1980). "An analytic model of the wind and pressure
  *     profiles in hurricanes." Monthly Weather Review 108(8).
  *   Powell, M. D. (2003). "Reduced drag coefficient for high wind
  *     speeds in tropical cyclones." Nature 422.
  */
object HollandWindfield {

  /** Atlantic environmental (far-field) pressure in mb. 1013 mb is the
    * canonical value; some modelers use 1010 for Gulf-coast landfalls. */
  val EnvironmentalPressureMb: Double = 1013d

  /** Near-surface tropical air density in kg/m^3. Atlantic hurricanes
    * typically operate in 1.10-1.20 kg/m^3; 1.15 is a middle-of-the-
    * road constant that keeps B within historical bounds. */
  val AirDensityKgPerM3: Double = 1.15d

  /** Earth's angular velocity in rad/s. Used in the Coriolis term. */
  val OmegaRadPerSec: Double = 7.2921e-5d

  /** 1 knot in m/s. */
  val KtToMPerSec: Double = 0.514444d

  /** Euler's number. */
  val E: Double = math.E

  /** Reduction factor mapping gradient wind to 10 m sustained surface
    * wind. Powell (2003) reports 0.85-0.95 over water and 0.70-0.80
    * over land; 0.90 is the standard value used in FEMA Hazus. Phase
    * 2.5 Kaplan-DeMaria overland decay will apply additional land-side
    * attenuation on top. */
  val GradientToSurfaceFactor: Double = 0.90d

  /** Clamp bounds on Holland's B parameter. Below 0.8 the profile is
    * implausibly flat; above 2.5 it produces sharper peaks than have
    * been observed in Atlantic hurricanes. */
  val MinHollandB: Double = 0.8d
  val MaxHollandB: Double = 2.5d

  /** Derive Holland's B from V_max (m/s) and pressure difference (Pa). */
  def deriveB(vMaxMs: Double, deltaPPa: Double): Double = {
    if (vMaxMs <= 0d || deltaPPa <= 0d) return 1.0d
    val b = E * vMaxMs * vMaxMs * AirDensityKgPerM3 / deltaPPa
    math.max(MinHollandB, math.min(MaxHollandB, b))
  }

  /** Coriolis parameter at a given latitude. */
  def coriolisAt(latitudeDeg: Double): Double =
    2d * OmegaRadPerSec * math.sin(math.toRadians(math.abs(latitudeDeg)))

  /** Holland surface wind in knots at radial distance `rKm` from a storm
    * with max wind `vMaxKt`, radius of max winds `rMaxKm`, central
    * pressure `pcMb`, at latitude `latitudeDeg`. Zero when any input is
    * missing or non-physical.
    */
  def surfaceWindKt(
      rKm: Double,
      rMaxKm: Double,
      vMaxKt: Double,
      pcMb: Double,
      latitudeDeg: Double,
      pnMb: Double = EnvironmentalPressureMb
  ): Double = {
    if (rMaxKm <= 0d || vMaxKt <= 0d) return 0d
    if (pcMb <= 0d || pcMb >= pnMb) return 0d

    val vMaxMs = vMaxKt * KtToMPerSec
    val deltaPPa = math.max(100d, (pnMb - pcMb) * 100d) // at least 1 mb
    val b = deriveB(vMaxMs, deltaPPa)

    val rMeters = math.max(1d, rKm * 1000d)
    val rMaxMeters = rMaxKm * 1000d
    val ratio = math.pow(rMaxMeters / rMeters, b)

    val f = coriolisAt(latitudeDeg)
    val coriolisTerm = rMeters * f / 2d
    val radicand =
      b * ratio * (deltaPPa / AirDensityKgPerM3) * math.exp(-ratio) +
        coriolisTerm * coriolisTerm
    val vGradientMs =
      if (radicand <= 0d) 0d
      else math.max(0d, math.sqrt(radicand) - coriolisTerm)

    val vSurfaceMs = vGradientMs * GradientToSurfaceFactor
    vSurfaceMs / KtToMPerSec
  }
}
