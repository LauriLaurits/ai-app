import { describe, expect, it } from "vitest";
import { cartToDomain } from "../src/shop/adapters/medusaMappers.js";

describe("cartToDomain", () => {
  it("maps a Medusa cart with minor-unit prices", () => {
    const cart = cartToDomain({
      id: "cart_1",
      currency_code: "eur",
      total: 3870,
      items: [
        {
          id: "line_1",
          variant_id: "var_1",
          product_id: "prod_1",
          product_title: "Vitamin D supplement",
          quantity: 3,
          unit_price: 1290,
          total: 3870,
        },
      ],
    });

    expect(cart).toEqual({
      id: "cart_1",
      itemCount: 3,
      total: { amount: 38.7, currency: "EUR" },
      items: [
        {
          id: "line_1",
          variantId: "var_1",
          productId: "prod_1",
          title: "Vitamin D supplement",
          quantity: 3,
          unitPrice: { amount: 12.9, currency: "EUR" },
          lineTotal: { amount: 38.7, currency: "EUR" },
        },
      ],
    });
  });

  it("keeps zero-decimal currencies intact", () => {
    const cart = cartToDomain({
      id: "cart_jp",
      currency_code: "jpy",
      total: 1500,
      items: [{ id: "l1", quantity: 1, unit_price: 1500, total: 1500 }],
    });

    expect(cart.total).toEqual({ amount: 1500, currency: "JPY" });
    expect(cart.items[0]?.unitPrice).toEqual({ amount: 1500, currency: "JPY" });
  });

  it("handles a cart with no items array", () => {
    const cart = cartToDomain({ id: "cart_empty", currency_code: "eur", total: 0 });

    expect(cart.items).toEqual([]);
    expect(cart.itemCount).toBe(0);
    expect(cart.total).toEqual({ amount: 0, currency: "EUR" });
  });
});
