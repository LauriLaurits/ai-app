import type { ShopAdapter } from "../../types.js";

export function createApothekaAdapter(): ShopAdapter {
  const notReady = (): never => {
    throw new Error("Apotheka adapter is not configured yet");
  };

  return {
    getCurrentCustomer: notReady,
    listOrders: notReady,
    getOrderDetails: notReady,
    getOrderTracking: notReady,
    searchProducts: notReady,
    getProduct: notReady,
  };
}
