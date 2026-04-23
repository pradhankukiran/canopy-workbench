/**
 * Lightweight client-side check for the property-portfolio v2 schema. The
 * server still validates with ajv on every submit; this function gives
 * the user inline feedback BEFORE they upload, so a malformed file is
 * caught in the browser instead of via the API's 400 response.
 *
 * Not a full ajv implementation - it verifies the structural invariants
 * that catch 90% of real mistakes (missing required fields, wrong types,
 * out-of-range lat/lon).
 */

export interface PortfolioCheckIssue {
  path: string;
  message: string;
}

export interface PortfolioCheckResult {
  ok: boolean;
  issues: PortfolioCheckIssue[];
  locationCount: number;
  portfolioId?: string;
}

const KNOWN_OCCUPANCY_CLASSES = new Set([
  "residential_single_family",
  "residential_multi_family",
  "commercial_retail",
  "commercial_office",
  "industrial_light",
  "industrial_heavy",
  "hospitality",
  "healthcare",
  "education",
  "government",
  "agricultural",
  "warehouse",
  "other",
]);

const KNOWN_CONSTRUCTION_CLASSES = new Set([
  "wood_frame",
  "masonry_unreinforced",
  "masonry_reinforced",
  "reinforced_concrete",
  "steel_frame",
  "manufactured_home",
  "mixed",
  "other",
]);

const KNOWN_CODE_ERAS = new Set([
  "pre_code",
  "legacy_code",
  "moderate_code",
  "modern_code",
  "high_code",
]);

export function checkPropertyPortfolio(data: unknown): PortfolioCheckResult {
  const issues: PortfolioCheckIssue[] = [];

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {
      ok: false,
      issues: [{ path: "$", message: "must be a JSON object" }],
      locationCount: 0,
    };
  }
  const root = data as Record<string, unknown>;

  // Required top-level fields
  const portfolioId = root.portfolioId;
  if (typeof portfolioId !== "string" || portfolioId.length === 0) {
    issues.push({ path: "$.portfolioId", message: "missing or not a string" });
  }
  if (typeof root.name !== "string" || (root.name as string).length === 0) {
    issues.push({ path: "$.name", message: "missing or not a string" });
  }
  if (typeof root.currency !== "string" || !/^[A-Z]{3}$/.test(root.currency as string)) {
    issues.push({ path: "$.currency", message: "must be a 3-letter ISO code" });
  }

  // Locations
  const locations = root.locations;
  if (!Array.isArray(locations)) {
    issues.push({ path: "$.locations", message: "must be an array" });
    return {
      ok: issues.length === 0,
      issues,
      locationCount: 0,
      portfolioId: typeof portfolioId === "string" ? portfolioId : undefined,
    };
  }
  if (locations.length === 0) {
    issues.push({ path: "$.locations", message: "must contain at least one entry" });
  }

  locations.forEach((loc: unknown, idx) => {
    const base = `$.locations[${idx}]`;
    if (!loc || typeof loc !== "object" || Array.isArray(loc)) {
      issues.push({ path: base, message: "must be an object" });
      return;
    }
    const l = loc as Record<string, unknown>;
    if (typeof l.locationId !== "string" || (l.locationId as string).length === 0) {
      issues.push({ path: `${base}.locationId`, message: "missing or empty" });
    }
    if (typeof l.country !== "string" || (l.country as string).length < 2) {
      issues.push({ path: `${base}.country`, message: "must be a country code" });
    }
    if (!Array.isArray(l.perilSet) || (l.perilSet as unknown[]).length === 0) {
      issues.push({ path: `${base}.perilSet`, message: "must be a non-empty array" });
    }
    if (typeof l.tiv !== "number" || !Number.isFinite(l.tiv) || l.tiv < 0) {
      issues.push({ path: `${base}.tiv`, message: "must be a non-negative number" });
    }
    if (l.latitude !== undefined) {
      if (typeof l.latitude !== "number" || l.latitude < -90 || l.latitude > 90) {
        issues.push({
          path: `${base}.latitude`,
          message: "must be a number in [-90, 90]",
        });
      }
    }
    if (l.longitude !== undefined) {
      if (typeof l.longitude !== "number" || l.longitude < -180 || l.longitude > 180) {
        issues.push({
          path: `${base}.longitude`,
          message: "must be a number in [-180, 180]",
        });
      }
    }
    if (l.occupancyClass !== undefined && !KNOWN_OCCUPANCY_CLASSES.has(l.occupancyClass as string)) {
      issues.push({
        path: `${base}.occupancyClass`,
        message: `unknown occupancyClass '${l.occupancyClass}'`,
      });
    }
    if (l.constructionClass !== undefined && !KNOWN_CONSTRUCTION_CLASSES.has(l.constructionClass as string)) {
      issues.push({
        path: `${base}.constructionClass`,
        message: `unknown constructionClass '${l.constructionClass}'`,
      });
    }
    if (l.codeEra !== undefined && !KNOWN_CODE_ERAS.has(l.codeEra as string)) {
      issues.push({
        path: `${base}.codeEra`,
        message: `unknown codeEra '${l.codeEra}'`,
      });
    }
    if (l.yearBuilt !== undefined) {
      if (typeof l.yearBuilt !== "number" || l.yearBuilt < 1800 || l.yearBuilt > 2100) {
        issues.push({
          path: `${base}.yearBuilt`,
          message: "must be an integer in [1800, 2100]",
        });
      }
    }
  });

  return {
    ok: issues.length === 0,
    issues,
    locationCount: locations.length,
    portfolioId: typeof portfolioId === "string" ? portfolioId : undefined,
  };
}

/** Parse a File's contents and run the portfolio check in one call. */
export async function checkPortfolioFile(file: File): Promise<PortfolioCheckResult> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    return {
      ok: false,
      issues: [{ path: "$", message: "failed to read file contents" }],
      locationCount: 0,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      issues: [
        { path: "$", message: `invalid JSON: ${(err as Error).message}` },
      ],
      locationCount: 0,
    };
  }
  return checkPropertyPortfolio(parsed);
}
