import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PRODUCT_GRID_URI, widgetToolMeta } from "../widgets/index.js";
import { productSummarySchema } from "./schemas.js";
import { jsonResult, runTool, type ToolContext } from "./shared.js";

export function registerSearchProducts(server: McpServer, ctx: ToolContext): void {
  // Catalog browsing only needs a connected account, not order access.
  const scopes = [ctx.config.scopes.profileRead];

  server.registerTool(
    "search_products",
    {
      title: "Search or list products",
      description:
        "Searches the webshop catalog, or lists all products when 'query' is omitted. " +
        "Returns product summaries with price and stock, plus the total 'count'. " +
        "Use 'limit' and 'offset' to page through the full catalog.",
      inputSchema: {
        query: z.string().optional(),
        limit: z.number().int().min(1).max(25).optional(),
        offset: z.number().int().min(0).optional(),
      },
      outputSchema: {
        products: z.array(productSummarySchema),
        count: z.number(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: widgetToolMeta(PRODUCT_GRID_URI, "Searching the catalog…", "Products found"),
    },
    async (args) =>
      runTool(ctx, "search_products", args, scopes, async () => {
        const { products, count } = await ctx.shop.searchProducts(args);
        return jsonResult({ products, count });
      })
  );
}
