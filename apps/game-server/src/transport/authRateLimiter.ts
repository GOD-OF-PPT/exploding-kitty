/**
 * Lightweight in-memory IP-based rate limiter for auth endpoints.
 *
 * No external dependencies. Uses a `Map<ip, { count, windowStart }>` to track
 * request counts per source IP within a sliding window. When the count
 * exceeds the limit within the window, `tryAcquire` returns false and the
 * caller should respond with HTTP 429.
 *
 * The counter is per-IP, so different clients are unaffected. The window
 * resets after the configured duration, allowing the client to retry.
 */
export type AuthRateLimiterOptions = Readonly<{
  /** Maximum requests per window per IP. Default: 60. */
  limit?: number;
  /** Window duration in milliseconds. Default: 60000 (60 seconds). */
  windowMs?: number;
}>;

export class AuthRateLimiter {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #counters = new Map<string, { count: number; windowStart: number }>();

  constructor(options?: AuthRateLimiterOptions) {
    this.#limit = options?.limit ?? 60;
    this.#windowMs = options?.windowMs ?? 60_000;
  }

  /**
   * Attempts to acquire a request slot for the given IP. Returns true if the
   * request is allowed (within the per-window limit), false if it should be
   * rejected with HTTP 429.
   */
  tryAcquire(ip: string): boolean {
    const now = Date.now();
    let entry = this.#counters.get(ip);
    if (!entry || now - entry.windowStart >= this.#windowMs) {
      entry = { count: 0, windowStart: now };
      this.#counters.set(ip, entry);
    }
    return ++entry.count <= this.#limit;
  }
}
