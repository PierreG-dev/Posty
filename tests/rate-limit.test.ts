import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit, resetRateLimit } from "@/modules/shared/auth/rate-limit";

describe("shared/auth/rate-limit", () => {
  beforeEach(() => resetRateLimit());

  it("allows 5 attempts then blocks the 6th", () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit("k").allowed).toBe(true);
    }
    const r = checkRateLimit("k");
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
  });

  it("keys are independent", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("a");
    expect(checkRateLimit("a").allowed).toBe(false);
    expect(checkRateLimit("b").allowed).toBe(true);
  });
});
