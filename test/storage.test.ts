import { afterEach, describe, expect, it } from "vitest";
import {
  consumeAuthorizationCode,
  consumeRefreshToken,
  getAccessTokenSession,
  hashToken,
  randomToken,
  storeAccessToken,
  storeAuthorizationCode,
  storeRefreshToken,
} from "../src/oauth/storage.js";

describe("oauth storage (memory mode)", () => {
  afterEach(() => {
    delete process.env.VERCEL;
  });

  it("stores and retrieves an access token session", async () => {
    await storeAccessToken("token-1", { customerId: "cus_1" }, 60);
    expect(await getAccessTokenSession("token-1")).toEqual({ customerId: "cus_1" });
  });

  it("returns null for unknown tokens", async () => {
    expect(await getAccessTokenSession("unknown")).toBeNull();
  });

  it("consumes authorization codes exactly once", async () => {
    await storeAuthorizationCode("code-1", { customerId: "cus_1" }, 60);
    expect(await consumeAuthorizationCode("code-1")).toEqual({ customerId: "cus_1" });
    expect(await consumeAuthorizationCode("code-1")).toBeNull();
  });

  it("consumes refresh tokens exactly once (rotation)", async () => {
    await storeRefreshToken("refresh-1", { customerId: "cus_1" }, 60);
    expect(await consumeRefreshToken("refresh-1")).toEqual({ customerId: "cus_1" });
    expect(await consumeRefreshToken("refresh-1")).toBeNull();
  });

  it("expires memory records by TTL", async () => {
    await storeAccessToken("token-ttl", { customerId: "cus_1" }, -1);
    expect(await getAccessTokenSession("token-ttl")).toBeNull();
  });

  it("generates prefixed random tokens and stable hashes", () => {
    const token = randomToken("atk");
    expect(token.startsWith("atk_")).toBe(true);
    expect(hashToken("a")).toBe(hashToken("a"));
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });

  it("refuses to use in-memory storage on Vercel", async () => {
    process.env.VERCEL = "1";
    await expect(storeAccessToken("token-2", { customerId: "cus_1" }, 60)).rejects.toThrow(
      /UPSTASH/i
    );
  });
});
