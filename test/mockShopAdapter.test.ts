import { describe, expect, it } from "vitest";
import { createMockShopAdapter } from "../src/shop/adapters/mockShopAdapter.js";

const shop = createMockShopAdapter();

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
