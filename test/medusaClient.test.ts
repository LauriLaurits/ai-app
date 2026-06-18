import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loginCustomer,
  maskEmail,
  MedusaAuthError,
  MedusaRequestError,
  medusaRequest,
  refreshCustomerToken,
} from "../src/medusa/client.js";
import { makeConfig, makeMedusaFetch, makeMedusaFetchState } from "./helpers.js";

const config = makeConfig();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("medusa client", () => {
  it("logs a customer in and returns the JWT", async () => {
    vi.stubGlobal("fetch", makeMedusaFetch(makeMedusaFetchState()));
    expect(await loginCustomer(config, "lauri@example.com", "secret")).toBe(
      "medusa-jwt-1"
    );
  });

  it("throws MedusaAuthError on 401 responses", async () => {
    vi.stubGlobal("fetch", makeMedusaFetch(makeMedusaFetchState()));
    await expect(loginCustomer(config, "lauri@example.com", "wrong")).rejects.toThrow(
      MedusaAuthError
    );
  });

  it("throws MedusaRequestError with status for other failures", async () => {
    vi.stubGlobal(
      "fetch",
      (async () =>
        new Response(JSON.stringify({ message: "boom" }), { status: 500 })) as typeof fetch
    );
    const error = await medusaRequest(config, "/store/orders", "tok").catch((e) => e);
    expect(error).toBeInstanceOf(MedusaRequestError);
    expect((error as MedusaRequestError).status).toBe(500);
  });

  it("refreshes a live Medusa token", async () => {
    const state = makeMedusaFetchState();
    vi.stubGlobal("fetch", makeMedusaFetch(state));
    const next = await refreshCustomerToken(config, "medusa-jwt-1");
    expect(next).toBe("medusa-jwt-refreshed-1");
    expect(state.refreshCount).toBe(1);
  });

  it("throws MedusaAuthError when refreshing a dead token", async () => {
    vi.stubGlobal("fetch", makeMedusaFetch(makeMedusaFetchState()));
    await expect(refreshCustomerToken(config, "expired-jwt")).rejects.toThrow(
      MedusaAuthError
    );
  });

  it("masks emails without leaking the local part", () => {
    expect(maskEmail("lauri@example.com")).toBe("la***@example.com");
    expect(maskEmail("not-an-email")).toBeNull();
    expect(maskEmail(null)).toBeNull();
  });
});
