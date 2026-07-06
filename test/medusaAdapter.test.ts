import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MedusaAuthError } from "../src/medusa/client.js";
import { createMedusaAdapter } from "../src/shop/adapters/medusaAdapter.js";
import { clearActiveCartId } from "../src/shop/cartIdStore.js";
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

  it("normalizes line-item prices from minor units", async () => {
    const adapter = createMedusaAdapter(config);
    const details = await adapter.getOrderDetails(identity, "order_1");

    expect(details?.items[0]?.unitPrice).toEqual({ amount: 59.46, currency: "EUR" });
  });

  it("maps shipment tracking from order fulfillments", async () => {
    const adapter = createMedusaAdapter(config);
    const tracking = await adapter.getOrderTracking(identity, "order_1");

    expect(tracking?.orderId).toBe("order_1");
    expect(tracking?.shipments).toEqual([
      {
        status: "shipped",
        trackingNumber: "TRK123",
        trackingUrl: "https://track.example/TRK123",
        shippedAt: "2026-04-29T00:00:00.000Z",
        deliveredAt: null,
      },
    ]);
  });

  it("searches products with normalized price and stock (public, no token)", async () => {
    state.liveTokens.clear(); // catalog must not require a customer token
    const adapter = createMedusaAdapter(config);
    const result = await adapter.searchProducts({ query: "vitamin" });

    expect(result.count).toBe(1);
    expect(result.products).toEqual([
      {
        id: "prod_1",
        title: "Vitamin D supplement",
        handle: "vitamin-d",
        thumbnail: null,
        price: { amount: 12.9, currency: "EUR" },
        inStock: true,
      },
    ]);
  });

  it("returns product details with variants", async () => {
    const adapter = createMedusaAdapter(config);
    const product = await adapter.getProduct("prod_1");

    expect(product?.description).toBe("Daily vitamin D3.");
    expect(product?.variants[0]).toEqual({
      id: "var_1",
      title: "60 tablets",
      sku: "vd-60",
      price: { amount: 12.9, currency: "EUR" },
      inStock: true,
    });
  });

  it("exposes variant and product ids on order line items", async () => {
    const adapter = createMedusaAdapter(config);
    const details = await adapter.getOrderDetails(identity, "order_1");

    expect(details?.items[0]?.variantId).toBe("var_1");
    expect(details?.items[0]?.productId).toBe("prod_1");
  });
});

describe("medusa adapter cart", () => {
  let state: MedusaFetchState;

  beforeEach(async () => {
    state = makeMedusaFetchState();
    vi.stubGlobal("fetch", makeMedusaFetch(state));
    await clearActiveCartId(identity.userId);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null when the customer has no cart", async () => {
    const adapter = createMedusaAdapter(config);
    expect(await adapter.getCart(identity)).toBeNull();
  });

  it("creates a cart on first add and reuses it afterwards", async () => {
    const adapter = createMedusaAdapter(config);
    const first = await adapter.addToCart(identity, { variantId: "var_1", quantity: 2 });
    const second = await adapter.addToCart(identity, { variantId: "var_1", quantity: 1 });

    expect(second.id).toBe(first.id);
    expect(state.carts).toHaveLength(1);
    expect(second.itemCount).toBe(3);
    expect(second.items[0]?.unitPrice).toEqual({ amount: 12.9, currency: "EUR" });
  });

  it("recovers with a fresh cart when the stored cart is gone", async () => {
    const adapter = createMedusaAdapter(config);
    const first = await adapter.addToCart(identity, { variantId: "var_1", quantity: 1 });

    state.carts.length = 0; // completed or expired on the Medusa side

    const second = await adapter.addToCart(identity, { variantId: "var_1", quantity: 1 });
    expect(second.id).not.toBe(first.id);
    expect(second.items).toHaveLength(1);
  });

  it("updates a line item quantity and removes it at zero", async () => {
    const adapter = createMedusaAdapter(config);
    const cart = await adapter.addToCart(identity, { variantId: "var_1", quantity: 2 });
    const lineId = String(cart.items[0]?.id);

    const updated = await adapter.updateCartItem(identity, lineId, 3);
    expect(updated.items[0]?.quantity).toBe(3);
    expect(updated.total).toEqual({ amount: 38.7, currency: "EUR" });

    const emptied = await adapter.updateCartItem(identity, lineId, 0);
    expect(emptied.items).toHaveLength(0);
  });
});
