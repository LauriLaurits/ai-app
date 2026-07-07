import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { MedusaAuthError } from "../src/medusa/client.js";
import { CartNotFoundError } from "../src/shop/cartErrors.js";
import { createWebshopMcpServer } from "../src/tools/index.js";
import type { AppConfig, AppLogger, AuthResult, ShopAdapter } from "../src/types.js";
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
  scopes: ["profile.read", "orders.read", "cart.read", "cart.write"],
  reason: null,
};

function sampleCart() {
  return {
    id: "cart_1",
    items: [
      {
        id: "line_1",
        variantId: "var_1",
        productId: "prod_1",
        title: "Vitamin D supplement",
        quantity: 2,
        unitPrice: { amount: 12.9, currency: "EUR" },
        lineTotal: { amount: 25.8, currency: "EUR" },
      },
    ],
    itemCount: 2,
    total: { amount: 25.8, currency: "EUR" },
  };
}

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
    async getOrderTracking() {
      return {
        orderId: "order_1",
        fulfillment: "partially_fulfilled",
        shipments: [
          {
            status: "shipped",
            trackingNumber: "TRK123",
            trackingUrl: "https://track.example/TRK123",
            shippedAt: "2026-04-29T00:00:00.000Z",
            deliveredAt: null,
          },
        ],
      };
    },
    async searchProducts() {
      return {
        products: [
          {
            id: "prod_1",
            title: "Vitamin D supplement",
            handle: "vitamin-d",
            thumbnail: null,
            price: { amount: 12.9, currency: "EUR" },
            inStock: true,
          },
        ],
        count: 1,
      };
    },
    async getProduct() {
      return null;
    },
    async getCart() {
      return sampleCart();
    },
    async addToCart() {
      return sampleCart();
    },
    async updateCartItem() {
      return sampleCart();
    },
  };
}

function expiredShop(): ShopAdapter {
  const fail = async (): Promise<never> => {
    throw new MedusaAuthError("Unauthorized");
  };
  return {
    getCurrentCustomer: fail,
    listOrders: fail,
    getOrderDetails: fail,
    getOrderTracking: fail,
    searchProducts: fail,
    getProduct: fail,
    getCart: fail,
    addToCart: fail,
    updateCartItem: fail,
  };
}

async function withClient<T>(
  auth: AuthResult,
  shop: ShopAdapter,
  fn: (client: Client) => Promise<T>,
  cfg: AppConfig = config
): Promise<T> {
  const server = createWebshopMcpServer({
    config: cfg,
    auth,
    shop,
    logger: silentLogger,
    requestId: "req-test",
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return await fn(client);
  } finally {
    await client.close();
    await server.close();
  }
}

async function callTool(
  auth: AuthResult,
  shop: ShopAdapter,
  name: string,
  args: Record<string, unknown> = {}
) {
  const result = await withClient(auth, shop, (client) =>
    client.callTool({ name, arguments: args })
  );

  return result as {
    isError?: boolean;
    content?: Array<{ type: string; text?: string }>;
    structuredContent?: Record<string, unknown>;
    _meta?: Record<string, unknown>;
  };
}

describe("MCP tools", () => {
  it("registers the full tool set", async () => {
    const names = await withClient(authenticated, workingShop(), async (client) => {
      const { tools } = await client.listTools();
      return tools.map((tool) => tool.name).sort();
    });

    expect(names).toEqual([
      "add_to_cart",
      "get_checkout_link",
      "get_current_customer",
      "get_order_details",
      "get_product",
      "list_orders",
      "search_products",
      "track_shipment",
      "update_cart_item",
      "view_cart",
    ]);
  });

  it("returns orders for an authenticated customer", async () => {
    const result = await callTool(authenticated, workingShop(), "list_orders");

    expect(result.isError).toBeFalsy();
    const orders = (result.structuredContent as { orders: unknown[] }).orders;
    expect(orders).toHaveLength(1);
  });

  it("returns catalog products from search_products", async () => {
    const result = await callTool(authenticated, workingShop(), "search_products", {
      query: "vitamin",
    });

    expect(result.isError).toBeFalsy();
    const products = (result.structuredContent as { products: unknown[] }).products;
    expect(products).toHaveLength(1);
  });

  it("returns shipment tracking from track_shipment", async () => {
    const result = await callTool(authenticated, workingShop(), "track_shipment", {
      orderId: "order_1",
    });

    expect(result.isError).toBeFalsy();
    const tracking = (result.structuredContent as { tracking: { shipments: unknown[] } })
      .tracking;
    expect(tracking.shipments).toHaveLength(1);
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

  it("returns an honest cart-not-found message, not the generic try-again-later error", async () => {
    const noActiveCartShop: ShopAdapter = {
      ...workingShop(),
      async updateCartItem() {
        throw new CartNotFoundError(
          "There is no active cart yet. Add an item to the cart first."
        );
      },
    };
    const result = await callTool(authenticated, noActiveCartShop, "update_cart_item", {
      lineItemId: "line_1",
      quantity: 1,
    });

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toBe(
      "There is no active cart yet. Add an item to the cart first."
    );
  });

  it("adds items to the cart and returns the updated cart", async () => {
    const result = await callTool(authenticated, workingShop(), "add_to_cart", {
      variantId: "var_1",
      quantity: 2,
    });

    expect(result.isError).toBeFalsy();
    const cart = (result.structuredContent as { cart: { itemCount: number } }).cart;
    expect(cart.itemCount).toBe(2);
  });

  it("marks cart write tools as non-read-only", async () => {
    const tools = await withClient(authenticated, workingShop(), async (client) => {
      const { tools: list } = await client.listTools();
      return list;
    });

    const addToCart = tools.find((tool) => tool.name === "add_to_cart");
    expect(addToCart?.annotations?.readOnlyHint).toBe(false);
    const viewCart = tools.find((tool) => tool.name === "view_cart");
    expect(viewCart?.annotations?.readOnlyHint).toBe(true);
  });

  it("blocks cart writes for tokens without cart.write", async () => {
    const readOnly: AuthResult = {
      ...authenticated,
      scopes: ["profile.read", "orders.read", "cart.read"],
    };
    const result = await callTool(readOnly, workingShop(), "add_to_cart", {
      variantId: "var_1",
      quantity: 1,
    });

    expect(result.isError).toBe(true);
    expect(result._meta?.["mcp/www_authenticate"]).toBeDefined();
  });

  it("reports when the checkout handoff is not configured", async () => {
    const result = await callTool(authenticated, workingShop(), "get_checkout_link");

    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { checkoutUrl: unknown }).checkoutUrl).toBeNull();
  });

  it("builds the checkout link from the configured template, substituting every {cartId} placeholder", async () => {
    const checkoutConfig = makeConfig({
      checkout: {
        urlTemplate: "https://shop.test/checkout?cart={cartId}&ref={cartId}",
      },
    });
    const result = (await withClient(
      authenticated,
      workingShop(),
      (client) => client.callTool({ name: "get_checkout_link", arguments: {} }),
      checkoutConfig
    )) as { structuredContent?: Record<string, unknown> };

    expect(result.structuredContent?.checkoutUrl).toBe(
      "https://shop.test/checkout?cart=cart_1&ref=cart_1"
    );
  });

  it("serves both widget resources", async () => {
    const uris = await withClient(authenticated, workingShop(), async (client) => {
      const { resources } = await client.listResources();
      return resources.map((resource) => resource.uri).sort();
    });

    expect(uris).toEqual(["ui://widget/cart.html", "ui://widget/product-grid.html"]);
  });

  it("attaches widget templates to catalog and cart tools", async () => {
    const tools = await withClient(authenticated, workingShop(), async (client) => {
      const { tools: list } = await client.listTools();
      return list;
    });

    const templateOf = (name: string) =>
      (tools.find((tool) => tool.name === name)?._meta ?? {})["openai/outputTemplate"];

    expect(templateOf("search_products")).toBe("ui://widget/product-grid.html");
    expect(templateOf("get_product")).toBe("ui://widget/product-grid.html");
    expect(templateOf("view_cart")).toBe("ui://widget/cart.html");
    expect(templateOf("add_to_cart")).toBe("ui://widget/cart.html");
    expect(templateOf("update_cart_item")).toBe("ui://widget/cart.html");
    expect(templateOf("list_orders")).toBeUndefined();
  });
});
