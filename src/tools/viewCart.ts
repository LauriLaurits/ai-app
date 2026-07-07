import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CART_URI, widgetToolMeta } from "../widgets/index.js";
import { cartSchema } from "./schemas.js";
import { jsonResult, runTool, type ToolContext } from "./shared.js";

export function registerViewCart(server: McpServer, ctx: ToolContext): void {
  const scopes = [ctx.config.scopes.cartRead];

  server.registerTool(
    "view_cart",
    {
      title: "View cart",
      description:
        "Returns the customer's active shopping cart: items, quantities, unit " +
        "prices and totals. Returns null when no cart exists yet.",
      inputSchema: {},
      outputSchema: { cart: cartSchema.nullable() },
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: widgetToolMeta(CART_URI, "Loading your cart…", "Cart loaded"),
    },
    async (args) =>
      runTool(ctx, "view_cart", args, scopes, async (identity) => {
        const cart = await ctx.shop.getCart(identity);
        return jsonResult({ cart });
      })
  );
}
