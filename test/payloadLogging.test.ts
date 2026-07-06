import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createWebshopMcpServer } from "../src/tools/index.js";
import type { AppConfig, AppLogger, AuthResult, ShopAdapter } from "../src/types.js";
import { makeConfig } from "./helpers.js";

interface RecordedEvent {
  level: "info" | "warn" | "error";
  event: string;
  payload: Record<string, unknown>;
}

function recordingLogger(): { events: RecordedEvent[]; logger: AppLogger } {
  const events: RecordedEvent[] = [];
  const rec =
    (level: RecordedEvent["level"]) =>
    (event: string, payload: Record<string, unknown> = {}) => {
      events.push({ level, event, payload });
    };
  return { events, logger: { info: rec("info"), warn: rec("warn"), error: rec("error") } };
}

const authenticated: AuthResult = {
  status: "authenticated",
  identity: { userId: "cus_1", displayName: "Lauri", shopIds: ["medusa"] },
  scopes: ["profile.read", "orders.read"],
  reason: null,
};

function workingShop(): ShopAdapter {
  return {
    async getCurrentCustomer() {
      return {
        id: "cus_1",
        displayName: "Lauri",
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
    async getOrderTracking() {
      return null;
    },
    async searchProducts() {
      return { products: [], count: 0 };
    },
    async getProduct() {
      return null;
    },
    async getCart() {
      return null;
    },
    async addToCart() {
      throw new Error("cart not used in payload logging tests");
    },
    async updateCartItem() {
      throw new Error("cart not used in payload logging tests");
    },
  };
}

function brokenShop(): ShopAdapter {
  return {
    ...workingShop(),
    async listOrders() {
      throw new Error("database exploded");
    },
  };
}

async function callTool(
  config: AppConfig,
  logger: AppLogger,
  shop: ShopAdapter,
  name: string,
  args: Record<string, unknown>
) {
  const server = createWebshopMcpServer({
    config,
    auth: authenticated,
    shop,
    logger,
    requestId: "req-test",
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  await client.callTool({ name, arguments: args });
  await client.close();
  await server.close();
}

describe("payload logging", () => {
  it("mode=all logs argument values and the returned result on success", async () => {
    const { events, logger } = recordingLogger();
    const config = makeConfig({ logging: { payloadMode: "all" } });

    await callTool(config, logger, workingShop(), "list_orders", { limit: 5 });

    const finished = events.find((e) => e.event === "mcp_tool_finished");
    expect(finished?.payload.arguments).toEqual({ limit: 5 });
    expect(JSON.stringify(finished?.payload.result)).toContain("order_1");
  });

  it("mode=error logs arguments when a tool fails", async () => {
    const { events, logger } = recordingLogger();
    const config = makeConfig({ logging: { payloadMode: "error" } });

    await callTool(config, logger, brokenShop(), "list_orders", { limit: 9 });

    const failed = events.find((e) => e.event === "mcp_tool_failed");
    expect(failed?.payload.arguments).toEqual({ limit: 9 });
  });

  it("mode=error does NOT log payloads on success", async () => {
    const { events, logger } = recordingLogger();
    const config = makeConfig({ logging: { payloadMode: "error" } });

    await callTool(config, logger, workingShop(), "list_orders", { limit: 5 });

    const finished = events.find((e) => e.event === "mcp_tool_finished");
    expect(finished?.payload.arguments).toBeUndefined();
    expect(finished?.payload.result).toBeUndefined();
  });

  it("mode=off never logs payloads, even on failure", async () => {
    const { events, logger } = recordingLogger();
    const config = makeConfig({ logging: { payloadMode: "off" } });

    await callTool(config, logger, brokenShop(), "list_orders", { limit: 9 });

    const failed = events.find((e) => e.event === "mcp_tool_failed");
    expect(failed?.payload.arguments).toBeUndefined();
  });
});
