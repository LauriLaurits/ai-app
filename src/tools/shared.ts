import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { authErrorResult, requireScopes } from "../auth/challenge.js";
import { hashUserId } from "../logging/logger.js";
import { MedusaAuthError } from "../medusa/client.js";
import { CartNotFoundError } from "../shop/cartErrors.js";
import type { AppConfig, AppLogger, AuthResult, Identity, ShopAdapter } from "../types.js";

export interface ToolContext {
  config: AppConfig;
  auth: AuthResult;
  shop: ShopAdapter;
  logger: AppLogger;
  requestId: string;
}

export function jsonResult(structuredContent: Record<string, unknown>): CallToolResult {
  return {
    structuredContent,
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
  };
}

/**
 * Wraps a tool handler with the cross-cutting concerns every tool shares:
 * scope enforcement, structured logging, optional payload capture, and turning
 * thrown errors into safe client responses. Tool modules only implement `run`.
 */
export async function runTool(
  ctx: ToolContext,
  toolName: string,
  args: Record<string, unknown> | undefined,
  scopes: string[],
  run: (identity: Identity) => Promise<CallToolResult>
): Promise<CallToolResult> {
  const { logger, requestId, auth, config } = ctx;
  const startedAt = Date.now();
  const userIdHash = hashUserId(auth.identity?.userId);
  const payloadMode = config.logging.payloadMode;

  logger.info("mcp_tool_started", {
    requestId,
    toolName,
    userIdHash,
    authStatus: auth.status,
    requiredScopes: scopes,
    inputShape: Object.fromEntries(Object.keys(args ?? {}).map((key) => [key, true])),
  });

  const allowed = requireScopes(config, auth, scopes);
  if (!allowed.ok) {
    logger.info("mcp_tool_finished", {
      requestId,
      toolName,
      userIdHash,
      isError: true,
      durationMs: Date.now() - startedAt,
    });
    return allowed.result;
  }

  try {
    const result = await run(allowed.identity);
    logger.info("mcp_tool_finished", {
      requestId,
      toolName,
      userIdHash,
      isError: Boolean(result?.isError),
      durationMs: Date.now() - startedAt,
      // Opt-in full capture (LOG_PAYLOAD_MODE=all); contains customer PII.
      ...(payloadMode === "all"
        ? { arguments: args ?? {}, result: result?.structuredContent }
        : {}),
    });
    return result;
  } catch (error) {
    logger.error("mcp_tool_failed", {
      requestId,
      toolName,
      userIdHash,
      durationMs: Date.now() - startedAt,
      errorCode:
        error instanceof MedusaAuthError
          ? "shop_session_expired"
          : error instanceof CartNotFoundError
            ? "cart_not_found"
            : "tool_error",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
      ...(payloadMode !== "off" ? { arguments: args ?? {} } : {}),
    });

    if (error instanceof CartNotFoundError) {
      return {
        content: [{ type: "text", text: error.message }],
        structuredContent: {},
        isError: true,
      };
    }

    if (error instanceof MedusaAuthError) {
      return authErrorResult(
        config,
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

export type { ShopAdapter };
