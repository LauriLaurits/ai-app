export function buildWwwAuthenticate(config, scopes, options = {}) {
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

export function authErrorResult(config, scopes, reason) {
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

export function requireScopes(config, auth, scopes) {
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
