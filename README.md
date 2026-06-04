# Webshop ChatGPT MCP

Standalone MCP server starter for a ChatGPT app that can authenticate a webshop user and read their orders.

This project intentionally works before the Apotheka repo is available. It ships with a mock shop adapter and the same MCP tool contracts we can later connect to Apotheka APIs.

## What Is Included

- `/mcp` streamable HTTP MCP endpoint for ChatGPT.
- OAuth protected resource metadata at `/.well-known/oauth-protected-resource`.
- Read-only MCP tools:
  - `get_current_customer`
  - `list_orders`
  - `get_order_details`
- Mock auth mode for local development.
- JWT verification mode for staging/production.
- Structured request and tool logging.
- Optional OpenObserve ingestion.

## Run Locally

```bash
cp .env.example .env
npm install
npm run dev
```

Local MCP endpoint:

```text
http://localhost:8787/mcp
```

Health check:

```text
http://localhost:8787/
```

OAuth protected resource metadata:

```text
http://localhost:8787/.well-known/oauth-protected-resource
```

## Test With MCP Inspector

```bash
npm run inspect
```

For mock auth, send this bearer token:

```text
Authorization: Bearer dev-token
```

## Deploy Demo To Vercel

The project includes Vercel function entrypoints and rewrites, so the public MCP URL will be:

```text
https://your-project.vercel.app/mcp
```

Deploy options:

```bash
npx vercel
npx vercel --prod
```

Or import this folder as a Vercel project through the Vercel dashboard.

For a ChatGPT demo before real OAuth exists, set these Vercel environment variables:

```text
AUTH_MODE=demo
SHOP_ADAPTER=mock
PUBLIC_BASE_URL=https://your-project.vercel.app
```

`AUTH_MODE=demo` intentionally returns the mock demo user without a bearer token. The code blocks demo auth when `SHOP_ADAPTER` is not `mock`, so it cannot be used with a real Apotheka adapter by accident.

For a staging Medusa order demo, use a dedicated test customer and set:

```text
AUTH_MODE=demo
SHOP_ADAPTER=medusa
MEDUSA_BASE_URL=https://dev-medusa-ee.wolfgrouppartner.com
MEDUSA_PUBLISHABLE_KEY=pk_...
MEDUSA_CUSTOMER_EMAIL=customer@example.com
MEDUSA_CUSTOMER_PASSWORD=<set only in Vercel env>
```

This is only for staging. Production should use OAuth/OIDC instead of shared customer credentials.

For per-user Medusa login through ChatGPT, use the OAuth broker mode:

```text
AUTH_MODE=broker
SHOP_ADAPTER=medusa
PUBLIC_BASE_URL=https://your-project.vercel.app
MEDUSA_BASE_URL=https://dev-medusa-ee.wolfgrouppartner.com
MEDUSA_PUBLISHABLE_KEY=pk_...
OAUTH_BROKER_CLIENT_ID=chatgpt
OAUTH_BROKER_REDIRECT_URIS=https://chatgpt.com/connector_platform_oauth_redirect
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

See [docs/oauth-broker.md](docs/oauth-broker.md).

After deployment, add this URL in ChatGPT developer mode:

```text
https://your-project.vercel.app/mcp
```

If you deploy with the CLI, update `PUBLIC_BASE_URL` to the final production URL after Vercel gives it to you, then redeploy. ChatGPT uses that metadata during connector setup.

## Production Notes

- Put the MCP server behind HTTPS.
- Set `AUTH_MODE=jwt`.
- Set `PUBLIC_BASE_URL` to the canonical MCP server origin, for example `https://mcp.yourcompany.example`.
- Set `OAUTH_ISSUER`, `OAUTH_AUDIENCE`, and `OAUTH_JWKS_URL`.
- Configure the authorization server to echo the OAuth `resource` parameter into the access token audience.
- Replace the mock shop adapter with a real Apotheka/webshop API adapter.
- Keep V1 tools read-only until auth, logging, and access control are proven.

## OpenObserve

Set:

```text
OPENOBSERVE_INGEST_URL=https://openobserve.example.com/api/default/mcp_logs/_json
OPENOBSERVE_AUTH_HEADER=Basic ...
```

The server logs request ids, tool names, user id hashes, status, latency, and upstream placeholders. It redacts tokens, passwords, authorization headers, secrets, and card-like fields.

On Vercel, OpenObserve delivery uses `waitUntil()` so log shipping can complete after the MCP response is sent.
