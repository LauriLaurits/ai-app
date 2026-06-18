import type { ShopAdapter } from "../../types.js";

export function createApothekaAdapter(): ShopAdapter {
  return {
    async getCurrentCustomer() {
      throw new Error("Apotheka adapter is not configured yet");
    },

    async listOrders() {
      throw new Error("Apotheka adapter is not configured yet");
    },

    async getOrderDetails() {
      throw new Error("Apotheka adapter is not configured yet");
    },
  };
}
