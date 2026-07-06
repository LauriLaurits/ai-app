import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppConfig } from "../src/types.js";

export function makeConfig(overrides: DeepPartial<AppConfig> = {}): AppConfig {
  const base: AppConfig = {
    port: 8787,
    mcpPath: "/mcp",
    publicBaseUrl: "https://mcp.test",
    auth: {
      mode: "broker",
      mockBearerToken: "dev-token",
      issuer: "https://mcp.test",
      audience: "https://mcp.test",
      jwksUrl: "",
    },
    scopes: {
      profileRead: "profile.read",
      ordersRead: "orders.read",
      cartRead: "cart.read",
      cartWrite: "cart.write",
    },
    logging: { payloadMode: "off" },
    shop: { adapter: "medusa" },
    checkout: { urlTemplate: "" },
    medusa: {
      baseUrl: "https://medusa.test",
      publishableKey: "pk_test",
      customerEmail: "",
      customerPassword: "",
      tokenCacheMs: 20 * 60 * 1000,
      regionId: "reg_test",
    },
    broker: {
      clientId: "chatgpt",
      redirectUris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
      codeTtlSec: 600,
      accessTokenTtlSec: 3600,
      refreshTokenTtlSec: 30 * 24 * 60 * 60,
      storageNamespace: "test",
    },
    rateLimit: { loginPerIp: 1000, loginPerEmail: 1000, windowSec: 900 },
    storage: { upstashUrl: "", upstashToken: "" },
    openObserve: { ingestUrl: "", authHeader: "" },
    telemetry: {
      serviceName: "test",
      serviceEnv: "test",
      gitSha: "test",
      deploymentUrl: "https://mcp.test",
      vercelEnv: null,
      vercelRegion: null,
      hashSalt: "",
    },
  };

  return deepMerge(base, overrides);
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

function deepMerge<T>(base: T, overrides: DeepPartial<T>): T {
  const result = { ...base };
  for (const [key, value] of Object.entries(overrides as Record<string, unknown>)) {
    const baseValue = (base as Record<string, unknown>)[key];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      baseValue &&
      typeof baseValue === "object" &&
      !Array.isArray(baseValue)
    ) {
      (result as Record<string, unknown>)[key] = deepMerge(baseValue, value);
    } else if (value !== undefined) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}

export interface MockRequestOptions {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string;
}

export function makeReq(options: MockRequestOptions = {}): IncomingMessage {
  const req = Readable.from(
    options.body ? [Buffer.from(options.body)] : []
  ) as unknown as IncomingMessage;
  req.method = options.method ?? "GET";
  req.url = options.url ?? "/";
  req.headers = { host: "mcp.test", ...options.headers };
  return req;
}

export interface MockResponse {
  statusCode: number;
  headers: Record<string, unknown>;
  body: string;
  json(): unknown;
}

export function makeRes(): { res: ServerResponse; out: MockResponse } {
  const out: MockResponse = {
    statusCode: 0,
    headers: {},
    body: "",
    json() {
      return JSON.parse(this.body);
    },
  };

  const res: Record<string, unknown> = {
    headersSent: false,
    statusCode: 0,
    setHeader(name: string, value: unknown) {
      out.headers[name.toLowerCase()] = value;
      return this;
    },
    getHeader(name: string) {
      return out.headers[name.toLowerCase()];
    },
    writeHead(statusCode: number, headers?: Record<string, unknown>) {
      out.statusCode = statusCode;
      res.statusCode = statusCode;
      res.headersSent = true;
      if (headers) {
        for (const [name, value] of Object.entries(headers)) {
          out.headers[name.toLowerCase()] = value;
        }
      }
      return this;
    },
    write(chunk: unknown) {
      out.body += String(chunk);
      return true;
    },
    end(chunk?: unknown) {
      if (chunk) out.body += String(chunk);
      return this;
    },
    on() {
      return this;
    },
    once() {
      return this;
    },
    emit() {
      return false;
    },
    removeListener() {
      return this;
    },
    flushHeaders() {},
  };

  return { res: res as unknown as ServerResponse, out };
}

export interface MedusaFetchState {
  validLogins: Map<string, string>;
  liveTokens: Set<string>;
  refreshCount: number;
  customer: Record<string, unknown>;
  orders: Array<Record<string, unknown>>;
  products: Array<Record<string, unknown>>;
  carts: Array<Record<string, unknown>>;
  cartSequence: number;
}

export function makeMedusaFetchState(): MedusaFetchState {
  return {
    validLogins: new Map([["lauri@example.com:secret", "medusa-jwt-1"]]),
    liveTokens: new Set(["medusa-jwt-1"]),
    refreshCount: 0,
    customer: {
      id: "cus_1",
      first_name: "Lauri",
      last_name: "Laurits",
      email: "lauri@example.com",
    },
    // Amounts are in Medusa minor units (cents): 29731 = €297.31.
    orders: [
      {
        id: "order_1",
        display_id: 1,
        created_at: "2026-04-28T00:00:00.000Z",
        status: "pending",
        fulfillment_status: "partially_fulfilled",
        currency_code: "eur",
        total: 29731,
        items: [
          {
            title: "Item",
            quantity: 5,
            unit_price: 5946,
            variant_id: "var_1",
            product_id: "prod_1",
          },
        ],
        fulfillments: [
          {
            labels: [
              { tracking_number: "TRK123", tracking_url: "https://track.example/TRK123" },
            ],
            shipped_at: "2026-04-29T00:00:00.000Z",
            delivered_at: null,
          },
        ],
      },
    ],
    products: [
      {
        id: "prod_1",
        title: "Vitamin D supplement",
        handle: "vitamin-d",
        thumbnail: null,
        description: "Daily vitamin D3.",
        variants: [
          {
            id: "var_1",
            title: "60 tablets",
            sku: "vd-60",
            manage_inventory: true,
            inventory_quantity: 5,
            calculated_price: { calculated_amount: 1290, currency_code: "eur" },
          },
        ],
      },
    ],
    carts: [],
    cartSequence: 0,
  };
}

export function makeMedusaFetch(state: MedusaFetchState): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const bearer = (headers.authorization ?? headers.Authorization ?? "").replace(
      /^Bearer\s+/i,
      ""
    );

    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });

    if (method === "POST" && url.pathname === "/auth/customer/emailpass") {
      const { email, password } = JSON.parse(String(init?.body ?? "{}"));
      const token = state.validLogins.get(`${email}:${password}`);
      if (!token) return json(401, { message: "Invalid email or password" });
      return json(200, { token });
    }

    if (method === "POST" && url.pathname === "/auth/token/refresh") {
      if (!state.liveTokens.has(bearer)) {
        return json(401, { message: "Invalid token" });
      }
      state.refreshCount += 1;
      const next = `medusa-jwt-refreshed-${state.refreshCount}`;
      state.liveTokens.add(next);
      return json(200, { token: next });
    }

    // Catalog routes are public (publishable key, no customer token).
    if (url.pathname === "/store/products") {
      return json(200, { products: state.products });
    }

    if (url.pathname.startsWith("/store/products/")) {
      const id = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      const product = state.products.find((entry) => String(entry.id) === id) ?? null;
      return json(200, { product });
    }

    if (!state.liveTokens.has(bearer)) {
      return json(401, { message: "Unauthorized" });
    }

    if (url.pathname === "/store/customers/me") {
      return json(200, { customer: state.customer });
    }

    if (url.pathname === "/store/orders") {
      return json(200, { orders: state.orders });
    }

    if (url.pathname.startsWith("/store/orders/")) {
      const id = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      const order = state.orders.find((entry) => String(entry.id) === id) ?? null;
      return json(200, { order });
    }

    const recalcCart = (cart: Record<string, unknown>): void => {
      const items = cart.items as Array<Record<string, unknown>>;
      cart.total = items.reduce((sum, line) => sum + Number(line.total ?? 0), 0);
    };
    const findCart = (id: string | undefined) =>
      state.carts.find((entry) => entry.id === decodeURIComponent(id ?? "")) ?? null;

    if (method === "POST" && url.pathname === "/store/carts") {
      state.cartSequence += 1;
      const cart = {
        id: `cart_${state.cartSequence}`,
        currency_code: "eur",
        total: 0,
        items: [] as Array<Record<string, unknown>>,
      };
      state.carts.push(cart);
      return json(200, { cart });
    }

    const linesMatch = url.pathname.match(/^\/store\/carts\/([^/]+)\/line-items$/);
    if (method === "POST" && linesMatch) {
      const cart = findCart(linesMatch[1]);
      if (!cart) return json(404, { message: "Cart not found" });
      const { variant_id, quantity } = JSON.parse(String(init?.body ?? "{}"));
      const items = cart.items as Array<Record<string, unknown>>;
      items.push({
        id: `line_${items.length + 1}`,
        variant_id,
        product_id: "prod_1",
        product_title: "Vitamin D supplement",
        quantity,
        unit_price: 1290,
        total: 1290 * Number(quantity),
      });
      recalcCart(cart);
      return json(200, { cart });
    }

    const lineMatch = url.pathname.match(/^\/store\/carts\/([^/]+)\/line-items\/([^/]+)$/);
    if (lineMatch) {
      const cart = findCart(lineMatch[1]);
      if (!cart) return json(404, { message: "Cart not found" });
      const items = cart.items as Array<Record<string, unknown>>;
      const line = items.find((entry) => entry.id === decodeURIComponent(lineMatch[2] ?? ""));
      if (!line) return json(404, { message: "Line item not found" });

      if (method === "POST") {
        const { quantity } = JSON.parse(String(init?.body ?? "{}"));
        line.quantity = quantity;
        line.total = Number(line.unit_price) * Number(quantity);
        recalcCart(cart);
        return json(200, { cart });
      }
      if (method === "DELETE") {
        cart.items = items.filter((entry) => entry !== line);
        recalcCart(cart);
        return json(200, { deleted: true });
      }
    }

    const cartMatch = url.pathname.match(/^\/store\/carts\/([^/]+)$/);
    if (method === "GET" && cartMatch) {
      const cart = findCart(cartMatch[1]);
      if (!cart) return json(404, { message: "Cart not found" });
      return json(200, { cart });
    }

    return json(404, { message: `Unhandled test route: ${method} ${url.pathname}` });
  }) as typeof fetch;
}
