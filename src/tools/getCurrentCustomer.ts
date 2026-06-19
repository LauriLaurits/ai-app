import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { customerSchema } from "./schemas.js";
import { jsonResult, runTool, type ToolContext } from "./shared.js";

export function registerGetCurrentCustomer(server: McpServer, ctx: ToolContext): void {
  const scopes = [ctx.config.scopes.profileRead];

  server.registerTool(
    "get_current_customer",
    {
      title: "Get current customer",
      description: "Returns the authenticated webshop customer's basic profile.",
      inputSchema: {},
      outputSchema: { customer: customerSchema },
      annotations: { readOnlyHint: true },
    },
    async (args) =>
      runTool(ctx, "get_current_customer", args, scopes, async (identity) => {
        const customer = await ctx.shop.getCurrentCustomer(identity);
        return jsonResult({ customer });
      })
  );
}
