import { readFileSync } from "node:fs";
import path from "node:path";

import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export interface ValidationFailure {
  path: string;
  message: string;
  keyword: string;
  schemaPath: string;
  params: Record<string, unknown>;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationFailure[];
}

// Resolve from this source file's directory rather than process.cwd() so
// the API behaves the same whether launched from repo root, the package
// directory, or a compiled dist location. __dirname is available because
// the API package is CommonJS.
const SCHEMA_DIR = path.resolve(__dirname, "../../../schemas/json");

function schemaPath(filename: string): string {
  return path.join(SCHEMA_DIR, filename);
}

function loadSchema(filename: string): object {
  const raw = readFileSync(schemaPath(filename), "utf8");
  return JSON.parse(raw);
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const propertyPortfolioV1 = ajv.compile(loadSchema("property-portfolio.schema.json"));
const propertyPortfolioV2 = ajv.compile(loadSchema("property-portfolio.v2.schema.json"));

function toFailures(validator: ValidateFunction): ValidationFailure[] {
  const errors = validator.errors ?? [];
  return errors.map((err: ErrorObject) => ({
    path: err.instancePath || "$",
    message: err.message ?? "validation failed",
    keyword: err.keyword,
    schemaPath: err.schemaPath,
    params: err.params as Record<string, unknown>
  }));
}

/** Validate a property portfolio against v2 (superset of v1). */
export function validatePropertyPortfolio(data: unknown): ValidationResult {
  const ok = propertyPortfolioV2(data) as boolean;
  return {
    ok,
    errors: ok ? [] : toFailures(propertyPortfolioV2)
  };
}

/** Validate a property portfolio against the v1 schema specifically. Useful
  * when a caller wants to know if their payload is strict-v1 compliant. */
export function validatePropertyPortfolioV1(data: unknown): ValidationResult {
  const ok = propertyPortfolioV1(data) as boolean;
  return {
    ok,
    errors: ok ? [] : toFailures(propertyPortfolioV1)
  };
}

/** Extract the property-portfolio object from a pricing-run request body
  * if one is present. Returns undefined when no portfolio is embedded
  * (e.g. the client is using an uploadId reference instead).
  *
  * The engine input can embed the portfolio at several legacy locations;
  * this is authoritative for the API request validator.
  */
export function extractEmbeddedPropertyPortfolio(input: unknown): unknown | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;

  // Preferred v2 path: candidateDeal.portfolio.propertyPortfolio
  const candidateDeal = record.candidateDeal as Record<string, unknown> | undefined;
  const portfolio = candidateDeal?.portfolio as Record<string, unknown> | undefined;
  if (portfolio?.propertyPortfolio) return portfolio.propertyPortfolio;

  // Legacy flat: input.propertyPortfolio
  if (record.propertyPortfolio) return record.propertyPortfolio;

  // Nested inside moduleParameters.propertyCatPricing.propertyPortfolio
  const moduleParams = record.moduleParameters as Record<string, unknown> | undefined;
  const pricingParams = moduleParams?.propertyCatPricing as Record<string, unknown> | undefined;
  if (pricingParams?.propertyPortfolio) return pricingParams.propertyPortfolio;

  return undefined;
}
