import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** A resolved caller identity. Populated by the API-key middleware from a
  * validated Bearer token. Request handlers consult this instead of defaulting
  * to the demo workspace.
  */
export interface Principal {
  userId: string;
  workspaceId: string;
  keyId: string;
  keyName?: string;
  source: "api_key" | "anonymous";
}

export interface ApiKeyRecord {
  keyId: string;
  workspaceId: string;
  userId: string;
  name?: string;
  keyPrefix: string;
  keyHash: string;
  keySalt: string;
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
  revokedAt?: string;
}

const KEY_BYTES = 32;
const KEY_PREFIX = "ck_";
const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384;

/** Generate a fresh random API key string. Format: ck_<base64url-64ish>. The
  * caller stores the hash and returns the plaintext exactly once. */
export function generateApiKey(): string {
  return KEY_PREFIX + randomBytes(KEY_BYTES).toString("base64url");
}

/** Return the stable lookup prefix of a key: the first 10 characters. Short
  * enough to log, long enough to pick a key row. Must match what's stored in
  * ApiKeyRecord.keyPrefix. */
export function prefixOf(plainKey: string): string {
  return plainKey.slice(0, 10);
}

export function hashApiKey(plainKey: string, salt?: Buffer): { hash: string; salt: string } {
  const saltBytes = salt ?? randomBytes(16);
  const derived = scryptSync(plainKey, saltBytes, SCRYPT_KEYLEN, { cost: SCRYPT_COST });
  return {
    hash: derived.toString("base64"),
    salt: saltBytes.toString("base64")
  };
}

export function verifyApiKey(plainKey: string, hash: string, salt: string): boolean {
  const saltBytes = Buffer.from(salt, "base64");
  const expected = Buffer.from(hash, "base64");
  const derived = scryptSync(plainKey, saltBytes, SCRYPT_KEYLEN, { cost: SCRYPT_COST });
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/** Extract a Bearer token from an Authorization header or from an X-Api-Key
  * header. Returns undefined when no token is present. */
export function extractBearerToken(headers: Record<string, string | string[] | undefined>): string | undefined {
  const direct = headers["x-api-key"];
  if (typeof direct === "string" && direct.trim().length > 0) return direct.trim();

  const auth = headers.authorization;
  const header = Array.isArray(auth) ? auth[0] : auth;
  if (!header) return undefined;
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return undefined;
  const token = match[1].trim();
  return token.length > 0 ? token : undefined;
}

/** Validate that a string looks like one of our API keys. Not a security
  * check — just a cheap filter to avoid expensive scrypt calls on obvious
  * non-matches. */
export function looksLikeApiKey(candidate: string): boolean {
  return candidate.startsWith(KEY_PREFIX) && candidate.length >= KEY_PREFIX.length + 20;
}
