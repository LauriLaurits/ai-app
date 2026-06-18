import type { AppConfig, AuthResult, Identity } from "../types.js";

export interface ChallengeOptions {
  error?: string;
  errorDescription?: string;
}

export function buildWwwAuthenticate(
  config: AppConfig,
  scopes: string[],
  options: ChallengeOptions = {}
): string {
  const params = [
    `resource_metadata="${config.publicBaseUrl}/.well-known/oauth-protected-resource"`,
  ];

  if (scopes.length > 0) {
    params.push(`scope="${scopes.join(" ")}"`);
  }

  if (options.error) {
    params.push(`error="${options.error}"`);
  }

  if (options.errorDescription) {
    params.push(`error_description="${options.errorDescription}"`);
  }

  return `Bearer ${params.join(", ")}`;
}

export interface AuthErrorToolResult {
  content: Array<{ type: "text"; text: string }>;
  _meta: { "mcp/www_authenticate": string[] };
  isError: true;
  [key: string]: unknown;
}

export function authErrorResult(
  config: AppConfig,
  scopes: string[],
  reason?: string | null
): AuthErrorToolResult {
  const challenge = buildWwwAuthenticate(config, scopes, {
    error: "insufficient_scope",
    errorDescription: reason ?? "Login required to continue",
  });

  return {
    content: [
      {
        type: "text",
        text: "Authentication required. Please connect your webshop account.",
      },
    ],
    _meta: {
      "mcp/www_authenticate": [challenge],
    },
    isError: true,
  };
}

export type ScopeCheck =
  | { ok: true; identity: Identity }
  | { ok: false; result: AuthErrorToolResult };

export function requireScopes(
  config: AppConfig,
  auth: AuthResult,
  scopes: string[]
): ScopeCheck {
  if (!auth.identity) {
    return {
      ok: false,
      result: authErrorResult(
        config,
        scopes,
        auth.reason ?? "No valid access token was provided"
      ),
    };
  }

  const missingScopes = scopes.filter((scope) => !auth.scopes.includes(scope));
  if (missingScopes.length > 0) {
    return {
      ok: false,
      result: authErrorResult(
        config,
        scopes,
        `Missing required scope: ${missingScopes.join(", ")}`
      ),
    };
  }

  return { ok: true, identity: auth.identity };
}
