import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CART_URI, widgetToolMeta } from "../widgets/index.js";
import { cartSchema } from "./schemas.js";
import { jsonResult, runTool, type ToolContext } from "./shared.js";

export function registerUpdateCartItem(server: McpServer, ctx: ToolContext): void {
  const scopes = [ctx.config.scopes.cartWrite];

  server.registerTool(
    "update_cart_item",
    {
      title: "Update cart item",
      description:
        "Sets the quantity of a cart line item; quantity 0 removes the line. " +
        "Returns the updated cart.",
      inputSchema: {
        lineItemId: z.string().min(1),
        quantity: z.number().int().min(0).max(99),
      },
      outputSchema: { cart: cartSchema },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
      _meta: widgetToolMeta(CART_URI, "Updating your cart…", "Cart updated"),
    },
    async (args) =>
      runTool(ctx, "update_cart_item", args, scopes, async (identity) => {
        const cart = await ctx.shop.updateCartItem(
          identity,
          args.lineItemId,
          args.quantity
        );
        return jsonResult({ cart });
      })
  );
}
