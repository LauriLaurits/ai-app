import type { AppConfig, ShopAdapter } from "../types.js";
import { createApothekaAdapter } from "./adapters/apothekaAdapter.js";
import { createMedusaAdapter } from "./adapters/medusaAdapter.js";
import { createMockShopAdapter } from "./adapters/mockShopAdapter.js";

export function createShopAdapter(config: AppConfig): ShopAdapter {
  if (config.shop.adapter === "mock") {
    return createMockShopAdapter();
  }

  if (config.shop.adapter === "apotheka") {
    return createApothekaAdapter();
  }

  if (config.shop.adapter === "medusa") {
    return createMedusaAdapter(config);
  }

  throw new Error(`Unsupported SHOP_ADAPTER: ${config.shop.adapter}`);
}
