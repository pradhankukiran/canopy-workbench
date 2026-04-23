import { beforeEach, describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limit";

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter({ tokensPerSecond: 10, burst: 5 });
  });

  it("allows up to burst tokens immediately", () => {
    for (let i = 0; i < 5; i++) {
      const r = limiter.take("k1", 1_000_000);
      expect(r.allowed).toBe(true);
    }
  });

  it("blocks the next request after burst is exhausted at t=0", () => {
    for (let i = 0; i < 5; i++) limiter.take("k1", 1_000_000);
    const r = limiter.take("k1", 1_000_000);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterMs).toBeGreaterThan(0);
  });

  it("refills tokens over time at the configured rate", () => {
    for (let i = 0; i < 5; i++) limiter.take("k1", 1_000_000);
    const r = limiter.take("k1", 1_000_100); // 100ms later, +1 token
    expect(r.allowed).toBe(true);
  });

  it("buckets are independent per key", () => {
    for (let i = 0; i < 5; i++) limiter.take("a", 1_000_000);
    for (let i = 0; i < 5; i++) {
      const r = limiter.take("b", 1_000_000);
      expect(r.allowed).toBe(true);
    }
  });

  it("tokens cap at burst even with a long elapsed interval", () => {
    limiter.take("k1", 1_000_000); // -1
    const r = limiter.take("k1", 10_000_000); // plenty refilled
    expect(r.allowed).toBe(true);
    // After this take, bucket should be at burst - 1 = 4; next 4 should all allow.
    for (let i = 0; i < 4; i++) expect(limiter.take("k1", 10_000_000).allowed).toBe(true);
    expect(limiter.take("k1", 10_000_000).allowed).toBe(false);
  });

  it("retryAfterMs shrinks as the bucket refills", () => {
    for (let i = 0; i < 5; i++) limiter.take("k1", 1_000_000);
    const firstFail = limiter.take("k1", 1_000_000);
    const laterFail = limiter.take("k1", 1_000_050);
    expect(laterFail.retryAfterMs).toBeLessThan(firstFail.retryAfterMs);
  });
});
