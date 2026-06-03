import crypto from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { authenticateRequest } from "./auth/tokenVerifier.js";
import { buildWwwAuthenticate } from "./auth/challenge.js";
import { config } from "./config.js";
import { createAppLogger, hashUserId } from "./logging/logger.js";
import { createShopAdapter } from "./shop/createShopAdapter.js";
import { createWebshopMcpServer } from "./tools.js";

const logger = createAppLogger(config);
const shop = createShopAdapter(config);
const mcpMethods = new Set(["POST", "GET", "DELETE"]);

function requestIdFrom(req) {
  const value = req.headers["x-request-id"];
  if (Array.isArray(value)) return value[0] ?? crypto.randomUUID();
  return value ?? crypto.randomUUID();
}

function writeJson(res, statusCode, body, extraHeaders = {}) {
  res.writeHead(statusCode, {
    "content-type": "application/json",
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

function writeMcpCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "authorization, content-type, mcp-session-id, x-request-id"
  );
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, X-Request-Id");
}

function requestPath(req) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  return url.pathname;
}

export function isMcpPath(pathname) {
  return (
    pathname === config.mcpPath || pathname.startsWith(`${config.mcpPath}/`)
  );
}

export function protectedResourceMetadata() {
  return {
    resource: config.publicBaseUrl,
    authorization_servers: [config.auth.issuer],
    scopes_supported: [config.scopes.profileRead, config.scopes.ordersRead],
    resource_documentation: `${config.publicBaseUrl}/docs`,
  };
}

export function handleHealthRequest(req, res) {
  if (req.method !== "GET") {
    res.writeHead(405).end("Method Not Allowed");
    return;
  }

  res
    .writeHead(200, { "content-type": "text/plain" })
    .end("Webshop ChatGPT MCP server");
}

export function handleProtectedResourceMetadataRequest(req, res) {
  if (req.method !== "GET") {
    res.writeHead(405).end("Method Not Allowed");
    return;
  }

  writeJson(res, 200, protectedResourceMetadata());
}

export async function handleMcpRequest(req, res) {
  const requestId = requestIdFrom(req);
  const startedAt = Date.now();
  const pathname = requestPath(req);
  res.setHeader("X-Request-Id", requestId);

  if (req.method === "OPTIONS") {
    writeMcpCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (!req.method || !mcpMethods.has(req.method)) {
    res.writeHead(405).end("Method Not Allowed");
    return;
  }

  writeMcpCors(res);

  const auth = await authenticateRequest(req, config);
  const userIdHash = hashUserId(auth.identity?.userId);
  const mcpServer = createWebshopMcpServer({
    config,
    auth,
    shop,
    logger,
    requestId,
  });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => {
    transport.close();
    mcpServer.close();
  });

  try {
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);

    logger.info("mcp_http_request", {
      requestId,
      method: req.method,
      path: pathname,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      authStatus: auth.status,
      userIdHash,
    });
  } catch (error) {
    logger.error("mcp_http_request_failed", {
      requestId,
      method: req.method,
      path: pathname,
      durationMs: Date.now() - startedAt,
      authStatus: auth.status,
      userIdHash,
      errorCode: "mcp_http_error",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });

    if (!res.headersSent) {
      const challenge = buildWwwAuthenticate(
        config,
        [config.scopes.profileRead, config.scopes.ordersRead],
        {
          error: "server_error",
          errorDescription: "MCP request failed",
        }
      );
      res
        .writeHead(500, {
          "WWW-Authenticate": challenge,
          "content-type": "text/plain",
        })
        .end("Internal server error");
    }
  }
}
