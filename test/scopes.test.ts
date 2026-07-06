import { describe, expect, it } from "vitest";
import { authenticateRequest } from "../src/auth/tokenVerifier.js";
import { protectedResourceMetadata } from "../src/httpHandlers.js";
import { oauthMetadata } from "../src/oauth/metadata.js";
import { parseScopes, supportedScopes } from "../src/oauth/validation.js";
import { makeConfig, makeReq } from "./helpers.js";

describe("cart scopes", () => {
  it("lists all four scopes as supported", () => {
    const config = makeConfig();
    expect(supportedScopes(config)).toEqual([
      "profile.read",
      "orders.read",
      "cart.read",
      "cart.write",
    ]);
  });

  it("defaults token requests without a scope param to all supported scopes", () => {
    const config = makeConfig();
    expect(parseScopes(config, undefined)).toEqual([
      "profile.read",
      "orders.read",
      "cart.read",
      "cart.write",
    ]);
  });

  it("accepts explicitly requested cart scopes", () => {
    const config = makeConfig();
    expect(parseScopes(config, "cart.read cart.write")).toEqual([
      "cart.read",
      "cart.write",
    ]);
  });

  it("advertises cart scopes in protected resource metadata", () => {
    const scopes = protectedResourceMetadata().scopes_supported as string[];
    expect(scopes).toEqual(
      expect.arrayContaining(["cart.read", "cart.write"])
    );
  });

  it("advertises cart scopes in authorization server metadata", () => {
    const config = makeConfig();
    const scopes = oauthMetadata(config).scopes_supported as string[];
    expect(scopes).toEqual(
      expect.arrayContaining(["cart.read", "cart.write", "offline"])
    );
  });

  it("grants demo-mode auth cart.read but never cart.write (shared unauthenticated cart)", async () => {
    const config = makeConfig({ auth: { mode: "demo" }, shop: { adapter: "mock" } });
    const req = makeReq();

    const auth = await authenticateRequest(req, config);

    expect(auth.status).toBe("authenticated");
    expect(auth.scopes).toContain("cart.read");
    expect(auth.scopes).not.toContain("cart.write");
  });
});
