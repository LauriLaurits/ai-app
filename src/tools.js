import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { requireScopes } from "./auth/challenge.js";
import { hashUserId } from "./logging/logger.js";

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

function jsonResult(structuredContent) {
  return {
    structuredContent,
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
  };
}

function toolSecurity(scopes) {
  return [{ type: "oauth2", scopes }];
}

function toolLogger({ logger, requestId, auth }, toolName, args, scopes, run) {
  return async () => {
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
        errorCode: "tool_error",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      });

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
  };
}

export function createWebshopMcpServer({
  config,
  auth,
  shop,
  logger,
  requestId,
}) {
  const server = new McpServer({
    name: "webshop-orders",
    version: "0.1.0",
  });

  server.registerTool(
    "get_current_customer",
    {
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
    },
    async (args) =>
      toolLogger(
        { logger, requestId, auth },
        "get_current_customer",
        args,
        [config.scopes.profileRead],
        async () => {
          const allowed = requireScopes(config, auth, [config.scopes.profileRead]);
          if (!allowed.ok) return allowed.result;

          const customer = await shop.getCurrentCustomer(allowed.identity);
          return jsonResult({ customer });
        }
      )()
  );

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
      outputSchema: {
        orders: z.array(orderSummarySchema),
      },
      annotations: { readOnlyHint: true },
      securitySchemes: toolSecurity([config.scopes.ordersRead]),
    },
    async (args) =>
      toolLogger(
        { logger, requestId, auth },
        "list_orders",
        args,
        [config.scopes.ordersRead],
        async () => {
          const allowed = requireScopes(config, auth, [config.scopes.ordersRead]);
          if (!allowed.ok) return allowed.result;

          const orders = await shop.listOrders(allowed.identity, args);
          return jsonResult({ orders });
        }
      )()
  );

  server.registerTool(
    "get_order_details",
    {
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
    },
    async (args) =>
      toolLogger(
        { logger, requestId, auth },
        "get_order_details",
        args,
        [config.scopes.ordersRead],
        async () => {
          const allowed = requireScopes(config, auth, [config.scopes.ordersRead]);
          if (!allowed.ok) return allowed.result;

          const order = await shop.getOrderDetails(allowed.identity, args.orderId);
          return jsonResult({ order });
        }
      )()
  );

  return server;
}
