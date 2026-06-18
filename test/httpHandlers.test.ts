import { describe, expect, it } from "vitest";
import { makeReq, makeRes } from "./helpers.js";

process.env.AUTH_MODE = "broker";
process.env.SHOP_ADAPTER = "mock";
process.env.PUBLIC_BASE_URL = "https://mcp.test";

const { handleMcpRequest } = await import("../src/httpHandlers.js");

const initializeBody = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test", version: "1.0.0" },
  },
});

function mcpReq(headers: Record<string, string> = {}) {
  return makeReq({
    method: "POST",
    url: "/mcp",
    body: initializeBody,
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
  });
}

describe("handleMcpRequest auth (broker mode)", () => {
  it("returns 401 with a WWW-Authenticate challenge when no token is sent", async () => {
    const { res, out } = makeRes();
    await handleMcpRequest(mcpReq(), res);

    expect(out.statusCode).toBe(401);
    const challenge = String(out.headers["www-authenticate"]);
    expect(challenge).toContain("resource_metadata=");
    expect(challenge).toContain("/.well-known/oauth-protected-resource");
  });

  it("returns 401 invalid_token for an expired or unknown broker token", async () => {
    const { res, out } = makeRes();
    await handleMcpRequest(mcpReq({ authorization: "Bearer atk_expired" }), res);

    expect(out.statusCode).toBe(401);
    expect(String(out.headers["www-authenticate"])).toContain('error="invalid_token"');
  });

  it("keeps CORS headers on 401 responses", async () => {
    const { res, out } = makeRes();
    await handleMcpRequest(mcpReq(), res);

    expect(out.headers["access-control-allow-origin"]).toBe("*");
  });

  it("answers OPTIONS preflight with 204", async () => {
    const { res, out } = makeRes();
    await handleMcpRequest(makeReq({ method: "OPTIONS", url: "/mcp" }), res);

    expect(out.statusCode).toBe(204);
  });
});
