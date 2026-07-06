import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authenticateRequest } from "../src/auth/tokenVerifier.js";
import { createOAuthHandlers } from "../src/oauth/handlers.js";
import {
  makeConfig,
  makeMedusaFetch,
  makeMedusaFetchState,
  makeReq,
  makeRes,
  type MedusaFetchState,
} from "./helpers.js";

const config = makeConfig();
const oauth = createOAuthHandlers(config);
const redirectUri = "https://chatgpt.com/connector_platform_oauth_redirect";

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

function pkcePair() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function baseAuthorizeParams(challenge: string): Record<string, string> {
  return {
    response_type: "code",
    client_id: "chatgpt",
    redirect_uri: redirectUri,
    state: "state-1",
    scope: "profile.read orders.read offline",
    code_challenge: challenge,
    code_challenge_method: "S256",
  };
}

async function login(
  challenge: string,
  password = "secret",
  scope?: string
): Promise<string | null> {
  const form = new URLSearchParams({
    ...baseAuthorizeParams(challenge),
    ...(scope ? { scope } : {}),
    email: "lauri@example.com",
    password,
  });
  const req = makeReq({
    method: "POST",
    url: "/oauth/login",
    body: form.toString(),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  const { res, out } = makeRes();
  await oauth.handleOAuthLoginRequest(req, res);

  if (out.statusCode !== 302) return null;
  return new URL(String(out.headers.location)).searchParams.get("code");
}

async function tokenRequest(form: Record<string, string>) {
  const req = makeReq({
    method: "POST",
    url: "/oauth/token",
    body: new URLSearchParams(form).toString(),
  });
  const { res, out } = makeRes();
  await oauth.handleOAuthTokenRequest(req, res);
  return out;
}

async function fullLogin(): Promise<TokenResponse> {
  const { verifier, challenge } = pkcePair();
  const code = await login(challenge);
  expect(code).toBeTruthy();

  const out = await tokenRequest({
    grant_type: "authorization_code",
    client_id: "chatgpt",
    redirect_uri: redirectUri,
    code: code ?? "",
    code_verifier: verifier,
  });
  expect(out.statusCode).toBe(200);
  return out.json() as TokenResponse;
}

async function sessionFor(accessToken: string) {
  const req = makeReq({ headers: { authorization: `Bearer ${accessToken}` } });
  return authenticateRequest(req, config);
}

describe("OAuth broker flow", () => {
  let medusaState: MedusaFetchState;

  beforeEach(() => {
    medusaState = makeMedusaFetchState();
    vi.stubGlobal("fetch", makeMedusaFetch(medusaState));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the login page for a valid authorize request", async () => {
    const { challenge } = pkcePair();
    const params = new URLSearchParams(baseAuthorizeParams(challenge));
    const req = makeReq({ method: "GET", url: `/oauth/authorize?${params.toString()}` });
    const { res, out } = makeRes();
    oauth.handleOAuthAuthorizeRequest(req, res);

    expect(out.statusCode).toBe(200);
    expect(out.body).toContain("Connect webshop account");
  });

  it("rejects disallowed redirect URIs", async () => {
    const { challenge } = pkcePair();
    const params = new URLSearchParams({
      ...baseAuthorizeParams(challenge),
      redirect_uri: "https://evil.example/callback",
    });
    const req = makeReq({ method: "GET", url: `/oauth/authorize?${params.toString()}` });
    const { res, out } = makeRes();
    oauth.handleOAuthAuthorizeRequest(req, res);

    expect(out.statusCode).toBe(400);
    expect(out.body).toContain("Redirect URI is not allowed.");
  });

  it("rejects wrong Medusa credentials with a 401 login page", async () => {
    const { challenge } = pkcePair();
    const form = new URLSearchParams({
      ...baseAuthorizeParams(challenge),
      email: "lauri@example.com",
      password: "wrong",
    });
    const req = makeReq({ method: "POST", url: "/oauth/login", body: form.toString() });
    const { res, out } = makeRes();
    await oauth.handleOAuthLoginRequest(req, res);

    expect(out.statusCode).toBe(401);
  });

  it("exchanges a code for tokens whose session carries the Medusa JWT", async () => {
    const tokens = await fullLogin();

    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.refresh_token).toMatch(/^rtk_/);

    const auth = await sessionFor(tokens.access_token);
    expect(auth.status).toBe("authenticated");
    expect(auth.identity?.userId).toBe("cus_1");
    expect(auth.identity?.medusaToken).toBe("medusa-jwt-1");
    expect(auth.scopes).toContain("orders.read");
  });

  it("rejects a token exchange with a wrong PKCE verifier", async () => {
    const { challenge } = pkcePair();
    const code = await login(challenge);

    const out = await tokenRequest({
      grant_type: "authorization_code",
      client_id: "chatgpt",
      redirect_uri: redirectUri,
      code: code ?? "",
      code_verifier: "wrong-verifier",
    });

    expect(out.statusCode).toBe(400);
    expect((out.json() as { error: string }).error).toBe("invalid_grant");
  });

  it("rejects authorization code reuse", async () => {
    const { verifier, challenge } = pkcePair();
    const code = await login(challenge);
    const form = {
      grant_type: "authorization_code",
      client_id: "chatgpt",
      redirect_uri: redirectUri,
      code: code ?? "",
      code_verifier: verifier,
    };

    expect((await tokenRequest(form)).statusCode).toBe(200);
    const replay = await tokenRequest(form);
    expect(replay.statusCode).toBe(400);
  });

  it("rotates the Medusa JWT on refresh so sessions stay usable", async () => {
    const tokens = await fullLogin();

    const out = await tokenRequest({
      grant_type: "refresh_token",
      client_id: "chatgpt",
      refresh_token: tokens.refresh_token,
    });
    expect(out.statusCode).toBe(200);
    const refreshed = out.json() as TokenResponse;

    const auth = await sessionFor(refreshed.access_token);
    expect(auth.status).toBe("authenticated");
    expect(auth.identity?.medusaToken).toBe("medusa-jwt-refreshed-1");
    expect(medusaState.refreshCount).toBe(1);
  });

  it("returns invalid_grant when the Medusa session can no longer be refreshed", async () => {
    const tokens = await fullLogin();

    medusaState.liveTokens.clear();

    const out = await tokenRequest({
      grant_type: "refresh_token",
      client_id: "chatgpt",
      refresh_token: tokens.refresh_token,
    });

    expect(out.statusCode).toBe(400);
    expect((out.json() as { error: string }).error).toBe("invalid_grant");
  });

  it("rotates refresh tokens (old refresh token becomes unusable)", async () => {
    const tokens = await fullLogin();

    const first = await tokenRequest({
      grant_type: "refresh_token",
      client_id: "chatgpt",
      refresh_token: tokens.refresh_token,
    });
    expect(first.statusCode).toBe(200);

    const replay = await tokenRequest({
      grant_type: "refresh_token",
      client_id: "chatgpt",
      refresh_token: tokens.refresh_token,
    });
    expect(replay.statusCode).toBe(400);
  });

  it("reports the session's actual narrowed scope, not the full supported-scope list", async () => {
    const { verifier, challenge } = pkcePair();
    const code = await login(challenge, "secret", "profile.read orders.read");

    const out = await tokenRequest({
      grant_type: "authorization_code",
      client_id: "chatgpt",
      redirect_uri: redirectUri,
      code: code ?? "",
      code_verifier: verifier,
    });

    expect(out.statusCode).toBe(200);
    const tokens = out.json() as TokenResponse;
    expect(tokens.scope).toBe("profile.read orders.read");
  });

  it("rejects unknown clients at the token endpoint", async () => {
    const out = await tokenRequest({
      grant_type: "refresh_token",
      client_id: "not-chatgpt",
      refresh_token: "rtk_x",
    });
    expect(out.statusCode).toBe(401);
  });
});
