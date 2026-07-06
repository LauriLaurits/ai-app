import { describe, expect, it } from "vitest";
import { CartNotFoundError } from "../src/shop/cartErrors.js";
import { createMockShopAdapter } from "../src/shop/adapters/mockShopAdapter.js";
import type { Identity } from "../src/types.js";

const shop = createMockShopAdapter();

const cartIdentity: Identity = {
  userId: "cart-user-1",
  displayName: "Cart User",
  shopIds: ["apotheka"],
};

describe("mock shop adapter product listing", () => {
  it("lists all products when no query is given, with a total count", async () => {
    const result = await shop.searchProducts({});
    expect(result.count).toBe(2);
    expect(result.products).toHaveLength(2);
  });

  it("filters by query term", async () => {
    const result = await shop.searchProducts({ query: "vitamin" });
    expect(result.products).toHaveLength(1);
    expect(result.products[0]?.title).toContain("Vitamin");
  });

  it("pages through the catalog with limit and offset", async () => {
    const first = await shop.searchProducts({ limit: 1, offset: 0 });
    const second = await shop.searchProducts({ limit: 1, offset: 1 });

    expect(first.count).toBe(2);
    expect(first.products).toHaveLength(1);
    expect(second.products).toHaveLength(1);
    expect(second.products[0]?.id).not.toBe(first.products[0]?.id);
  });
});

describe("mock shop adapter cart", () => {
  it("returns null before anything is added", async () => {
    const shop = createMockShopAdapter();
    expect(await shop.getCart(cartIdentity)).toBeNull();
  });

  it("adds items and computes totals", async () => {
    const shop = createMockShopAdapter();
    const cart = await shop.addToCart(cartIdentity, {
      variantId: "var_demo_vit_d_60",
      quantity: 2,
    });

    expect(cart.items).toHaveLength(1);
    expect(cart.itemCount).toBe(2);
    expect(cart.total).toEqual({ amount: 25.8, currency: "EUR" });
    expect(await shop.getCart(cartIdentity)).toEqual(cart);
  });

  it("merges repeated adds of the same variant", async () => {
    const shop = createMockShopAdapter();
    await shop.addToCart(cartIdentity, { variantId: "var_demo_vit_d_60", quantity: 1 });
    const cart = await shop.addToCart(cartIdentity, {
      variantId: "var_demo_vit_d_60",
      quantity: 2,
    });

    expect(cart.items).toHaveLength(1);
    expect(cart.itemCount).toBe(3);
  });

  it("updates quantity and removes the line at zero", async () => {
    const shop = createMockShopAdapter();
    const cart = await shop.addToCart(cartIdentity, {
      variantId: "var_demo_vit_d_60",
      quantity: 2,
    });
    const lineId = String(cart.items[0]?.id);

    const updated = await shop.updateCartItem(cartIdentity, lineId, 3);
    expect(updated.items[0]?.quantity).toBe(3);
    expect(updated.total).toEqual({ amount: 38.7, currency: "EUR" });

    const emptied = await shop.updateCartItem(cartIdentity, lineId, 0);
    expect(emptied.items).toHaveLength(0);
    expect(emptied.itemCount).toBe(0);
  });

  it("rejects unknown variants", async () => {
    const shop = createMockShopAdapter();
    await expect(
      shop.addToCart(cartIdentity, { variantId: "var_nope", quantity: 1 })
    ).rejects.toThrow(/variant/i);
  });

  it("rejects unknown cart line items with a CartNotFoundError, not a generic Error", async () => {
    const shop = createMockShopAdapter();
    await shop.addToCart(cartIdentity, { variantId: "var_demo_vit_d_60", quantity: 1 });

    await expect(
      shop.updateCartItem(cartIdentity, "line_nope", 1)
    ).rejects.toThrow(CartNotFoundError);
    await expect(
      shop.updateCartItem(cartIdentity, "line_nope", 1)
    ).rejects.toThrow(/line item/i);
  });
});
