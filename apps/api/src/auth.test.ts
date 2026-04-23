import { describe, expect, it } from "vitest";
import {
  extractBearerToken,
  generateApiKey,
  hashApiKey,
  looksLikeApiKey,
  prefixOf,
  verifyApiKey
} from "./auth";

describe("generateApiKey", () => {
  it("returns a ck_-prefixed key of plausible length", () => {
    const key = generateApiKey();
    expect(key.startsWith("ck_")).toBe(true);
    expect(key.length).toBeGreaterThan(40);
  });

  it("never returns the same key twice", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 100; i++) keys.add(generateApiKey());
    expect(keys.size).toBe(100);
  });
});

describe("hashApiKey + verifyApiKey", () => {
  it("verifies the key that was hashed", () => {
    const key = generateApiKey();
    const { hash, salt } = hashApiKey(key);
    expect(verifyApiKey(key, hash, salt)).toBe(true);
  });

  it("rejects a tampered key", () => {
    const key = generateApiKey();
    const { hash, salt } = hashApiKey(key);
    expect(verifyApiKey(key + "x", hash, salt)).toBe(false);
  });

  it("rejects a different key with the same salt", () => {
    const key1 = generateApiKey();
    const key2 = generateApiKey();
    const { hash, salt } = hashApiKey(key1);
    expect(verifyApiKey(key2, hash, salt)).toBe(false);
  });

  it("produces different salts on consecutive hashes of the same key", () => {
    const key = generateApiKey();
    const a = hashApiKey(key);
    const b = hashApiKey(key);
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe("prefixOf", () => {
  it("returns the first 10 characters of a key", () => {
    const key = "ck_abcdef1234567890";
    expect(prefixOf(key)).toBe("ck_abcdef1");
    expect(prefixOf(key).length).toBe(10);
  });
});

describe("looksLikeApiKey", () => {
  it("accepts well-formed keys", () => {
    expect(looksLikeApiKey(generateApiKey())).toBe(true);
  });

  it("rejects plain text", () => {
    expect(looksLikeApiKey("hello")).toBe(false);
    expect(looksLikeApiKey("ck_short")).toBe(false);
    expect(looksLikeApiKey("not_ck_prefix_but_long_enough_yes_really")).toBe(false);
  });
});

describe("extractBearerToken", () => {
  it("parses Authorization: Bearer", () => {
    expect(extractBearerToken({ authorization: "Bearer ck_xyz" })).toBe("ck_xyz");
  });

  it("is case-insensitive on the scheme", () => {
    expect(extractBearerToken({ authorization: "bearer ck_xyz" })).toBe("ck_xyz");
  });

  it("accepts X-Api-Key header", () => {
    expect(extractBearerToken({ "x-api-key": "ck_xyz" })).toBe("ck_xyz");
  });

  it("returns undefined when no token present", () => {
    expect(extractBearerToken({})).toBeUndefined();
    expect(extractBearerToken({ authorization: "" })).toBeUndefined();
    expect(extractBearerToken({ authorization: "Basic user:pass" })).toBeUndefined();
  });
});
