import crypto from "node:crypto";
import { config } from "../config.js";
import { oauthMetadata } from "./metadata.js";
import {
  consumeAuthorizationCode,
  consumeRefreshToken,
  randomToken,
  storeAccessToken,
  storeAuthorizationCode,
  storeRefreshToken,
} from "./storage.js";
import { readForm, redirect, sendHtml, sendJson } from "./http.js";

const allowedScopes = new Set([
  config.scopes.profileRead,
  config.scopes.ordersRead,
  "offline",
  "offline_access",
]);

function normalizeBaseUrl(value) {
  return String(value ?? "").replace(/\/+$/, "");
}

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function hidden(name, value) {
  return `<input type="hidden" name="${htmlEscape(name)}" value="${htmlEscape(value)}" />`;
}

function parseScopes(value) {
  const requested = String(value ?? "")
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);

  const scopes = requested.length
    ? requested.filter((scope) => allowedScopes.has(scope))
    : [config.scopes.profileRead, config.scopes.ordersRead];

  return [...new Set(scopes.filter((scope) => scope !== "offline_access"))];
}

function isAllowedRedirectUri(value) {
  if (config.broker.redirectUris.includes(value)) {
    return true;
  }

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

function validateAuthorizationParams(params) {
  if (params.response_type !== "code") {
    return "Only response_type=code is supported.";
  }

  if (params.client_id !== config.broker.clientId) {
    return "Unknown OAuth client.";
  }

  if (!isAllowedRedirectUri(params.redirect_uri)) {
    return "Redirect URI is not allowed.";
  }

  if (!params.code_challenge || params.code_challenge_method !== "S256") {
    return "PKCE S256 code challenge is required.";
  }

  return null;
}

function authorizationParamsFromUrl(req) {
  const url = new URL(req.url ?? "/", `https://${req.headers.host ?? "localhost"}`);
  return Object.fromEntries(url.searchParams);
}

function loginPage(params, error = "") {
  const hiddenInputs = [
    "response_type",
    "client_id",
    "redirect_uri",
    "state",
    "scope",
    "resource",
    "code_challenge",
    "code_challenge_method",
  ]
    .map((name) => hidden(name, params[name] ?? ""))
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Connect webshop account</title>
    <style>
      :root { color: #18181b; font-family: Inter, system-ui, sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f5f7; }
      main { width: min(420px, calc(100vw - 32px)); background: white; border: 1px solid #d9dde5; border-radius: 8px; padding: 24px; box-shadow: 0 16px 40px rgba(15, 23, 42, 0.08); }
      h1 { margin: 0 0 8px; font-size: 1.25rem; }
      p { margin: 0 0 18px; color: #525866; line-height: 1.4; }
      label { display: block; margin: 14px 0 6px; font-size: 0.9rem; font-weight: 600; }
      input { width: 100%; box-sizing: border-box; padding: 11px 12px; border: 1px solid #c7ccd6; border-radius: 6px; font: inherit; }
      button { width: 100%; margin-top: 18px; padding: 11px 14px; border: 0; border-radius: 6px; background: #111827; color: white; font-weight: 700; cursor: pointer; }
      .error { margin: 0 0 14px; padding: 10px 12px; border-radius: 6px; background: #fff1f2; color: #9f1239; font-size: 0.9rem; }
    </style>
  </head>
  <body>
    <main>
      <h1>Connect webshop account</h1>
      <p>Sign in with your webshop customer account to let ChatGPT read your orders.</p>
      ${error ? `<div class="error">${htmlEscape(error)}</div>` : ""}
      <form method="post" action="/oauth/login">
        ${hiddenInputs}
        <label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="email" required />
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required />
        <button type="submit">Connect account</button>
      </form>
    </main>
  </body>
</html>`;
}

function pkceS256(verifier) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function maskEmail(email) {
  if (!email || !String(email).includes("@")) return null;
  const [name, domain] = String(email).split("@");
  return `${name.slice(0, 2)}***@${domain}`;
}

function displayName(customer) {
  const parts = [customer.first_name, customer.last_name].filter(Boolean);
  return parts.length ? parts.join(" ") : "Customer";
}

async function medusaRequest(path, medusaToken, options = {}) {
  const response = await fetch(`${normalizeBaseUrl(config.medusa.baseUrl)}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-publishable-api-key": config.medusa.publishableKey,
      ...(medusaToken ? { Authorization: `Bearer ${medusaToken}` } : {}),
      ...options.headers,
    },
  });

  const bodyText = await response.text();
  const body = bodyText ? JSON.parse(bodyText) : null;

  if (!response.ok) {
    throw new Error(body?.message ?? `Medusa request failed with ${response.status}`);
  }

  return body;
}

async function loginToMedusa(email, password) {
  if (!config.medusa.baseUrl || !config.medusa.publishableKey) {
    throw new Error("Medusa OAuth broker configuration is missing.");
  }

  const auth = await medusaRequest("/auth/customer/emailpass", null, {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

  if (!auth?.token) {
    throw new Error("Medusa did not return a customer token.");
  }

  const me = await medusaRequest("/store/customers/me", auth.token);
  const customer = me?.customer ?? {};

  return {
    medusaToken: auth.token,
    customerId: String(customer.id ?? email),
    displayName: displayName(customer),
    emailMasked: maskEmail(customer.email ?? email),
  };
}

function tokenResponse(accessToken, refreshToken) {
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: config.broker.accessTokenTtlSec,
    refresh_token: refreshToken,
    scope: `${config.scopes.profileRead} ${config.scopes.ordersRead}`,
  };
}

async function issueTokens(session) {
  const accessToken = randomToken("atk");
  const refreshToken = randomToken("rtk");
  const accessPayload = {
    ...session,
    issuedAt: new Date().toISOString(),
  };
  const refreshPayload = {
    ...session,
    issuedAt: new Date().toISOString(),
  };

  await storeAccessToken(accessToken, accessPayload, config.broker.accessTokenTtlSec);
  await storeRefreshToken(refreshToken, refreshPayload, config.broker.refreshTokenTtlSec);

  return tokenResponse(accessToken, refreshToken);
}

export function handleOAuthMetadataRequest(_req, res) {
  sendJson(res, 200, oauthMetadata(config));
}

export function handleOAuthAuthorizeRequest(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  const params = authorizationParamsFromUrl(req);
  const error = validateAuthorizationParams(params);

  sendHtml(res, error ? 400 : 200, loginPage(params, error ?? ""));
}

export async function handleOAuthLoginRequest(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  const form = await readForm(req);
  const error = validateAuthorizationParams(form);
  if (error) {
    sendHtml(res, 400, loginPage(form, error));
    return;
  }

  try {
    const scopes = parseScopes(form.scope);
    const medusa = await loginToMedusa(form.email, form.password);
    const code = randomToken("code");
    await storeAuthorizationCode(
      code,
      {
        clientId: form.client_id,
        redirectUri: form.redirect_uri,
        codeChallenge: form.code_challenge,
        scopes,
        customerId: medusa.customerId,
        displayName: medusa.displayName,
        emailMasked: medusa.emailMasked,
        medusaToken: medusa.medusaToken,
      },
      config.broker.codeTtlSec
    );

    const redirectUrl = new URL(form.redirect_uri);
    redirectUrl.searchParams.set("code", code);
    if (form.state) {
      redirectUrl.searchParams.set("state", form.state);
    }

    redirect(res, redirectUrl.toString());
  } catch (loginError) {
    sendHtml(
      res,
      401,
      loginPage(form, loginError instanceof Error ? loginError.message : "Login failed.")
    );
  }
}

async function handleAuthorizationCodeGrant(form, res) {
  const codePayload = await consumeAuthorizationCode(form.code);
  if (!codePayload) {
    sendJson(res, 400, { error: "invalid_grant" });
    return;
  }

  if (
    form.client_id !== codePayload.clientId ||
    form.redirect_uri !== codePayload.redirectUri ||
    pkceS256(form.code_verifier ?? "") !== codePayload.codeChallenge
  ) {
    sendJson(res, 400, { error: "invalid_grant" });
    return;
  }

  const response = await issueTokens({
    customerId: codePayload.customerId,
    displayName: codePayload.displayName,
    emailMasked: codePayload.emailMasked,
    scopes: codePayload.scopes,
    medusaToken: codePayload.medusaToken,
  });
  sendJson(res, 200, response);
}

async function handleRefreshGrant(form, res) {
  const session = await consumeRefreshToken(form.refresh_token);
  if (!session) {
    sendJson(res, 400, { error: "invalid_grant" });
    return;
  }

  const response = await issueTokens(session);
  sendJson(res, 200, response);
}

export async function handleOAuthTokenRequest(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  const form = await readForm(req);
  if (form.client_id !== config.broker.clientId) {
    sendJson(res, 401, { error: "invalid_client" });
    return;
  }

  if (form.grant_type === "authorization_code") {
    await handleAuthorizationCodeGrant(form, res);
    return;
  }

  if (form.grant_type === "refresh_token") {
    await handleRefreshGrant(form, res);
    return;
  }

  sendJson(res, 400, { error: "unsupported_grant_type" });
}
