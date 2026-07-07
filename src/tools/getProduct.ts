import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PRODUCT_GRID_URI, widgetToolMeta } from "../widgets/index.js";
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
      _meta: widgetToolMeta(PRODUCT_GRID_URI, "Loading product…", "Product loaded"),
    },
    async (args) =>
      runTool(ctx, "get_product", args, scopes, async () => {
        const product = await ctx.shop.getProduct(args.productId);
        return jsonResult({ product });
      })
  );
}
