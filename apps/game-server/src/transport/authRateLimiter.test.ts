import { describe, expect, it, vi } from "vitest";
import { AuthRateLimiter } from "./authRateLimiter.js";

describe("AuthRateLimiter (VAL-M2-002)", () => {
  it("allows up to 60 requests per minute by default", () => {
    const limiter = new AuthRateLimiter();
    for (let i = 0; i < 60; i++) {
      expect(limiter.tryAcquire("1.2.3.4")).toBe(true);
    }
  });

  it("rejects the 61st request in the same window", () => {
    const limiter = new AuthRateLimiter();
    for (let i = 0; i < 60; i++) {
      expect(limiter.tryAcquire("1.2.3.4")).toBe(true);
    }
    expect(limiter.tryAcquire("1.2.3.4")).toBe(false);
  });

  it("different IP addresses are unaffected", () => {
    const limiter = new AuthRateLimiter({ limit: 2 });
    expect(limiter.tryAcquire("1.2.3.4")).toBe(true);
    expect(limiter.tryAcquire("1.2.3.4")).toBe(true);
    expect(limiter.tryAcquire("1.2.3.4")).toBe(false);
    // Different IP has a fresh budget
    expect(limiter.tryAcquire("5.6.7.8")).toBe(true);
    expect(limiter.tryAcquire("5.6.7.8")).toBe(true);
    expect(limiter.tryAcquire("5.6.7.8")).toBe(false);
  });

  it("window resets after the configured duration", () => {
    vi.useFakeTimers();
    try {
      const limiter = new AuthRateLimiter({ limit: 2, windowMs: 60_000 });
      expect(limiter.tryAcquire("1.2.3.4")).toBe(true);
      expect(limiter.tryAcquire("1.2.3.4")).toBe(true);
      expect(limiter.tryAcquire("1.2.3.4")).toBe(false);
      vi.advanceTimersByTime(60_001);
      expect(limiter.tryAcquire("1.2.3.4")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("custom limit and window options are respected", () => {
    vi.useFakeTimers();
    try {
      const limiter = new AuthRateLimiter({ limit: 5, windowMs: 10_000 });
      for (let i = 0; i < 5; i++) expect(limiter.tryAcquire("1.2.3.4")).toBe(true);
      expect(limiter.tryAcquire("1.2.3.4")).toBe(false);
      vi.advanceTimersByTime(10_001);
      expect(limiter.tryAcquire("1.2.3.4")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
