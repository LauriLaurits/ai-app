import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CART_URI, widgetToolMeta } from "../widgets/index.js";
import { cartSchema } from "./schemas.js";
import { jsonResult, runTool, type ToolContext } from "./shared.js";

export function registerAddToCart(server: McpServer, ctx: ToolContext): void {
  const scopes = [ctx.config.scopes.cartWrite];

  server.registerTool(
    "add_to_cart",
    {
      title: "Add to cart",
      description:
        "Adds a product variant to the customer's shopping cart and returns the " +
        "updated cart with prices. Creates the cart on first use. Never takes payment.",
      inputSchema: {
        variantId: z.string().min(1),
        quantity: z.number().int().min(1).max(99),
      },
      outputSchema: { cart: cartSchema },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
      _meta: widgetToolMeta(CART_URI, "Adding to your cart…", "Added to cart"),
    },
    async (args) =>
      runTool(ctx, "add_to_cart", args, scopes, async (identity) => {
        const cart = await ctx.shop.addToCart(identity, {
          variantId: args.variantId,
          quantity: args.quantity,
        });
        return jsonResult({ cart });
      })
  );
}
