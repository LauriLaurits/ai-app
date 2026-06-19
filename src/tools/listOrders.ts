import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { orderSummarySchema } from "./schemas.js";
import { jsonResult, runTool, type ToolContext } from "./shared.js";

export function registerListOrders(server: McpServer, ctx: ToolContext): void {
  const scopes = [ctx.config.scopes.ordersRead];

  server.registerTool(
    "list_orders",
    {
      title: "List orders",
      description:
        "Lists recent webshop orders for the authenticated customer. Returns summaries only.",
      inputSchema: {
        status: z.string().optional(),
        limit: z.number().int().min(1).max(25).optional(),
      },
      outputSchema: { orders: z.array(orderSummarySchema) },
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      runTool(ctx, "list_orders", args, scopes, async (identity) => {
        const orders = await ctx.shop.listOrders(identity, args);
        return jsonResult({ orders });
      })
  );
}
