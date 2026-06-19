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
import { renderLoginPage } from "./loginPage.js";
import { checkRateLimit } from "./rateLimit.js";
import { parseScopes, validateAuthorizationParams } from "./validation.js";
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
      const error = validateAuthorizationParams(config, params);

      sendHtml(res, error ? 400 : 200, renderLoginPage(params, error ?? ""));
    },

    async handleOAuthLoginRequest(req, res) {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "method_not_allowed" });
        return;
      }

      const form = await readForm(req);
      const error = validateAuthorizationParams(config, form);
      if (error) {
        sendHtml(res, 400, renderLoginPage(form, error));
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
          renderLoginPage(
            form,
            "Too many sign-in attempts. Please wait a few minutes and try again."
          ),
          { "retry-after": String(retryAfter) }
        );
        return;
      }

      try {
        const scopes = parseScopes(config, form.scope);
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
          sendHtml(res, 401, renderLoginPage(form, "Invalid email or password."));
          return;
        }

        sendHtml(
          res,
          503,
          renderLoginPage(
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
