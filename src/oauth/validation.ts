import type { AppConfig } from "../types.js";

function allowedScopes(config: AppConfig): Set<string> {
  return new Set([
    config.scopes.profileRead,
    config.scopes.ordersRead,
    "offline",
    "offline_access",
  ]);
}

export function parseScopes(config: AppConfig, value: string | undefined): string[] {
  const allowed = allowedScopes(config);
  const requested = String(value ?? "")
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);

  const scopes = requested.length
    ? requested.filter((scope) => allowed.has(scope))
    : [config.scopes.profileRead, config.scopes.ordersRead];

  return [...new Set(scopes.filter((scope) => scope !== "offline_access"))];
}

export function isAllowedRedirectUri(config: AppConfig, value: string | undefined): boolean {
  if (!value) return false;
  if (config.broker.redirectUris.includes(value)) return true;

  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "chatgpt.com" &&
      (url.pathname === "/connector_platform_oauth_redirect" ||
        url.pathname.startsWith("/connector/oauth/"))
    );
  } catch {
    return false;
  }
}

/** Returns an error message string, or null when the params are valid. */
export function validateAuthorizationParams(
  config: AppConfig,
  params: Record<string, string>
): string | null {
  if (params.response_type !== "code") {
    return "Only response_type=code is supported.";
  }
  if (params.client_id !== config.broker.clientId) {
    return "Unknown OAuth client.";
  }
  if (!isAllowedRedirectUri(config, params.redirect_uri)) {
    return "Redirect URI is not allowed.";
  }
  if (!params.code_challenge || params.code_challenge_method !== "S256") {
    return "PKCE S256 code challenge is required.";
  }
  return null;
}
