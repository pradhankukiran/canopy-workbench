/**
 * In-memory token-bucket rate limiter keyed on a caller identifier
 * (principal.keyId when authenticated, "anonymous" otherwise).
 *
 * This is intentionally in-process (no Redis-backed distributed state):
 * the canopy-workbench API runs in a single process today and multi-
 * instance deployments should prefer a real rate-limit plugin. The
 * limiter is useful for blocking aggressive scrape loops and bot
 * traffic at the single-node boundary.
 */

export interface RateLimitConfig {
  /** Tokens added per second. Sustained request rate ceiling. */
  tokensPerSecond: number;
  /** Maximum tokens in the bucket. Burst ceiling. */
  burst: number;
}

interface Bucket {
  tokens: number;
  lastRefilledMs: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly config: RateLimitConfig) {
    if (config.burst <= 0) throw new Error("burst must be > 0");
    if (config.tokensPerSecond <= 0)
      throw new Error("tokensPerSecond must be > 0");
  }

  /** Attempt to spend one token on behalf of `key`. Returns whether the
    * request is permitted, plus when the next token will become
    * available (milliseconds epoch) for the caller to return as
    * Retry-After. */
  take(key: string, nowMs: number = Date.now()): { allowed: boolean; retryAfterMs: number } {
    const bucket = this.buckets.get(key) ?? this.newBucket(nowMs);
    this.refill(bucket, nowMs);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      this.buckets.set(key, bucket);
      return { allowed: true, retryAfterMs: 0 };
    }

    const deficit = 1 - bucket.tokens;
    const waitMs = Math.ceil((deficit / this.config.tokensPerSecond) * 1000);
    this.buckets.set(key, bucket);
    return { allowed: false, retryAfterMs: waitMs };
  }

  /** For tests. */
  reset(): void {
    this.buckets.clear();
  }

  private refill(bucket: Bucket, nowMs: number): void {
    const elapsedSeconds = Math.max(0, (nowMs - bucket.lastRefilledMs) / 1000);
    const refill = elapsedSeconds * this.config.tokensPerSecond;
    bucket.tokens = Math.min(this.config.burst, bucket.tokens + refill);
    bucket.lastRefilledMs = nowMs;
  }

  private newBucket(nowMs: number): Bucket {
    return { tokens: this.config.burst, lastRefilledMs: nowMs };
  }
}
