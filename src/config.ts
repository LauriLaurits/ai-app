import type { AppConfig } from "./types.js";

const port = Number(process.env.PORT ?? 8787);
const authMode = process.env.AUTH_MODE ?? "mock";
const publicBaseUrl = normalizeBaseUrl(
  process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`
);

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizePayloadMode(value: string | undefined): "off" | "error" | "all" {
  if (value === "all" || value === "error" || value === "off") {
    return value;
  }
  // Default: capture payloads only when a tool fails, to keep PII out of logs
  // during normal operation.
  return "error";
}

export const config: AppConfig = Object.freeze({
  port,
  mcpPath: process.env.MCP_PATH ?? "/mcp",
  publicBaseUrl,
  auth: {
    mode: authMode,
    mockBearerToken: process.env.MOCK_BEARER_TOKEN ?? "dev-token",
    issuer:
      process.env.OAUTH_ISSUER ??
      (authMode === "broker" ? publicBaseUrl : "https://auth.yourcompany.example"),
    audience: process.env.OAUTH_AUDIENCE ?? publicBaseUrl,
    jwksUrl: process.env.OAUTH_JWKS_URL ?? "",
  },
  scopes: {
    profileRead: "profile.read",
    ordersRead: "orders.read",
    cartRead: "cart.read",
    cartWrite: "cart.write",
  },
  logging: {
    payloadMode: normalizePayloadMode(process.env.LOG_PAYLOAD_MODE),
  },
  shop: {
    adapter: process.env.SHOP_ADAPTER ?? "mock",
  },
  checkout: {
    // Storefront handoff for get_checkout_link; {cartId} is replaced with the
    // active cart id. Empty disables the handoff link.
    urlTemplate: process.env.CHECKOUT_URL_TEMPLATE ?? "",
  },
  widgets: {
    // Hosts product thumbnails may load from inside ChatGPT widgets (CSP
    // allowlist). Comma-separated origins; empty disables remote images.
    imageDomains: (process.env.WIDGET_IMAGE_DOMAINS ?? "")
      .split(",")
      .map((domain) => domain.trim())
      .filter(Boolean),
  },
  medusa: {
    baseUrl: normalizeBaseUrl(process.env.MEDUSA_BASE_URL ?? ""),
    publishableKey: process.env.MEDUSA_PUBLISHABLE_KEY ?? "",
    customerEmail: process.env.MEDUSA_CUSTOMER_EMAIL ?? "",
    customerPassword: process.env.MEDUSA_CUSTOMER_PASSWORD ?? "",
    tokenCacheMs: Number(process.env.MEDUSA_TOKEN_CACHE_MS ?? 20 * 60 * 1000),
    regionId: process.env.MEDUSA_REGION_ID ?? "",
  },
  broker: {
    clientId: process.env.OAUTH_BROKER_CLIENT_ID ?? "chatgpt",
    redirectUris: (
      process.env.OAUTH_BROKER_REDIRECT_URIS ??
      "https://chatgpt.com/connector_platform_oauth_redirect"
    )
      .split(",")
      .map((uri) => uri.trim())
      .filter(Boolean),
    codeTtlSec: Number(process.env.OAUTH_BROKER_CODE_TTL_SEC ?? 10 * 60),
    accessTokenTtlSec: Number(process.env.OAUTH_BROKER_ACCESS_TOKEN_TTL_SEC ?? 60 * 60),
    refreshTokenTtlSec: Number(
      process.env.OAUTH_BROKER_REFRESH_TOKEN_TTL_SEC ?? 30 * 24 * 60 * 60
    ),
    storageNamespace: process.env.OAUTH_BROKER_STORAGE_NAMESPACE ?? "ai-app",
  },
  rateLimit: {
    loginPerIp: Number(process.env.OAUTH_BROKER_LOGIN_RATE_LIMIT_IP ?? 20),
    loginPerEmail: Number(process.env.OAUTH_BROKER_LOGIN_RATE_LIMIT_EMAIL ?? 10),
    windowSec: Number(process.env.OAUTH_BROKER_LOGIN_RATE_LIMIT_WINDOW_SEC ?? 15 * 60),
  },
  storage: {
    upstashUrl: process.env.UPSTASH_REDIS_REST_URL ?? "",
    upstashToken: process.env.UPSTASH_REDIS_REST_TOKEN ?? "",
  },
  openObserve: {
    ingestUrl: process.env.OPENOBSERVE_INGEST_URL ?? "",
    authHeader: process.env.OPENOBSERVE_AUTH_HEADER ?? "",
  },
  telemetry: {
    serviceName: process.env.SERVICE_NAME ?? "webshop-chatgpt-mcp",
    serviceEnv:
      process.env.SERVICE_ENV ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "local",
    gitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_SHA ?? "unknown",
    deploymentUrl: process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : publicBaseUrl,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    vercelRegion: process.env.VERCEL_REGION ?? null,
    hashSalt: process.env.LOG_HASH_SALT ?? "",
  },
});
