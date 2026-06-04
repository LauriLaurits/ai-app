# Vercel Deployment

This repo can run on Vercel Functions through the files in `/api`.

## Routes

`vercel.json` rewrites:

- `/` -> `/api`
- `/mcp` -> `/api/mcp`
- `/.well-known/oauth-protected-resource` -> `/api/oauth-protected-resource`

Use this MCP URL in ChatGPT:

```text
https://your-project.vercel.app/mcp
```

## Demo Environment

Use this before real OAuth and Apotheka APIs exist:

```text
AUTH_MODE=demo
SHOP_ADAPTER=mock
PUBLIC_BASE_URL=https://your-project.vercel.app
```

Demo auth exposes only mock data. The server rejects demo auth when `SHOP_ADAPTER` is anything except `mock`.

## Deploy

From this folder:

```bash
npx vercel
npx vercel --prod
```

The first command links the local folder to a Vercel project. The second publishes the production deployment.

If using the Vercel dashboard, import the GitHub repo/folder and use the same environment variables.

After the production URL is known, set:

```text
PUBLIC_BASE_URL=https://your-project.vercel.app
```

Then redeploy so the OAuth protected resource metadata advertises the final URL.

## ChatGPT Test

In ChatGPT developer mode, create a connector with:

```text
https://your-project.vercel.app/mcp
```

With `AUTH_MODE=demo`, the mock order tools can run without OAuth.

## Real Environment

Use this once OAuth exists:

```text
AUTH_MODE=jwt
SHOP_ADAPTER=apotheka
PUBLIC_BASE_URL=https://your-project.vercel.app
OAUTH_ISSUER=https://auth.yourcompany.example
OAUTH_AUDIENCE=https://your-project.vercel.app
OAUTH_JWKS_URL=https://auth.yourcompany.example/.well-known/jwks.json
```

## Broker Environment

Use this when `ai-app` itself brokers ChatGPT OAuth and Medusa customer login:

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

Upstash Redis is required for broker mode on Vercel because authorization codes and access tokens must survive across serverless invocations.
