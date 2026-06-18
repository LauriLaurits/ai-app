import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { MedusaAuthError } from "../src/medusa/client.js";
import { createWebshopMcpServer } from "../src/tools.js";
import type { AppLogger, AuthResult, ShopAdapter } from "../src/types.js";
import { makeConfig } from "./helpers.js";

const config = makeConfig();

const silentLogger: AppLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

const authenticated: AuthResult = {
  status: "authenticated",
  identity: {
    userId: "cus_1",
    displayName: "Lauri Laurits",
    shopIds: ["medusa"],
    medusaToken: "medusa-jwt-1",
  },
  scopes: ["profile.read", "orders.read"],
  reason: null,
};

function workingShop(): ShopAdapter {
  return {
    async getCurrentCustomer() {
      return {
        id: "cus_1",
        displayName: "Lauri Laurits",
        emailMasked: "la***@example.com",
        loyaltyTier: null,
        defaultShop: "medusa",
      };
    },
    async listOrders() {
      return [
        {
          id: "order_1",
          orderedAt: "2026-04-28T00:00:00.000Z",
          status: "pending",
          fulfillment: "partially_fulfilled",
          total: { amount: 297.31, currency: "EUR" },
          itemCount: 5,
        },
      ];
    },
    async getOrderDetails() {
      return null;
    },
  };
}

function expiredShop(): ShopAdapter {
  const fail = async (): Promise<never> => {
    throw new MedusaAuthError("Unauthorized");
  };
  return { getCurrentCustomer: fail, listOrders: fail, getOrderDetails: fail };
}

async function callTool(auth: AuthResult, shop: ShopAdapter, name: string) {
  const server = createWebshopMcpServer({
    config,
    auth,
    shop,
    logger: silentLogger,
    requestId: "req-test",
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const result = await client.callTool({ name, arguments: {} });

  await client.close();
  await server.close();

  return result as {
    isError?: boolean;
    content?: Array<{ type: string; text?: string }>;
    structuredContent?: Record<string, unknown>;
    _meta?: Record<string, unknown>;
  };
}

describe("MCP tools", () => {
  it("returns orders for an authenticated customer", async () => {
    const result = await callTool(authenticated, workingShop(), "list_orders");

    expect(result.isError).toBeFalsy();
    const orders = (result.structuredContent as { orders: unknown[] }).orders;
    expect(orders).toHaveLength(1);
  });

  it("returns an auth challenge when no identity is present", async () => {
    const missing: AuthResult = {
      status: "missing",
      identity: null,
      scopes: [],
      reason: "No bearer token was provided",
    };
    const result = await callTool(missing, workingShop(), "list_orders");

    expect(result.isError).toBe(true);
    expect(result._meta?.["mcp/www_authenticate"]).toBeDefined();
  });

  it("returns an auth challenge when required scopes are missing", async () => {
    const limited: AuthResult = { ...authenticated, scopes: ["profile.read"] };
    const result = await callTool(limited, workingShop(), "list_orders");

    expect(result.isError).toBe(true);
    expect(result._meta?.["mcp/www_authenticate"]).toBeDefined();
  });

  it("surfaces an auth challenge instead of a generic error when the Medusa session expired", async () => {
    const result = await callTool(authenticated, expiredShop(), "list_orders");

    expect(result.isError).toBe(true);
    expect(result._meta?.["mcp/www_authenticate"]).toBeDefined();
    expect(result.content?.[0]?.text).not.toContain("Please try again later");
  });

  it("still maps unexpected failures to the generic error", async () => {
    const broken: ShopAdapter = {
      ...workingShop(),
      async listOrders() {
        throw new Error("database exploded");
      },
    };
    const result = await callTool(authenticated, broken, "list_orders");

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("Please try again later");
    expect(result.content?.[0]?.text).not.toContain("database exploded");
  });
});
