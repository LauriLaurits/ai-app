import type { IncomingMessage } from "node:http";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { getAccessTokenSession } from "../oauth/storage.js";
import { supportedScopes } from "../oauth/validation.js";
import type { AppConfig, AuthResult, BrokerSession } from "../types.js";

let remoteJwks: ReturnType<typeof createRemoteJWKSet> | undefined;
const demoAllowedAdapters = new Set(["mock", "medusa"]);

function readAuthorizationHeader(req: IncomingMessage): string {
  const value = req.headers.authorization;
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function parseScopes(payload: Record<string, unknown>): string[] {
  if (typeof payload.scope === "string") {
    return payload.scope.split(/\s+/).filter(Boolean);
  }

  if (Array.isArray(payload.scp)) {
    return payload.scp.filter((scope): scope is string => typeof scope === "string");
  }

  return [];
}

function tokenFromRequest(req: IncomingMessage): string {
  const authorization = readAuthorizationHeader(req);
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? "";
}

function invalid(reason: string): AuthResult {
  return { status: "invalid", identity: null, scopes: [], reason };
}

function demoAuthResult(config: AppConfig): AuthResult {
  if (!demoAllowedAdapters.has(config.shop.adapter)) {
    return invalid("Demo auth is only allowed with staging-safe shop adapters");
  }

  return {
    status: "authenticated",
    identity: {
      userId: "demo-user-1",
      displayName: "Demo Customer",
      shopIds: ["apotheka"],
    },
    scopes: supportedScopes(config),
    reason: null,
  };
}

export async function authenticateRequest(
  req: IncomingMessage,
  config: AppConfig
): Promise<AuthResult> {
  const token = tokenFromRequest(req);

  if (!token) {
    if (config.auth.mode === "demo") {
      return demoAuthResult(config);
    }

    return {
      status: "missing",
      identity: null,
      scopes: [],
      reason: "No bearer token was provided",
    };
  }

  if (config.auth.mode === "mock") {
    if (token !== config.auth.mockBearerToken) {
      return invalid("Mock bearer token did not match");
    }

    return {
      status: "authenticated",
      identity: {
        userId: "demo-user-1",
        displayName: "Demo Customer",
        shopIds: ["apotheka"],
      },
      scopes: supportedScopes(config),
      reason: null,
    };
  }

  if (config.auth.mode === "demo") {
    return demoAuthResult(config);
  }

  if (config.auth.mode === "broker") {
    const session = await getAccessTokenSession<BrokerSession>(token);
    if (!session) {
      return invalid("OAuth broker token is invalid or expired");
    }

    return {
      status: "authenticated",
      identity: {
        userId: String(session.customerId),
        displayName: String(session.displayName ?? "Customer"),
        shopIds: ["medusa"],
        medusaToken: session.medusaToken,
        emailMasked: session.emailMasked ?? null,
      },
      scopes: Array.isArray(session.scopes) ? session.scopes : [],
      reason: null,
    };
  }

  if (config.auth.mode !== "jwt") {
    return invalid(`Unsupported AUTH_MODE: ${config.auth.mode}`);
  }

  if (!config.auth.jwksUrl) {
    return invalid("OAUTH_JWKS_URL is required in jwt auth mode");
  }

  try {
    remoteJwks ??= createRemoteJWKSet(new URL(config.auth.jwksUrl));
    const { payload } = await jwtVerify(token, remoteJwks, {
      issuer: config.auth.issuer,
      audience: config.auth.audience,
    });

    return {
      status: "authenticated",
      identity: {
        userId: String(payload.sub),
        displayName: String(payload.name ?? payload.preferred_username ?? "User"),
        shopIds: Array.isArray(payload.shop_ids)
          ? payload.shop_ids.map(String)
          : ["apotheka"],
      },
      scopes: parseScopes(payload),
      reason: null,
    };
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "Token verification failed");
  }
}
