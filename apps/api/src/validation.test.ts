import { describe, expect, it } from "vitest";
import {
  extractEmbeddedPropertyPortfolio,
  validatePropertyPortfolio
} from "./validation";

const minimalValidPortfolio = {
  portfolioId: "pf_test001",
  name: "minimal",
  currency: "USD",
  locations: [
    {
      locationId: "loc_a1",
      country: "US",
      perilSet: ["WIND"],
      tiv: 1_000_000
    }
  ]
};

const fullV2Portfolio = {
  ...minimalValidPortfolio,
  schemaVersion: "v2",
  locations: [
    {
      ...minimalValidPortfolio.locations[0],
      latitude: 29.5,
      longitude: -90,
      deductible: 50_000,
      limit: 800_000,
      occupancyClass: "commercial_office",
      constructionClass: "steel_frame",
      yearBuilt: 2005,
      numberOfStories: 6,
      codeEra: "modern_code",
      perilDeductibles: { WIND: 50_000 },
      sublimits: { WIND: 500_000 }
    }
  ]
};

describe("validatePropertyPortfolio", () => {
  it("accepts a minimal v1-style portfolio", () => {
    const r = validatePropertyPortfolio(minimalValidPortfolio);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("accepts a fully-populated v2 portfolio", () => {
    const r = validatePropertyPortfolio(fullV2Portfolio);
    expect(r.ok).toBe(true);
  });

  it("rejects missing required fields", () => {
    const bad = { ...minimalValidPortfolio, portfolioId: undefined };
    const r = validatePropertyPortfolio(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.keyword === "required")).toBe(true);
  });

  it("rejects out-of-range latitude", () => {
    const bad = {
      ...minimalValidPortfolio,
      locations: [{ ...minimalValidPortfolio.locations[0], latitude: 200 }]
    };
    const r = validatePropertyPortfolio(bad);
    expect(r.ok).toBe(false);
    const latErr = r.errors.find((e) => e.path.includes("latitude"));
    expect(latErr).toBeDefined();
  });

  it("rejects unknown occupancyClass enum", () => {
    const bad = {
      ...minimalValidPortfolio,
      locations: [
        { ...minimalValidPortfolio.locations[0], occupancyClass: "lunar_base" }
      ]
    };
    const r = validatePropertyPortfolio(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.keyword === "enum")).toBe(true);
  });

  it("rejects negative tiv", () => {
    const bad = {
      ...minimalValidPortfolio,
      locations: [{ ...minimalValidPortfolio.locations[0], tiv: -1 }]
    };
    const r = validatePropertyPortfolio(bad);
    expect(r.ok).toBe(false);
  });

  it("rejects an empty locations array", () => {
    const bad = { ...minimalValidPortfolio, locations: [] };
    const r = validatePropertyPortfolio(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.keyword === "minItems")).toBe(true);
  });

  it("rejects unexpected top-level properties", () => {
    const bad = { ...minimalValidPortfolio, rogueField: true };
    const r = validatePropertyPortfolio(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.keyword === "additionalProperties")).toBe(true);
  });
});

describe("extractEmbeddedPropertyPortfolio", () => {
  it("pulls from candidateDeal.portfolio.propertyPortfolio", () => {
    const found = extractEmbeddedPropertyPortfolio({
      candidateDeal: { portfolio: { propertyPortfolio: minimalValidPortfolio } }
    });
    expect(found).toEqual(minimalValidPortfolio);
  });

  it("pulls from flat input.propertyPortfolio", () => {
    const found = extractEmbeddedPropertyPortfolio({
      propertyPortfolio: minimalValidPortfolio
    });
    expect(found).toEqual(minimalValidPortfolio);
  });

  it("pulls from moduleParameters.propertyCatPricing.propertyPortfolio", () => {
    const found = extractEmbeddedPropertyPortfolio({
      moduleParameters: {
        propertyCatPricing: { propertyPortfolio: minimalValidPortfolio }
      }
    });
    expect(found).toEqual(minimalValidPortfolio);
  });

  it("returns undefined when nothing is embedded", () => {
    expect(extractEmbeddedPropertyPortfolio({})).toBeUndefined();
    expect(extractEmbeddedPropertyPortfolio(null)).toBeUndefined();
    expect(extractEmbeddedPropertyPortfolio(42)).toBeUndefined();
  });
});
