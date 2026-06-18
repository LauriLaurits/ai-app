import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MedusaAuthError } from "../src/medusa/client.js";
import { createMedusaAdapter } from "../src/shop/adapters/medusaAdapter.js";
import type { Identity } from "../src/types.js";
import {
  makeConfig,
  makeMedusaFetch,
  makeMedusaFetchState,
  type MedusaFetchState,
} from "./helpers.js";

const config = makeConfig();

const identity: Identity = {
  userId: "cus_1",
  displayName: "Lauri Laurits",
  shopIds: ["medusa"],
  medusaToken: "medusa-jwt-1",
};

describe("medusa adapter", () => {
  let state: MedusaFetchState;

  beforeEach(() => {
    state = makeMedusaFetchState();
    vi.stubGlobal("fetch", makeMedusaFetch(state));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps Medusa orders to order summaries", async () => {
    const adapter = createMedusaAdapter(config);
    const orders = await adapter.listOrders(identity);

    expect(orders).toEqual([
      {
        id: "order_1",
        orderedAt: "2026-04-28T00:00:00.000Z",
        status: "pending",
        fulfillment: "partially_fulfilled",
        total: { amount: 297.31, currency: "EUR" },
        itemCount: 1,
      },
    ]);
  });

  it("maps the customer profile with a masked email", async () => {
    const adapter = createMedusaAdapter(config);
    const customer = await adapter.getCurrentCustomer(identity);

    expect(customer.id).toBe("cus_1");
    expect(customer.displayName).toBe("Lauri Laurits");
    expect(customer.emailMasked).toBe("la***@example.com");
  });

  it("propagates MedusaAuthError for expired per-customer tokens", async () => {
    state.liveTokens.clear();
    const adapter = createMedusaAdapter(config);

    await expect(adapter.listOrders(identity)).rejects.toThrow(MedusaAuthError);
  });

  it("requires fallback credentials when no customer token is present", async () => {
    const adapter = createMedusaAdapter(config);

    await expect(
      adapter.listOrders({ userId: "x", displayName: "X", shopIds: ["medusa"] })
    ).rejects.toThrow(/MEDUSA_CUSTOMER_EMAIL/);
  });
});
