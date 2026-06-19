import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { orderTrackingSchema } from "./schemas.js";
import { jsonResult, runTool, type ToolContext } from "./shared.js";

export function registerTrackShipment(server: McpServer, ctx: ToolContext): void {
  const scopes = [ctx.config.scopes.ordersRead];

  server.registerTool(
    "track_shipment",
    {
      title: "Track shipment",
      description:
        "Returns shipment tracking (status, tracking number and link) for one authenticated customer order.",
      inputSchema: { orderId: z.string().min(1) },
      outputSchema: { tracking: orderTrackingSchema.nullable() },
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      runTool(ctx, "track_shipment", args, scopes, async (identity) => {
        const tracking = await ctx.shop.getOrderTracking(identity, args.orderId);
        return jsonResult({ tracking });
      })
  );
}
