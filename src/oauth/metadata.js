export function oauthMetadata(config) {
  const issuer = config.auth.issuer;

  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [config.scopes.profileRead, config.scopes.ordersRead, "offline"],
    resource_documentation: `${config.publicBaseUrl}/docs`,
  };
}
