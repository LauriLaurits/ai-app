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
