# Apotheka Integration Checklist

When the Apotheka repo or API documentation is available, collect these details:

- login/SSO provider and OAuth support
- user id mapping between auth and webshop customer
- customer profile endpoint
- order listing endpoint
- order details endpoint
- product item fields allowed to expose to ChatGPT
- delivery/tracking endpoint, if available
- allowed scopes and consent text
- staging credentials and test accounts
- privacy/legal rules for pharmacy-related order data

## Preferred Integration

Use OAuth for ChatGPT and call Apotheka APIs from the MCP server with server-side credentials or delegated user tokens.

Do not ask ChatGPT to collect webshop usernames or passwords. Do not scrape the browser UI unless no API exists and the business explicitly accepts that risk.

## Medusa Staging Adapter

The repo also supports `SHOP_ADAPTER=medusa` for a staging-only demo against Medusa v2 store APIs.

Required env:

```text
AUTH_MODE=demo
SHOP_ADAPTER=medusa
MEDUSA_BASE_URL=https://dev-medusa-ee.wolfgrouppartner.com
MEDUSA_PUBLISHABLE_KEY=pk_...
MEDUSA_CUSTOMER_EMAIL=...
MEDUSA_CUSTOMER_PASSWORD=...
```

The adapter logs in through `/auth/customer/emailpass`, caches the returned customer JWT for a short time, then calls `/store/customers/me`, `/store/orders`, and `/store/orders/:id` with the bearer token and publishable key.

Do not use this shared-credential flow for production ChatGPT users. Production needs OAuth/OIDC or an auth broker.

## OAuth Broker Mode

`AUTH_MODE=broker` keeps the auth broker inside this MCP app:

```text
ChatGPT -> /oauth/authorize -> ai-app login page -> Medusa emailpass auth
```

The user still enters normal webshop email/password, but only on the app's login page. ChatGPT receives an opaque OAuth access token, not the Medusa password or Medusa JWT.

Broker mode needs server-side storage such as Upstash Redis.
