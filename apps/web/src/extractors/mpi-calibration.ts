import type {
  PosteriorBundle,
  MarginalPortfolioImpactOutput,
  MarginalPortfolioImpactRainierCalibration,
} from "@/types/api";
import type { MpiRainierCalibrationDisplay } from "@/types/display";
import { isObject, asFiniteNumber, asString } from "@/lib/type-coercion";

export function extractMpiRainierCalibration(
  bundle: PosteriorBundle
): MpiRainierCalibrationDisplay | null {
  const rawOutput: MarginalPortfolioImpactOutput | undefined =
    bundle.moduleOutputs?.marginalPortfolioImpact ??
    bundle.marginalPortfolioImpact;

  if (!isObject(rawOutput)) return null;

  const calibration = (rawOutput as MarginalPortfolioImpactOutput)
    .rainierCalibration;
  if (!isObject(calibration)) return null;

  const typed = calibration as MarginalPortfolioImpactRainierCalibration;
  const diagnostics = isObject(typed.diagnostics)
    ? typed.diagnostics
    : undefined;
  const status = asString(typed.status) ?? "unknown";

  return {
    status,
    engineProfile: asString(typed.engineProfile),
    message: asString(typed.message),
    posteriorMeanRate: asFiniteNumber(typed.posteriorMeanRate),
    posteriorMedianRate: asFiniteNumber(typed.posteriorMedianRate),
    posteriorP05Rate: asFiniteNumber(typed.posteriorP05Rate),
    posteriorP95Rate: asFiniteNumber(typed.posteriorP95Rate),
    posteriorStdDevRate: asFiniteNumber(typed.posteriorStdDevRate),
    posteriorSampleCount: asFiniteNumber(typed.posteriorSampleCount),
    deterministicBaseRate: asFiniteNumber(typed.deterministicBaseRate),
    scaleFactor: asFiniteNumber(typed.scaleFactor),
    observedRateCount: asFiniteNumber(typed.observedRateCount),
    mapRate: asFiniteNumber(typed.mapRate),
    rHatMax: diagnostics ? asFiniteNumber(diagnostics.rHatMax) : undefined,
    essMin: diagnostics ? asFiniteNumber(diagnostics.essMin) : undefined,
  };
}
