import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { authenticateRequest } from "./auth/tokenVerifier.js";
import { buildWwwAuthenticate } from "./auth/challenge.js";
import { config } from "./config.js";
import { createAppLogger, hashUserId } from "./logging/logger.js";
import { supportedScopes } from "./oauth/validation.js";
import { createShopAdapter } from "./shop/createShopAdapter.js";
import { createWebshopMcpServer } from "./tools/index.js";

const shop = createShopAdapter(config);
const mcpMethods = new Set(["POST", "GET", "DELETE"]);

function requestIdFrom(req: IncomingMessage): string {
  const value = req.headers["x-request-id"];
  if (Array.isArray(value)) return value[0] ?? crypto.randomUUID();
  return value ?? crypto.randomUUID();
}

function writeJson(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
  extraHeaders: Record<string, string> = {}
): void {
  res.writeHead(statusCode, {
    "content-type": "application/json",
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

function writeMcpCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "authorization, content-type, mcp-session-id, x-request-id"
  );
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, X-Request-Id");
}

function requestPath(req: IncomingMessage): string {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  return url.pathname;
}

export function isMcpPath(pathname: string): boolean {
  return pathname === config.mcpPath || pathname.startsWith(`${config.mcpPath}/`);
}

export function protectedResourceMetadata(): Record<string, unknown> {
  return {
    resource: config.publicBaseUrl,
    authorization_servers: [config.auth.issuer],
    scopes_supported: supportedScopes(config),
    resource_documentation: `${config.publicBaseUrl}/docs`,
  };
}

export function handleHealthRequest(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== "GET") {
    res.writeHead(405).end("Method Not Allowed");
    return;
  }

  res
    .writeHead(200, { "content-type": "text/plain" })
    .end("Webshop ChatGPT MCP server");
}

export function handleProtectedResourceMetadataRequest(
  req: IncomingMessage,
  res: ServerResponse
): void {
  if (req.method !== "GET") {
    res.writeHead(405).end("Method Not Allowed");
    return;
  }

  writeJson(res, 200, protectedResourceMetadata());
}

function requestHost(req: IncomingMessage): string | null {
  const forwardedHost = req.headers["x-forwarded-host"];
  if (Array.isArray(forwardedHost)) return forwardedHost[0] ?? null;
  return forwardedHost ?? req.headers.host ?? null;
}

export interface McpRequestOptions {
  waitUntil?: (promise: Promise<unknown>) => void;
}

export async function handleMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: McpRequestOptions = {}
): Promise<void> {
  const requestId = requestIdFrom(req);
  const startedAt = Date.now();
  const pathname = requestPath(req);
  const logger = createAppLogger(config, { waitUntil: options.waitUntil });
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
  const requestLogBase = {
    requestId,
    method: req.method,
    path: pathname,
    host: requestHost(req),
    authStatus: auth.status,
    userIdHash,
    shopAdapter: config.shop.adapter,
  };

  // A 401 with WWW-Authenticate is what tells the client (ChatGPT) to run
  // OAuth discovery, silently refresh its token, or prompt the user to
  // reconnect. Tool-level errors do not trigger any of that.
  if (auth.status !== "authenticated") {
    const challenge = buildWwwAuthenticate(
      config,
      supportedScopes(config),
      {
        ...(auth.status === "invalid" ? { error: "invalid_token" } : {}),
        errorDescription: auth.reason ?? "Authentication required",
      }
    );
    writeJson(
      res,
      401,
      {
        error: auth.status === "invalid" ? "invalid_token" : "unauthorized",
        error_description: auth.reason ?? "Authentication required",
      },
      { "WWW-Authenticate": challenge }
    );
    logger.info("mcp_http_request", {
      ...requestLogBase,
      statusCode: 401,
      durationMs: Date.now() - startedAt,
    });
    return;
  }

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
      ...requestLogBase,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    logger.error("mcp_http_request_failed", {
      ...requestLogBase,
      durationMs: Date.now() - startedAt,
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
