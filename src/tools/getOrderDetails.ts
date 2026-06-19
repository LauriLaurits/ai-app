import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { orderDetailsSchema } from "./schemas.js";
import { jsonResult, runTool, type ToolContext } from "./shared.js";

export function registerGetOrderDetails(server: McpServer, ctx: ToolContext): void {
  const scopes = [ctx.config.scopes.ordersRead];

  server.registerTool(
    "get_order_details",
    {
      title: "Get order details",
      description:
        "Returns line items, total, and delivery status for one authenticated customer order.",
      inputSchema: { orderId: z.string().min(1) },
      outputSchema: { order: orderDetailsSchema.nullable() },
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      runTool(ctx, "get_order_details", args, scopes, async (identity) => {
        const order = await ctx.shop.getOrderDetails(identity, args.orderId);
        return jsonResult({ order });
      })
  );
}
