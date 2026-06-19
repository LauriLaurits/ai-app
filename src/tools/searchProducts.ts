import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { productSummarySchema } from "./schemas.js";
import { jsonResult, runTool, type ToolContext } from "./shared.js";

export function registerSearchProducts(server: McpServer, ctx: ToolContext): void {
  // Catalog browsing only needs a connected account, not order access.
  const scopes = [ctx.config.scopes.profileRead];

  server.registerTool(
    "search_products",
    {
      title: "Search products",
      description:
        "Searches the webshop catalog. Returns product summaries with price and stock status.",
      inputSchema: {
        query: z.string().optional(),
        limit: z.number().int().min(1).max(25).optional(),
      },
      outputSchema: { products: z.array(productSummarySchema) },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) =>
      runTool(ctx, "search_products", args, scopes, async () => {
        const products = await ctx.shop.searchProducts(args);
        return jsonResult({ products });
      })
  );
}
