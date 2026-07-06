import crypto from "node:crypto";
import type { ServerResponse } from "node:http";
import { refreshCustomerToken } from "../medusa/client.js";
import type { AppConfig, BrokerSession } from "../types.js";
import { sendJson } from "./http.js";
import {
  consumeAuthorizationCode,
  consumeRefreshToken,
  randomToken,
  storeAccessToken,
  storeRefreshToken,
} from "./storage.js";

export interface AuthorizationCodePayload extends BrokerSession {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
}

export interface TokenGrants {
  handleAuthorizationCodeGrant(
    form: Record<string, string>,
    res: ServerResponse
  ): Promise<void>;
  handleRefreshGrant(form: Record<string, string>, res: ServerResponse): Promise<void>;
}

function pkceS256(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export function createTokenGrants(config: AppConfig): TokenGrants {
  function tokenResponse(accessToken: string, refreshToken: string, scopes: string[]) {
    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: config.broker.accessTokenTtlSec,
      refresh_token: refreshToken,
      scope: scopes.join(" "),
    };
  }

  async function issueTokens(session: BrokerSession) {
    const accessToken = randomToken("atk");
    const refreshToken = randomToken("rtk");
    const payload: BrokerSession = { ...session, issuedAt: new Date().toISOString() };

    await storeAccessToken(accessToken, payload, config.broker.accessTokenTtlSec);
    await storeRefreshToken(refreshToken, payload, config.broker.refreshTokenTtlSec);

    return tokenResponse(accessToken, refreshToken, payload.scopes);
  }

  return {
    async handleAuthorizationCodeGrant(form, res) {
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
    },

    async handleRefreshGrant(form, res) {
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
    },
  };
}
