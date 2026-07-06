# ChatGPT Apps SDK Widgets — Design

Date: 2026-07-06
Status: approved (design discussion in chat)

## Goal

Replace raw JSON tool output in ChatGPT with rendered, interactive views: a
product card grid with Add-to-cart buttons, and a cart view with quantity
steppers and a checkout button. "Store look" inside the conversation.

## Constraints

- Medusa backend unchanged; no new backend capabilities.
- Tool response data (`structuredContent`) unchanged — widgets are a pure
  presentation layer. Non-widget MCP clients keep working identically.
- No frontend build pipeline in v1: widgets are self-contained HTML/CSS/JS
  templates, no React, no bundler, no new npm dependencies.
- Widgets run in ChatGPT's sandboxed iframe (Skybridge) and talk to the host
  only via the `window.openai` bridge.

## v1 scope

Two widgets. Orders/tracking widgets are explicitly deferred to v2.

| Widget | Resource URI | Attached to tools |
|---|---|---|
| Product grid | `ui://widget/product-grid.html` | `search_products`, `get_product` |
| Cart | `ui://widget/cart.html` | `view_cart`, `add_to_cart`, `update_cart_item` |

`get_checkout_link` gets no widget; the cart widget calls it on demand.

## Mechanism (Apps SDK)

- Each widget is an MCP **resource** with MIME type `text/html+skybridge`,
  registered by the server. ChatGPT fetches it once and renders it in a
  sandboxed iframe.
- Each attached tool's descriptor carries
  `_meta["openai/outputTemplate"] = "<resource URI>"`.
- The widget reads the tool's `structuredContent` from
  `window.openai.toolOutput` and re-renders on the `openai:set_globals`
  event.
- Buttons call tools through `window.openai.callTool(name, args)`:
  - Product card "Add to cart" → `add_to_cart { variantId, quantity: 1 }`
  - Cart stepper − / + → `update_cart_item { lineItemId, quantity }`
  - Cart remove → `update_cart_item { lineItemId, quantity: 0 }`
  - Cart "Checkout" → `get_checkout_link {}`, then open `checkoutUrl`
    (via the bridge's external-link affordance) or show the returned
    message when the handoff is not configured.
- After a mutating `callTool`, the widget re-renders from the call's
  returned cart (every cart tool already returns the full resulting cart).

## Repo layout

```
src/widgets/
  productGridWidget.ts   # exports the HTML template string + resource URI
  cartWidget.ts          # exports the HTML template string + resource URI
  index.ts               # registerWidgets(server): registers both resources
```

- Tool files change by one line each: add the `_meta` output-template key to
  the descriptor (constant imported from `src/widgets/`).
- `src/tools/index.ts` calls `registerWidgets(server)`.
- Templates aim small; if a template's JS grows past ~150 lines it is split
  into its own module and interpolated, keeping per-file responsibility.

## Styling

- Neutral, clean, no storefront branding in v1 (branding = later, via config).
- Light/dark aware: respects ChatGPT's theme globals and
  `prefers-color-scheme`.
- Inline CSS/JS only; no external stylesheets, fonts, or scripts.
- Product thumbnails are external images (Medusa/CDN). Their host(s) must be
  declared in the widget CSP allowlist: `_meta["openai/widgetCSP"]` with
  resource domains from a new env var `WIDGET_IMAGE_DOMAINS`
  (comma-separated, e.g. `https://cdn.yourshop.example`). Empty ⇒ widgets
  render without images (placeholder block), nothing breaks.

## Error and edge handling

- Empty search result → "No products found" state in the widget.
- Empty/absent cart → friendly empty-cart state with hint to search products.
- `callTool` failure from a button → inline, dismissible error message in the
  widget; never a dead button.
- Checkout not configured → the widget shows the tool's returned message.
- Clients that ignore `outputTemplate` (other MCP hosts, older ChatGPT) →
  existing text/JSON output, unchanged behavior.

## Testing

- Wiring tests via the in-memory MCP client:
  - `resources/list` contains both widget URIs with MIME
    `text/html+skybridge`; `resources/read` returns non-empty HTML.
  - Each attached tool's descriptor advertises the correct
    `_meta["openai/outputTemplate"]`.
- Template sanity unit tests: HTML contains `window.openai` bridge usage,
  no external `<script src>`/`<link>` tags, and handles the empty-state
  branch.
- Rendering and interactions are verified manually in ChatGPT developer mode
  (not automatable from CI); a manual test checklist ships in the plan's
  final task.

## Out of scope (v1)

- Order history / order details / tracking widgets (v2).
- Storefront branding (colors, logo) and image galleries.
- React/bundler toolchain.
- Any change to tool input/output schemas or backend behavior.

## Known follow-up (unrelated to widgets, discovered during live cart test)

Real-Medusa cart shows `total` (7.353, tax-exclusive, unrounded fractional
minor units) inconsistent with `unitPrice` (8.17, tax-inclusive). Needs a
money-field pass in `cartToDomain` (pick tax-consistent fields, round to the
currency exponent). Tracked separately from this spec.
