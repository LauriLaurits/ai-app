import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { productDetailsSchema } from "./schemas.js";
import { jsonResult, runTool, type ToolContext } from "./shared.js";

export function registerGetProduct(server: McpServer, ctx: ToolContext): void {
  const scopes = [ctx.config.scopes.profileRead];

  server.registerTool(
    "get_product",
    {
      title: "Get product details",
      description:
        "Returns full details for one catalog product: description, variants, price and stock per variant.",
      inputSchema: { productId: z.string().min(1) },
      outputSchema: { product: productDetailsSchema.nullable() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) =>
      runTool(ctx, "get_product", args, scopes, async () => {
        const product = await ctx.shop.getProduct(args.productId);
        return jsonResult({ product });
      })
  );
}
