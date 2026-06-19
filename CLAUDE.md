# CLAUDE.md

Guidance for working in this repo. Read before making changes.

## What this is

A TypeScript MCP server that lets ChatGPT read a webshop customer's orders and
browse the catalog, backed by a **Medusa** store. Deployed on Vercel as
serverless functions (`api/*.ts`) and runnable as a standalone Node server
(`src/server.ts`). Auth is an OAuth broker that logs Medusa customers in and
hands ChatGPT opaque tokens.

**Constraint that drives design:** the Medusa backend cannot be changed. Every
capability must be built on Medusa's existing store API, using the customer's
token (per-customer reads) or the publishable key (public catalog reads).

## Commands

```bash
npm run dev        # local server with watch (tsx)
npm run typecheck  # strict tsc, no emit — must pass
npm test           # vitest — must pass
npm run build      # compile to dist/ (Docker / npm start)
```

CI (`.github/workflows/ci.yml`) runs typecheck + test + build on every push.

## Non-negotiable requirements

These are hard rules for this codebase. Do not regress them.

### Clean, maintainable code — no spaghetti
- **Small files, one responsibility.** Aim for < ~150 lines per file. If a file
  grows past that, split it (see the `src/tools/` and Medusa adapter layout for
  the pattern). No god-files, no 300-line functions.
- **Small functions.** A function does one thing. Extract helpers instead of
  nesting or branching deeply.
- **Separation of concerns:**
  - HTTP/transport wiring → `src/httpHandlers.ts`, `src/server.ts`, `api/*`
  - OAuth broker → `src/oauth/*`
  - Auth/identity → `src/auth/*`
  - Tool definitions → `src/tools/*` (one file per tool)
  - Shop access → `src/shop/adapters/*` (Medusa I/O) with **pure mapping** in
    `medusaMappers.ts` (no I/O, easily unit-tested)
  - Money normalization → `src/money.ts` (single source of truth)
- **No duplication.** Shared logic lives in one place (e.g. `runTool` in
  `src/tools/shared.ts` owns scope checks, logging, payload capture, error
  mapping; tool files only implement their `run`).
- **No dead code / no unused metadata.** If the SDK or runtime doesn't consume
  it, don't add it.

### TypeScript
- `strict` is on (plus `noUncheckedIndexedAccess`). Keep it green; don't add
  `any` or blanket `as` casts to silence the compiler — model the types.
- Domain types live in `src/types.ts`. Adapters return domain types, never raw
  Medusa shapes. Raw Medusa shapes stay inside `medusaMappers.ts`.

### Tests (TDD)
- Write the failing test first, watch it fail, then implement. See
  `test/*.test.ts`.
- Pure logic (mappers, money) gets unit tests; tools get wiring tests through a
  real in-memory MCP client; adapters get tests against a stubbed `fetch`.
- New tool or adapter method ⇒ new tests. Keep the suite green before commit.

### Security & privacy
- Tools are **read-only**. Any future write/action tool needs explicit
  confirmation semantics and must not take payment in chat.
- Never log secrets. The logger redacts credential-like keys; payload logging
  (`LOG_PAYLOAD_MODE`) defaults to `error` and captures customer PII only when
  set to `all` — keep that default.
- The OAuth `/oauth/login` endpoint proxies real Medusa passwords: it is rate
  limited and must stay that way.

## Adding a new tool (the pattern)

1. Add the domain types to `src/types.ts` and the `ShopAdapter` method.
2. Implement it in each adapter (`medusaAdapter.ts` + mappers, `mockShopAdapter.ts`).
3. Add unit tests for the mapper and adapter.
4. Add a schema to `src/tools/schemas.ts`.
5. Create `src/tools/<tool>.ts` exporting `register<Tool>(server, ctx)` that
   calls `runTool(...)`. Keep it ~25 lines.
6. Register it in `src/tools/index.ts`.
7. Add a wiring test in `test/tools.test.ts`.

## Money

Medusa returns amounts in **minor units** (29731 = €297.31). Always convert
through `src/money.ts` (`money()` / `toMajorUnits()`), which is currency-aware
(EUR/USD = 2 decimals, JPY = 0, BHD = 3). Never pass raw Medusa amounts to a
tool response.

## Auth modes (`AUTH_MODE`)

`mock` (local bearer), `demo` (no token, staging-safe adapters only), `broker`
(Medusa OAuth broker — production), `jwt` (external OIDC). See
`docs/oauth-broker.md`.
