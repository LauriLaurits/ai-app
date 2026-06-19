import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOAuthHandlers } from "../src/oauth/handlers.js";
import {
  makeConfig,
  makeMedusaFetch,
  makeMedusaFetchState,
  makeReq,
  makeRes,
  type MedusaFetchState,
} from "./helpers.js";

const redirectUri = "https://chatgpt.com/connector_platform_oauth_redirect";

function challenge(): string {
  const verifier = crypto.randomBytes(32).toString("base64url");
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function loginForm(email: string, password: string) {
  return new URLSearchParams({
    response_type: "code",
    client_id: "chatgpt",
    redirect_uri: redirectUri,
    state: "state-1",
    scope: "profile.read orders.read offline",
    code_challenge: challenge(),
    code_challenge_method: "S256",
    email,
    password,
  }).toString();
}

async function postLogin(
  handlers: ReturnType<typeof createOAuthHandlers>,
  ip: string,
  email: string,
  password: string
) {
  const req = makeReq({
    method: "POST",
    url: "/oauth/login",
    body: loginForm(email, password),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-forwarded-for": ip,
    },
  });
  const { res, out } = makeRes();
  await handlers.handleOAuthLoginRequest(req, res);
  return out;
}

describe("login endpoint hardening", () => {
  let medusaState: MedusaFetchState;

  beforeEach(() => {
    medusaState = makeMedusaFetchState();
    vi.stubGlobal("fetch", makeMedusaFetch(medusaState));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("blocks too many attempts from one IP with 429 and Retry-After", async () => {
    const handlers = createOAuthHandlers(
      makeConfig({ rateLimit: { loginPerIp: 3, loginPerEmail: 1000, windowSec: 900 } })
    );
    const ip = `9.9.9.${Math.floor(Math.random() * 1000)}`;

    for (let i = 0; i < 3; i += 1) {
      const out = await postLogin(handlers, ip, `u${i}@example.com`, "nope");
      expect(out.statusCode).not.toBe(429);
    }

    const blocked = await postLogin(handlers, ip, "u4@example.com", "nope");
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(blocked.body).toContain("Too many");
  });

  it("blocks too many attempts against one email even across IPs", async () => {
    const handlers = createOAuthHandlers(
      makeConfig({ rateLimit: { loginPerIp: 1000, loginPerEmail: 2, windowSec: 900 } })
    );
    const email = `victim-${Math.random()}@example.com`;

    expect((await postLogin(handlers, "1.1.1.1", email, "a")).statusCode).not.toBe(429);
    expect((await postLogin(handlers, "2.2.2.2", email, "b")).statusCode).not.toBe(429);
    expect((await postLogin(handlers, "3.3.3.3", email, "c")).statusCode).toBe(429);
  });

  it("shows a friendly message and 503 when Medusa is down (5xx)", async () => {
    vi.stubGlobal(
      "fetch",
      (async () =>
        new Response("<html>502 Bad Gateway</html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        })) as typeof fetch
    );
    const handlers = createOAuthHandlers(makeConfig());

    const out = await postLogin(handlers, "8.8.8.8", "lauri@example.com", "secret");

    expect(out.statusCode).toBe(503);
    expect(out.body).toContain("temporarily unavailable");
    expect(out.body).not.toContain("502");
  });

  it("does not leak the raw upstream status to the user", async () => {
    const handlers = createOAuthHandlers(makeConfig());
    const out = await postLogin(handlers, "7.7.7.7", "lauri@example.com", "wrong");

    expect(out.statusCode).toBe(401);
    expect(out.body).not.toContain("status 401");
  });
});
