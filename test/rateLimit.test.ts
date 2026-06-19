import { describe, expect, it } from "vitest";
import { checkRateLimit } from "../src/oauth/rateLimit.js";

describe("checkRateLimit (memory mode)", () => {
  it("allows attempts up to the limit then blocks", async () => {
    const id = `ip-${Math.random()}`;
    expect((await checkRateLimit("login-ip", id, 3, 60)).allowed).toBe(true);
    expect((await checkRateLimit("login-ip", id, 3, 60)).allowed).toBe(true);
    expect((await checkRateLimit("login-ip", id, 3, 60)).allowed).toBe(true);

    const blocked = await checkRateLimit("login-ip", id, 3, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("tracks identifiers independently", async () => {
    const a = `ip-${Math.random()}`;
    const b = `ip-${Math.random()}`;
    await checkRateLimit("login-ip", a, 1, 60);
    expect((await checkRateLimit("login-ip", a, 1, 60)).allowed).toBe(false);
    expect((await checkRateLimit("login-ip", b, 1, 60)).allowed).toBe(true);
  });

  it("tracks buckets independently", async () => {
    const id = `same-${Math.random()}`;
    await checkRateLimit("login-ip", id, 1, 60);
    expect((await checkRateLimit("login-ip", id, 1, 60)).allowed).toBe(false);
    expect((await checkRateLimit("login-email", id, 1, 60)).allowed).toBe(true);
  });

  it("treats a non-positive limit as disabled", async () => {
    const id = `ip-${Math.random()}`;
    for (let i = 0; i < 5; i += 1) {
      expect((await checkRateLimit("login-ip", id, 0, 60)).allowed).toBe(true);
    }
  });
});
