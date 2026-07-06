# Cart & Checkout-Handoff Tools — Design

Date: 2026-07-03
Status: approved (design discussion in chat)

## Goal

Let a ChatGPT user build a shopping cart in conversation and hand off to the
storefront to pay. Payment never happens in chat. Enables flows like
"reorder what I bought last week, but 25% less of everything."

## Constraints

- Medusa backend cannot change; everything uses the existing store API with
  the customer's token.
- Existing read-only tools keep working with read-only scopes.
- Write tools need explicit confirmation semantics (CLAUDE.md rule).
- No payment, no card data, no order completion in chat.

## Decisions

### New tools (4)

| Tool | Scope | Behavior |
|---|---|---|
| `add_to_cart` | `cart.write` | Add `variantId` + `quantity`. Creates the customer's cart on first use (`POST /store/carts` with customer token), reuses the active cart afterwards. Returns the full resulting cart. |
| `view_cart` | `cart.read` | Returns the active cart: items, quantities, unit/line totals, cart total. Empty cart object (not an error) when none exists. |
| `update_cart_item` | `cart.write` | Set a line item's quantity; `0` removes the line. Returns the full resulting cart. |
| `get_checkout_link` | `cart.read` | Returns the storefront handoff URL for the active cart, built from `CHECKOUT_URL_TEMPLATE`. |

Each tool follows the existing pattern: schema in `src/tools/schemas.ts`, one
~25-line file per tool calling `runTool`, registered in `src/tools/index.ts`,
wiring test in `test/tools.test.ts`.

### Scopes

Add `cart.read` and `cart.write` to `config.scopes`. Update:

- `src/oauth/validation.ts` — include in known scopes and defaults
- consent/login page — list the new scopes
- OAuth metadata + protected-resource metadata (`scopes_supported`)
- `tokenVerifier.ts` mock/demo paths — grant all scopes

Existing tokens without the new scopes hit the standard scope challenge and
ChatGPT re-authorizes.

### Confirmation semantics

- Write tools carry MCP annotations `readOnlyHint: false`,
  `idempotentHint: false` so the client shows confirm-before-run UI.
- Every mutating tool returns the complete resulting cart (all prices through
  `src/money.ts`), so the user sees the effect of every change.
- `get_checkout_link` returns only a URL; payment stays on the storefront.

### Cart state

- `BrokerSession` gains optional `cartId`. `add_to_cart` reuses it when the
  cart is still open; on Medusa 404/409 (expired/completed) it transparently
  creates a fresh cart and updates the session.
- Mock/demo auth modes keep an in-memory `cartId` per customer inside the
  mock adapter so tests and demo work without Medusa or Upstash.

### Adapter surface

`ShopAdapter` gains:

```ts
getCart(identity: Identity): Promise<Cart | null>;
addToCart(identity: Identity, item: CartItemInput): Promise<Cart>;
updateCartItem(identity: Identity, lineItemId: string, quantity: number): Promise<Cart>;
```

New domain types in `src/types.ts`: `Cart`, `CartLine`, `CartItemInput`.
Raw Medusa cart shapes stay in `medusaMappers.ts` (pure functions, unit
tested). Implemented in `medusaAdapter.ts` and `mockShopAdapter.ts`.

### Reorder support (order history → cart)

`OrderItem` currently exposes only `sku`/`name`/`quantity`/`unitPrice`.
Add nullable `variantId` and `productId`, mapped from Medusa order line
items, so the model can map history to `add_to_cart` calls. No dedicated
reorder tool — ChatGPT composes `list_orders` → `get_order_details` →
`add_to_cart`.

### Checkout handoff

- New env `CHECKOUT_URL_TEMPLATE`, e.g.
  `https://shop.example/checkout?cart={cartId}`. `{cartId}` is replaced with
  the active cart ID.
- Unset ⇒ `get_checkout_link` returns a clear "checkout handoff not
  configured" tool message (not an error); demo mode keeps working.
- **Prerequisite outside this repo:** the storefront must accept a cart ID
  (query param or handoff route), adopt it (set its cart cookie), and open
  checkout. In the Medusa Next.js starter this is a small route. An
  already-open storefront tab does not auto-update; the user clicks the link.

## Error handling

- Expired/completed cart ⇒ fresh cart on next `add_to_cart`; `view_cart`
  with no cart ⇒ empty cart response.
- Invalid variant / out-of-stock ⇒ friendly tool error via existing `runTool`
  error mapping; raw Medusa errors never reach the client.
- Missing `cart.write` scope ⇒ standard scope challenge (re-auth).

## Testing (TDD)

- Mapper unit tests: Medusa cart JSON → `Cart` (money via `money.ts`,
  JPY/BHD cases included).
- Adapter tests against stubbed `fetch`: create-on-first-add, reuse, 404/409
  recovery, quantity update, remove-at-zero.
- Wiring tests through the in-memory MCP client: all four tools, scope
  enforcement (read token cannot call `add_to_cart`), handoff-unconfigured
  message.
- OAuth tests: new scopes in metadata, defaults, and consent.

## Out of scope (v1)

- Shipping address / delivery method selection in chat.
- Order completion (`carts/:id/complete`) — never in chat.
- Storefront auto-discovery of the chat-built cart for logged-in sessions.
- Promotions/discount codes.
