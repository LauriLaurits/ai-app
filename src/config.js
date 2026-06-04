const port = Number(process.env.PORT ?? 8787);

function normalizeBaseUrl(value) {
  return String(value).replace(/\/+$/, "");
}

export const config = Object.freeze({
  port,
  mcpPath: process.env.MCP_PATH ?? "/mcp",
  publicBaseUrl: normalizeBaseUrl(
    process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`
  ),
  auth: {
    mode: process.env.AUTH_MODE ?? "mock",
    mockBearerToken: process.env.MOCK_BEARER_TOKEN ?? "dev-token",
    issuer: process.env.OAUTH_ISSUER ?? "https://auth.yourcompany.example",
    audience:
      process.env.OAUTH_AUDIENCE ??
      normalizeBaseUrl(process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`),
    jwksUrl: process.env.OAUTH_JWKS_URL ?? "",
  },
  scopes: {
    profileRead: "profile.read",
    ordersRead: "orders.read",
  },
  shop: {
    adapter: process.env.SHOP_ADAPTER ?? "mock",
  },
  openObserve: {
    ingestUrl: process.env.OPENOBSERVE_INGEST_URL ?? "",
    authHeader: process.env.OPENOBSERVE_AUTH_HEADER ?? "",
  },
  telemetry: {
    serviceName: process.env.SERVICE_NAME ?? "webshop-chatgpt-mcp",
    serviceEnv:
      process.env.SERVICE_ENV ??
      process.env.VERCEL_ENV ??
      process.env.NODE_ENV ??
      "local",
    gitSha:
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.GIT_SHA ??
      "unknown",
    deploymentUrl: process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : normalizeBaseUrl(process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`),
    vercelEnv: process.env.VERCEL_ENV ?? null,
    vercelRegion: process.env.VERCEL_REGION ?? null,
    hashSalt: process.env.LOG_HASH_SALT ?? "",
  },
});
