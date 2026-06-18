# OAuth Broker

The OAuth broker lets ChatGPT connect real Medusa customers without changing the Medusa backend first.

## Flow

```text
ChatGPT
  -> GET /oauth/authorize
  -> ai-app login page
  -> user enters Medusa customer email/password
  -> ai-app calls POST /auth/customer/emailpass
  -> ai-app stores the Medusa customer JWT server-side
  -> ChatGPT exchanges authorization code at POST /oauth/token
  -> ChatGPT calls /mcp with the broker access token
  -> ai-app looks up the Medusa JWT and calls /store/orders
```

The access token given to ChatGPT is opaque. It does not contain the Medusa JWT.

## Session Lifetime

- Broker access tokens live `OAUTH_BROKER_ACCESS_TOKEN_TTL_SEC` (default 1h).
- Broker refresh tokens live `OAUTH_BROKER_REFRESH_TOKEN_TTL_SEC` (default 30d) and are single-use (rotated on every refresh).
- When ChatGPT calls `/mcp` with a missing or expired token, the server replies `401` with a `WWW-Authenticate` challenge. ChatGPT then silently exchanges its refresh token — the user does not see a login screen.
- On every `refresh_token` grant, the broker also rotates the stored Medusa customer JWT via `POST /auth/token/refresh`. Without this, Medusa JWTs (24h default) would expire while the broker session was still "valid" and every order call would fail.
- If Medusa refuses to refresh (customer JWT already expired), the broker answers `invalid_grant`, which makes ChatGPT prompt the user to reconnect — a clean re-login instead of a dead "try again later" error.

The practical consequence: the user stays logged in as long as ChatGPT refreshes at least once per Medusa JWT lifetime. To survive long idle gaps (e.g. a week of not using the app), raise the Medusa JWT lifetime in `medusa-config.ts`:

```ts
projectConfig: {
  http: {
    jwtExpiresIn: "30d",
  },
},
```

## Required Vercel Env

```text
AUTH_MODE=broker
SHOP_ADAPTER=medusa
PUBLIC_BASE_URL=https://ai-app-iota-gilt.vercel.app

MEDUSA_BASE_URL=https://dev-medusa-ee.wolfgrouppartner.com
MEDUSA_PUBLISHABLE_KEY=pk_...

OAUTH_BROKER_CLIENT_ID=chatgpt
OAUTH_BROKER_REDIRECT_URIS=https://chatgpt.com/connector_platform_oauth_redirect

UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

Do not set `MEDUSA_CUSTOMER_EMAIL` or `MEDUSA_CUSTOMER_PASSWORD` for broker production mode. Those are only for the older staging shared-customer demo.

## ChatGPT Connector

Use OAuth authentication.

Server URL:

```text
https://ai-app-iota-gilt.vercel.app/mcp
```

OAuth client id:

```text
chatgpt
```

Redirect URI allowed by the broker:

```text
https://chatgpt.com/connector_platform_oauth_redirect
https://chatgpt.com/connector/oauth/...
```

Scopes:

```text
profile.read orders.read offline
```

## Storage

Use Upstash Redis on Vercel. In-memory storage exists only for local development; the server refuses to use it when `VERCEL` is set, because serverless instances are recycled constantly and sessions would silently disappear.

Stored values:

- authorization code payloads
- opaque access token sessions
- opaque refresh token sessions
- Medusa customer JWTs

The tokens are stored under SHA-256 hashes of the opaque token values.
