import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  customerDisplayName,
  fetchCustomerProfile,
  loginCustomer,
  maskEmail,
  MedusaRequestError,
  refreshCustomerToken,
} from "../medusa/client.js";
import { createAppLogger, hashUserId } from "../logging/logger.js";
import type { AppConfig, BrokerSession } from "../types.js";
import { oauthMetadata } from "./metadata.js";
import { checkRateLimit } from "./rateLimit.js";
import {
  consumeAuthorizationCode,
  consumeRefreshToken,
  randomToken,
  storeAccessToken,
  storeAuthorizationCode,
  storeRefreshToken,
} from "./storage.js";
import { clientIp, readForm, redirect, sendHtml, sendJson } from "./http.js";

interface AuthorizationCodePayload extends BrokerSession {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
}

function htmlEscape(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function hidden(name: string, value: string): string {
  return `<input type="hidden" name="${htmlEscape(name)}" value="${htmlEscape(value)}" />`;
}

function pkceS256(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function authorizationParamsFromUrl(req: IncomingMessage): Record<string, string> {
  const url = new URL(req.url ?? "/", `https://${req.headers.host ?? "localhost"}`);
  return Object.fromEntries(url.searchParams);
}

export interface OAuthHandlers {
  handleOAuthMetadataRequest(req: IncomingMessage, res: ServerResponse): void;
  handleOAuthAuthorizeRequest(req: IncomingMessage, res: ServerResponse): void;
  handleOAuthLoginRequest(req: IncomingMessage, res: ServerResponse): Promise<void>;
  handleOAuthTokenRequest(req: IncomingMessage, res: ServerResponse): Promise<void>;
}

export function createOAuthHandlers(config: AppConfig): OAuthHandlers {
  const logger = createAppLogger(config);
  const allowedScopes = new Set([
    config.scopes.profileRead,
    config.scopes.ordersRead,
    "offline",
    "offline_access",
  ]);

  function parseScopes(value: string | undefined): string[] {
    const requested = String(value ?? "")
      .split(/\s+/)
      .map((scope) => scope.trim())
      .filter(Boolean);

    const scopes = requested.length
      ? requested.filter((scope) => allowedScopes.has(scope))
      : [config.scopes.profileRead, config.scopes.ordersRead];

    return [...new Set(scopes.filter((scope) => scope !== "offline_access"))];
  }

  function isAllowedRedirectUri(value: string | undefined): boolean {
    if (!value) return false;

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

  function validateAuthorizationParams(params: Record<string, string>): string | null {
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

  function loginPage(params: Record<string, string>, error = ""): string {
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

  async function loginToMedusa(email: string, password: string) {
    if (!config.medusa.baseUrl || !config.medusa.publishableKey) {
      throw new Error("Medusa OAuth broker configuration is missing.");
    }

    const medusaToken = await loginCustomer(config, email, password);
    const customer = await fetchCustomerProfile(config, medusaToken);

    return {
      medusaToken,
      customerId: String(customer.id ?? email),
      displayName: customerDisplayName(customer),
      emailMasked: maskEmail(customer.email ?? email),
    };
  }

  function tokenResponse(accessToken: string, refreshToken: string) {
    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: config.broker.accessTokenTtlSec,
      refresh_token: refreshToken,
      scope: `${config.scopes.profileRead} ${config.scopes.ordersRead}`,
    };
  }

  async function issueTokens(session: BrokerSession) {
    const accessToken = randomToken("atk");
    const refreshToken = randomToken("rtk");
    const payload: BrokerSession = {
      ...session,
      issuedAt: new Date().toISOString(),
    };

    await storeAccessToken(accessToken, payload, config.broker.accessTokenTtlSec);
    await storeRefreshToken(refreshToken, payload, config.broker.refreshTokenTtlSec);

    return tokenResponse(accessToken, refreshToken);
  }

  async function handleAuthorizationCodeGrant(
    form: Record<string, string>,
    res: ServerResponse
  ): Promise<void> {
    const codePayload = await consumeAuthorizationCode<AuthorizationCodePayload>(
      form.code ?? ""
    );
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

  async function handleRefreshGrant(
    form: Record<string, string>,
    res: ServerResponse
  ): Promise<void> {
    const session = await consumeRefreshToken<BrokerSession>(form.refresh_token ?? "");
    if (!session) {
      sendJson(res, 400, { error: "invalid_grant" });
      return;
    }

    // Medusa JWTs expire on their own (24h by default), so a refresh that
    // keeps the old JWT would hand out broker tokens that can no longer reach
    // the shop. Rotate the Medusa JWT here; if Medusa rejects it, the user
    // must sign in again.
    let medusaToken = session.medusaToken;
    if (medusaToken) {
      try {
        medusaToken = await refreshCustomerToken(config, medusaToken);
      } catch {
        sendJson(res, 400, {
          error: "invalid_grant",
          error_description: "Webshop session expired. Please sign in again.",
        });
        return;
      }
    }

    const response = await issueTokens({ ...session, medusaToken });
    sendJson(res, 200, response);
  }

  return {
    handleOAuthMetadataRequest(_req, res) {
      sendJson(res, 200, oauthMetadata(config));
    },

    handleOAuthAuthorizeRequest(req, res) {
      if (req.method !== "GET") {
        sendJson(res, 405, { error: "method_not_allowed" });
        return;
      }

      const params = authorizationParamsFromUrl(req);
      const error = validateAuthorizationParams(params);

      sendHtml(res, error ? 400 : 200, loginPage(params, error ?? ""));
    },

    async handleOAuthLoginRequest(req, res) {
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

      // The login form proxies real Medusa passwords, so the endpoint must be
      // protected against brute force. Limit by source IP and by target email.
      const ip = clientIp(req);
      const email = (form.email ?? "").trim().toLowerCase();
      const ipLimit = await checkRateLimit(
        "login-ip",
        ip,
        config.rateLimit.loginPerIp,
        config.rateLimit.windowSec
      );
      const emailLimit = email
        ? await checkRateLimit(
            "login-email",
            email,
            config.rateLimit.loginPerEmail,
            config.rateLimit.windowSec
          )
        : { allowed: true, retryAfterSec: 0 };

      if (!ipLimit.allowed || !emailLimit.allowed) {
        const retryAfter = Math.max(ipLimit.retryAfterSec, emailLimit.retryAfterSec);
        logger.warn("broker_login_rate_limited", {
          ipHash: hashUserId(ip),
          emailMasked: maskEmail(email),
          byIp: !ipLimit.allowed,
          byEmail: !emailLimit.allowed,
        });
        sendHtml(
          res,
          429,
          loginPage(
            form,
            "Too many sign-in attempts. Please wait a few minutes and try again."
          ),
          { "retry-after": String(retryAfter) }
        );
        return;
      }

      try {
        const scopes = parseScopes(form.scope);
        const medusa = await loginToMedusa(form.email ?? "", form.password ?? "");
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

        const redirectUrl = new URL(form.redirect_uri ?? "");
        redirectUrl.searchParams.set("code", code);
        if (form.state) {
          redirectUrl.searchParams.set("state", form.state);
        }

        redirect(res, redirectUrl.toString());
      } catch (loginError) {
        const status =
          loginError instanceof MedusaRequestError ? loginError.status : 0;

        logger.warn("broker_login_failed", {
          emailMasked: maskEmail(email),
          upstreamStatus: status,
        });

        // Don't leak raw upstream status/HTML to the customer. 401 means bad
        // credentials; 5xx (or no status) means the webshop is unreachable.
        if (status === 401) {
          sendHtml(res, 401, loginPage(form, "Invalid email or password."));
          return;
        }

        sendHtml(
          res,
          503,
          loginPage(
            form,
            "The webshop is temporarily unavailable. Please try again in a few minutes."
          )
        );
      }
    },

    async handleOAuthTokenRequest(req, res) {
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
    },
  };
}
