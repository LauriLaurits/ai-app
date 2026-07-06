import { describe, expect, it } from "vitest";
import {
  clearActiveCartId,
  getActiveCartId,
  setActiveCartId,
} from "../src/shop/cartIdStore.js";

describe("cart id store", () => {
  it("round-trips an active cart id per customer", async () => {
    await setActiveCartId("cus_cartstore_1", "cart_abc");
    expect(await getActiveCartId("cus_cartstore_1")).toBe("cart_abc");
  });

  it("clears the stored cart id", async () => {
    await setActiveCartId("cus_cartstore_2", "cart_def");
    await clearActiveCartId("cus_cartstore_2");
    expect(await getActiveCartId("cus_cartstore_2")).toBeNull();
  });

  it("returns null when nothing is stored", async () => {
    expect(await getActiveCartId("cus_cartstore_none")).toBeNull();
  });
});
