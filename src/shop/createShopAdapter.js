import { createApothekaAdapter } from "./adapters/apothekaAdapter.js";
import { createMockShopAdapter } from "./adapters/mockShopAdapter.js";

export function createShopAdapter(config) {
  if (config.shop.adapter === "mock") {
    return createMockShopAdapter();
  }

  if (config.shop.adapter === "apotheka") {
    return createApothekaAdapter(config);
  }

  throw new Error(`Unsupported SHOP_ADAPTER: ${config.shop.adapter}`);
}
