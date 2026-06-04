# OpenObserve Logging

Use one log event per HTTP request and one per MCP tool call.

Useful fields:

- `requestId`
- `event`
- `method`
- `path`
- `toolName`
- `userIdHash`
- `shopId`
- `statusCode`
- `durationMs`
- `authStatus`
- `requiredScopes`
- `upstreamStatus`
- `upstreamRequestId`
- `errorCode`

Never log:

- passwords
- bearer tokens
- refresh tokens
- authorization headers
- card/payment data
- full personal data
- unnecessary pharmacy-sensitive details

For OpenObserve, set `OPENOBSERVE_INGEST_URL` to the full JSON ingest endpoint and `OPENOBSERVE_AUTH_HEADER` to the auth header value required by your OpenObserve instance.

Example:

```text
OPENOBSERVE_INGEST_URL=https://api.openobserve.ai/api/<organization>/<stream>/_json
OPENOBSERVE_AUTH_HEADER=Basic <base64-user-and-password-or-token>
SERVICE_NAME=webshop-chatgpt-mcp
SERVICE_ENV=production
LOG_HASH_SALT=<random-secret>
```

On Vercel, `api/mcp.js` passes Vercel's `waitUntil()` helper into the logger. That gives the OpenObserve ingest request time to finish after the MCP response is returned, instead of relying on fire-and-forget work that may be cancelled when the serverless function exits.
