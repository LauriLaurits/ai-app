import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "../types.js";
import { cartWidget } from "./cartWidget.js";
import { productGridWidget } from "./productGridWidget.js";
import { registerWidgetResources, widgetToolMeta } from "./registry.js";

export const PRODUCT_GRID_URI = productGridWidget.uri;
export const CART_URI = cartWidget.uri;
export { widgetToolMeta };

export function registerWidgets(server: McpServer, config: AppConfig): void {
  registerWidgetResources(server, config, [productGridWidget, cartWidget]);
}
