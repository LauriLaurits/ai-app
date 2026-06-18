import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { authErrorResult, requireScopes } from "./auth/challenge.js";
import { hashUserId } from "./logging/logger.js";
import { MedusaAuthError } from "./medusa/client.js";
import type { AppConfig, AppLogger, AuthResult, ShopAdapter } from "./types.js";

const moneySchema = z.object({
  amount: z.number(),
  currency: z.string(),
});

const orderSummarySchema = z.object({
  id: z.string(),
  orderedAt: z.string(),
  status: z.string(),
  fulfillment: z.string(),
  total: moneySchema,
  itemCount: z.number(),
});

const orderDetailsSchema = z.object({
  id: z.string(),
  orderedAt: z.string(),
  status: z.string(),
  fulfillment: z.string(),
  total: moneySchema,
  itemCount: z.number(),
  items: z.array(
    z.object({
      sku: z.string().nullable().optional(),
      name: z.string(),
      quantity: z.number(),
      unitPrice: moneySchema,
    })
  ),
  delivery: z.object({
    method: z.string(),
    status: z.string(),
    trackingCode: z.string().nullable(),
  }),
});

function jsonResult(structuredContent: Record<string, unknown>): CallToolResult {
  return {
    structuredContent,
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
  };
}

function toolSecurity(scopes: string[]) {
  return [{ type: "oauth2", scopes }];
}

interface ToolContext {
  config: AppConfig;
  logger: AppLogger;
  requestId: string;
  auth: AuthResult;
}

async function runTool(
  context: ToolContext,
  toolName: string,
  args: Record<string, unknown> | undefined,
  scopes: string[],
  run: () => Promise<CallToolResult>
): Promise<CallToolResult> {
  const { logger, requestId, auth } = context;
  const startedAt = Date.now();
  const userIdHash = hashUserId(auth.identity?.userId);

  logger.info("mcp_tool_started", {
    requestId,
    toolName,
    userIdHash,
    authStatus: auth.status,
    requiredScopes: scopes,
    inputShape: Object.fromEntries(Object.keys(args ?? {}).map((key) => [key, true])),
  });

  try {
    const result = await run();
    logger.info("mcp_tool_finished", {
      requestId,
      toolName,
      userIdHash,
      isError: Boolean(result?.isError),
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    logger.error("mcp_tool_failed", {
      requestId,
      toolName,
      userIdHash,
      durationMs: Date.now() - startedAt,
      errorCode: error instanceof MedusaAuthError ? "shop_session_expired" : "tool_error",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });

    if (error instanceof MedusaAuthError) {
      return authErrorResult(
        context.config,
        scopes,
        "Webshop session expired. Please reconnect your account."
      );
    }

    return {
      content: [
        {
          type: "text",
          text: "The webshop service returned an error. Please try again later.",
        },
      ],
      structuredContent: {},
      isError: true,
    };
  }
}

export interface CreateServerOptions {
  config: AppConfig;
  auth: AuthResult;
  shop: ShopAdapter;
  logger: AppLogger;
  requestId: string;
}

export function createWebshopMcpServer({
  config,
  auth,
  shop,
  logger,
  requestId,
}: CreateServerOptions): McpServer {
  const server = new McpServer({
    name: "webshop-orders",
    version: "0.2.0",
  });

  const context: ToolContext = { config, logger, requestId, auth };

  const getCurrentCustomerConfig = {
    title: "Get current customer",
    description: "Returns the authenticated webshop customer's basic profile.",
    inputSchema: {},
    outputSchema: {
      customer: z.object({
        id: z.string(),
        displayName: z.string(),
        emailMasked: z.string().nullable(),
        loyaltyTier: z.string().nullable(),
        defaultShop: z.string(),
      }),
    },
    annotations: { readOnlyHint: true },
    securitySchemes: toolSecurity([config.scopes.profileRead]),
  };

  server.registerTool("get_current_customer", getCurrentCustomerConfig, async (args) =>
    runTool(
      context,
      "get_current_customer",
      args as Record<string, unknown>,
      [config.scopes.profileRead],
      async () => {
        const allowed = requireScopes(config, auth, [config.scopes.profileRead]);
        if (!allowed.ok) return allowed.result;

        const customer = await shop.getCurrentCustomer(allowed.identity);
        return jsonResult({ customer });
      }
    )
  );

  const listOrdersConfig = {
    title: "List orders",
    description:
      "Lists recent webshop orders for the authenticated customer. Returns summaries only.",
    inputSchema: {
      status: z.string().optional(),
      limit: z.number().int().min(1).max(25).optional(),
    },
    outputSchema: {
      orders: z.array(orderSummarySchema),
    },
    annotations: { readOnlyHint: true },
    securitySchemes: toolSecurity([config.scopes.ordersRead]),
  };

  server.registerTool("list_orders", listOrdersConfig, async (args) =>
    runTool(context, "list_orders", args, [config.scopes.ordersRead], async () => {
      const allowed = requireScopes(config, auth, [config.scopes.ordersRead]);
      if (!allowed.ok) return allowed.result;

      const orders = await shop.listOrders(allowed.identity, args);
      return jsonResult({ orders });
    })
  );

  const getOrderDetailsConfig = {
    title: "Get order details",
    description:
      "Returns line items, total, and delivery status for one authenticated customer order.",
    inputSchema: {
      orderId: z.string().min(1),
    },
    outputSchema: {
      order: orderDetailsSchema.nullable(),
    },
    annotations: { readOnlyHint: true },
    securitySchemes: toolSecurity([config.scopes.ordersRead]),
  };

  server.registerTool("get_order_details", getOrderDetailsConfig, async (args) =>
    runTool(context, "get_order_details", args, [config.scopes.ordersRead], async () => {
      const allowed = requireScopes(config, auth, [config.scopes.ordersRead]);
      if (!allowed.ok) return allowed.result;

      const order = await shop.getOrderDetails(allowed.identity, args.orderId);
      return jsonResult({ order });
    })
  );

  return server;
}
