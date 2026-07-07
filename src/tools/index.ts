import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig, AppLogger, AuthResult, ShopAdapter } from "../types.js";
import { registerWidgets } from "../widgets/index.js";
import { registerAddToCart } from "./addToCart.js";
import { registerGetCheckoutLink } from "./getCheckoutLink.js";
import { registerGetCurrentCustomer } from "./getCurrentCustomer.js";
import { registerGetOrderDetails } from "./getOrderDetails.js";
import { registerGetProduct } from "./getProduct.js";
import { registerListOrders } from "./listOrders.js";
import { registerSearchProducts } from "./searchProducts.js";
import { registerTrackShipment } from "./trackShipment.js";
import { registerUpdateCartItem } from "./updateCartItem.js";
import { registerViewCart } from "./viewCart.js";
import type { ToolContext } from "./shared.js";

export interface CreateServerOptions {
  config: AppConfig;
  auth: AuthResult;
  shop: ShopAdapter;
  logger: AppLogger;
  requestId: string;
}

export function createWebshopMcpServer(options: CreateServerOptions): McpServer {
  const server = new McpServer({ name: "webshop-orders", version: "0.5.0" });
  const ctx: ToolContext = options;

  registerWidgets(server, options.config);

  registerGetCurrentCustomer(server, ctx);
  registerListOrders(server, ctx);
  registerGetOrderDetails(server, ctx);
  registerTrackShipment(server, ctx);
  registerSearchProducts(server, ctx);
  registerGetProduct(server, ctx);
  registerAddToCart(server, ctx);
  registerViewCart(server, ctx);
  registerUpdateCartItem(server, ctx);
  registerGetCheckoutLink(server, ctx);

  return server;
}
