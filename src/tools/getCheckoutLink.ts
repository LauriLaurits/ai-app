import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jsonResult, runTool, type ToolContext } from "./shared.js";

export function registerGetCheckoutLink(server: McpServer, ctx: ToolContext): void {
  const scopes = [ctx.config.scopes.cartRead];

  server.registerTool(
    "get_checkout_link",
    {
      title: "Get checkout link",
      description:
        "Returns a link to the webshop checkout for the customer's active cart. " +
        "Payment happens on the webshop, never in chat.",
      inputSchema: {},
      outputSchema: {
        checkoutUrl: z.string().nullable(),
        message: z.string().nullable(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) =>
      runTool(ctx, "get_checkout_link", args, scopes, async (identity) => {
        const template = ctx.config.checkout.urlTemplate;
        if (!template) {
          return jsonResult({
            checkoutUrl: null,
            message: "Checkout handoff is not configured for this shop yet.",
          });
        }

        const cart = await ctx.shop.getCart(identity);
        if (!cart || cart.items.length === 0) {
          return jsonResult({
            checkoutUrl: null,
            message: "The cart is empty. Add items before checking out.",
          });
        }

        return jsonResult({
          checkoutUrl: template.replaceAll("{cartId}", encodeURIComponent(cart.id)),
          message: null,
        });
      })
  );
}
