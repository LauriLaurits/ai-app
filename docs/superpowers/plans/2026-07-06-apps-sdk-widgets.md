# Apps SDK Widgets (Product Grid + Cart) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ChatGPT renders a product card grid (with Add-to-cart) and an interactive cart view (quantity steppers, checkout button) instead of raw JSON, plus fix money rounding so fractional minor units display correctly.

**Architecture:** Widgets are self-contained vanilla HTML/CSS/JS templates served as MCP resources (`ui://widget/*.html`, MIME `text/html;profile=mcp-app`) from a new `src/widgets/` module. Tools reference their widget via `_meta` (`ui.resourceUri` + `openai/outputTemplate` compatibility alias). Widgets read `window.openai.toolOutput`, re-render on `openai:set_globals`, and mutate via `await window.openai.callTool(...)`. Tool response data is unchanged.

**Tech Stack:** TypeScript (strict), @modelcontextprotocol/sdk 1.29.0 (`registerResource`, `registerTool` `_meta`), vanilla JS widgets (no build step), vitest.

**Spec:** `docs/superpowers/specs/2026-07-06-apps-sdk-widgets-design.md`

## Global Constraints

- `npm run typecheck` and `npm test` must pass after every task. No `any`, no blanket `as` casts.
- TDD: failing test first, watch it fail, implement, watch it pass, commit.
- No new npm dependencies; widgets are vanilla JS with inline CSS — no external `<script src>`, `<link>`, fonts, or fetch calls.
- Tool response `structuredContent` shapes unchanged.
- Widget text content from shop data (titles etc.) must be HTML-escaped (product titles are external input).
- All money display through `Intl.NumberFormat` in widgets; all money values through `src/money.ts` on the server.
- Widget template files may exceed the ~150-line rule (they are HTML documents, not modules); their embedded JS must stay simple and declarative.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## Exact Apps SDK contract used (verified against developers.openai.com, July 2026)

- Resource: URI `ui://widget/<name>.html`, MIME `text/html;profile=mcp-app`.
- Resource `_meta`: `{ "openai/widgetDescription": string, "ui": { "prefersBorder": true, "csp": { "connectDomains": [], "resourceDomains": string[] } } }`.
- Tool `_meta`: `{ "ui": { "resourceUri": "<uri>" }, "openai/outputTemplate": "<uri>", "openai/toolInvocation/invoking": string, "openai/toolInvocation/invoked": string }`.
- Widget JS: `window.openai.toolOutput` (the tool's `structuredContent`), `window.addEventListener("openai:set_globals", ...)`, `await window.openai.callTool(name, args)` → `{ structuredContent, content }`, `window.openai.openExternal(url)`.

---

### Task 1: Money rounding to currency exponent

**Files:**
- Modify: `src/money.ts:37-41` (`toMajorUnits`)
- Test: `test/money.test.ts`

**Interfaces:**
- Produces: `toMajorUnits(amount, currency)` now rounds the major-unit result to the currency's exponent (2 for EUR, 0 for JPY, 3 for BHD). `money()` signature unchanged.

- [ ] **Step 1: Write the failing tests** — add to `test/money.test.ts`:

```ts
  it("rounds fractional minor units to the currency exponent", () => {
    expect(money(735.3, "eur")).toEqual({ amount: 7.35, currency: "EUR" });
    expect(money(735.5, "eur")).toEqual({ amount: 7.36, currency: "EUR" });
    expect(money(1500.6, "jpy")).toEqual({ amount: 1501, currency: "JPY" });
    expect(money(1234.4, "bhd")).toEqual({ amount: 1.234, currency: "BHD" });
  });

  it("keeps whole minor units exact", () => {
    expect(money(29731, "eur")).toEqual({ amount: 297.31, currency: "EUR" });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/money.test.ts`
Expected: FAIL — `money(735.3, "eur")` returns `7.3529999...`/`7.353`, not `7.35`.

- [ ] **Step 3: Implement** — replace `toMajorUnits` in `src/money.ts`:

```ts
export function toMajorUnits(amount: number, currency: string): number {
  const exponent = minorUnitExponent(currency);
  const factor = 10 ** exponent;
  const major = amount / factor;
  // Medusa can produce fractional minor units (tax/discount math); round the
  // major-unit value to the currency's exponent so 735.3 cents → €7.35.
  return Math.round(major * factor) / factor;
}
```

- [ ] **Step 4: Verify**

Run: `npx vitest run test/money.test.ts` → PASS.
Run: `npm run typecheck && npm test` → all green (existing mapper/adapter tests use whole minor units and must be unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/money.ts test/money.test.ts
git commit -m "Round money to currency exponent for fractional minor units"
```

---

### Task 2: Widget config + registration infrastructure

**Files:**
- Modify: `src/types.ts` (AppConfig gains `widgets`)
- Modify: `src/config.ts`
- Modify: `test/helpers.ts` (makeConfig base)
- Modify: `.env.example`
- Create: `src/widgets/registry.ts`
- Test: `test/widgets.test.ts` (create)

**Interfaces:**
- Produces:
  - `config.widgets.imageDomains: string[]` from env `WIDGET_IMAGE_DOMAINS` (comma-separated, trimmed, empty entries dropped; unset ⇒ `[]`).
  - From `src/widgets/registry.ts`:

```ts
export interface WidgetDefinition {
  name: string;        // resource registration name
  uri: string;         // ui://widget/<name>.html
  description: string; // openai/widgetDescription
  html: string;        // self-contained template
}

export const WIDGET_MIME_TYPE = "text/html;profile=mcp-app";

export function widgetToolMeta(uri: string, invoking: string, invoked: string): Record<string, unknown>;
export function registerWidgetResources(
  server: McpServer,
  config: AppConfig,
  widgets: WidgetDefinition[]
): void;
```

  - `widgetToolMeta` returns `{ ui: { resourceUri: uri }, "openai/outputTemplate": uri, "openai/toolInvocation/invoking": invoking, "openai/toolInvocation/invoked": invoked }`.
  - `registerWidgetResources` calls `server.registerResource(w.name, w.uri, { mimeType: WIDGET_MIME_TYPE, _meta: resourceMeta }, cb)` for each widget, where `resourceMeta` is `{ "openai/widgetDescription": w.description, ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: config.widgets.imageDomains } } }` and the callback returns `{ contents: [{ uri: w.uri, mimeType: WIDGET_MIME_TYPE, text: w.html, _meta: resourceMeta }] }`.

- [ ] **Step 1: Write the failing test** — create `test/widgets.test.ts`:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import {
  registerWidgetResources,
  widgetToolMeta,
  WIDGET_MIME_TYPE,
  type WidgetDefinition,
} from "../src/widgets/registry.js";
import { makeConfig } from "./helpers.js";

const sampleWidget: WidgetDefinition = {
  name: "sample-widget",
  uri: "ui://widget/sample.html",
  description: "Sample widget",
  html: "<!doctype html><html><body>hi</body></html>",
};

async function withResourceClient<T>(
  widgets: WidgetDefinition[],
  imageDomains: string[],
  fn: (client: Client) => Promise<T>
): Promise<T> {
  const server = new McpServer({ name: "widget-test", version: "0.0.1" });
  registerWidgetResources(
    server,
    makeConfig({ widgets: { imageDomains } }),
    widgets
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return await fn(client);
  } finally {
    await client.close();
    await server.close();
  }
}

describe("widget registry", () => {
  it("serves widget resources with the Apps SDK mime type", async () => {
    const contents = await withResourceClient([sampleWidget], [], async (client) => {
      const list = await client.listResources();
      expect(list.resources.map((r) => r.uri)).toContain("ui://widget/sample.html");
      const read = await client.readResource({ uri: "ui://widget/sample.html" });
      return read.contents;
    });

    expect(contents[0]?.mimeType).toBe(WIDGET_MIME_TYPE);
    expect(String(contents[0]?.text)).toContain("<!doctype html>");
  });

  it("declares image domains in the widget CSP", async () => {
    const contents = await withResourceClient(
      [sampleWidget],
      ["https://cdn.shop.test"],
      async (client) => (await client.readResource({ uri: "ui://widget/sample.html" })).contents
    );

    const meta = contents[0]?._meta as {
      ui?: { csp?: { resourceDomains?: string[] } };
    };
    expect(meta?.ui?.csp?.resourceDomains).toEqual(["https://cdn.shop.test"]);
  });

  it("builds tool meta with template uri and status texts", () => {
    const meta = widgetToolMeta("ui://widget/sample.html", "Working…", "Done");
    expect(meta["openai/outputTemplate"]).toBe("ui://widget/sample.html");
    expect((meta.ui as { resourceUri: string }).resourceUri).toBe("ui://widget/sample.html");
    expect(meta["openai/toolInvocation/invoking"]).toBe("Working…");
    expect(meta["openai/toolInvocation/invoked"]).toBe("Done");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/widgets.test.ts`
Expected: FAIL — module `src/widgets/registry.js` not found (and `widgets` missing from AppConfig).

- [ ] **Step 3: Implement config.** In `src/types.ts` AppConfig, after `checkout`:

```ts
  widgets: {
    imageDomains: string[];
  };
```

In `src/config.ts`, after the `checkout` section:

```ts
  widgets: {
    // Hosts product thumbnails may load from inside ChatGPT widgets (CSP
    // allowlist). Comma-separated origins; empty disables remote images.
    imageDomains: (process.env.WIDGET_IMAGE_DOMAINS ?? "")
      .split(",")
      .map((domain) => domain.trim())
      .filter(Boolean),
  },
```

In `test/helpers.ts` makeConfig base, after `checkout: { urlTemplate: "" },`:

```ts
    widgets: { imageDomains: [] },
```

In `.env.example`, after the `CHECKOUT_URL_TEMPLATE` block:

```
# Origins ChatGPT widgets may load product images from (CSP allowlist),
# e.g. https://cdn.yourshop.example. Comma-separated. Empty = no remote
# images in widgets (placeholders shown instead).
WIDGET_IMAGE_DOMAINS=
```

- [ ] **Step 4: Implement the registry** — create `src/widgets/registry.ts`:

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "../types.js";

export interface WidgetDefinition {
  name: string;
  uri: string;
  description: string;
  html: string;
}

export const WIDGET_MIME_TYPE = "text/html;profile=mcp-app";

export function widgetToolMeta(
  uri: string,
  invoking: string,
  invoked: string
): Record<string, unknown> {
  return {
    ui: { resourceUri: uri },
    "openai/outputTemplate": uri,
    "openai/toolInvocation/invoking": invoking,
    "openai/toolInvocation/invoked": invoked,
  };
}

function resourceMeta(config: AppConfig, widget: WidgetDefinition): Record<string, unknown> {
  return {
    "openai/widgetDescription": widget.description,
    ui: {
      prefersBorder: true,
      csp: {
        connectDomains: [],
        resourceDomains: config.widgets.imageDomains,
      },
    },
  };
}

export function registerWidgetResources(
  server: McpServer,
  config: AppConfig,
  widgets: WidgetDefinition[]
): void {
  for (const widget of widgets) {
    const meta = resourceMeta(config, widget);
    server.registerResource(
      widget.name,
      widget.uri,
      { mimeType: WIDGET_MIME_TYPE, _meta: meta },
      async () => ({
        contents: [
          { uri: widget.uri, mimeType: WIDGET_MIME_TYPE, text: widget.html, _meta: meta },
        ],
      })
    );
  }
}
```

- [ ] **Step 5: Verify**

Run: `npx vitest run test/widgets.test.ts` → PASS.
Run: `npm run typecheck && npm test` → green.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/config.ts test/helpers.ts .env.example src/widgets/registry.ts test/widgets.test.ts
git commit -m "Add widget registry and WIDGET_IMAGE_DOMAINS config"
```

---

### Task 3: Product grid widget template

**Files:**
- Create: `src/widgets/productGridWidget.ts`
- Test: `test/widgets.test.ts`

**Interfaces:**
- Consumes: `WidgetDefinition` from Task 2.
- Produces: `export const productGridWidget: WidgetDefinition` with `uri = "ui://widget/product-grid.html"`, `name = "product-grid"`.
- Widget data contract (existing tool outputs, unchanged): `search_products` → `{ products: ProductSummary[], count }`; `get_product` → `{ product: ProductDetails | null }` where ProductDetails adds `variants: [{ id, title, sku, price, inStock }]`.
- Add-to-cart flow inside the widget: card button → if the payload already has `variants` (get_product), use them; else `callTool("get_product", { productId })` → one in-stock variant ⇒ `callTool("add_to_cart", { variantId, quantity: 1 })`; multiple ⇒ inline variant buttons; result cart shown as a confirmation line.

- [ ] **Step 1: Write the failing tests** — add to `test/widgets.test.ts`:

```ts
import { productGridWidget } from "../src/widgets/productGridWidget.js";

describe("product grid widget template", () => {
  it("is a self-contained document using the openai bridge", () => {
    expect(productGridWidget.uri).toBe("ui://widget/product-grid.html");
    expect(productGridWidget.html).toContain("window.openai");
    expect(productGridWidget.html).toContain("openai:set_globals");
    expect(productGridWidget.html).toContain("add_to_cart");
    expect(productGridWidget.html).not.toMatch(/<script[^>]+src=/i);
    expect(productGridWidget.html).not.toMatch(/<link[^>]/i);
  });

  it("escapes shop-provided text before rendering", () => {
    expect(productGridWidget.html).toContain("function esc(");
  });

  it("handles the empty state", () => {
    expect(productGridWidget.html).toContain("No products found");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/widgets.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/widgets/productGridWidget.ts`. The HTML is one exported template literal; its embedded JS deliberately uses no backticks or `${}` so the outer template literal stays clean:

```ts
import type { WidgetDefinition } from "./registry.js";

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root { --fg:#1a1a1a; --bg:transparent; --muted:#6b7280; --card:#ffffff; --border:#e5e7eb; --accent:#0a7d33; --err:#b91c1c; }
  @media (prefers-color-scheme: dark) {
    :root { --fg:#ececec; --muted:#9ca3af; --card:#1f2123; --border:#3a3d41; --accent:#34c268; --err:#f87171; }
  }
  * { box-sizing: border-box; margin: 0; }
  body { font: 14px/1.45 system-ui, -apple-system, sans-serif; color: var(--fg); background: var(--bg); padding: 4px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 6px; }
  .thumb { width: 100%; aspect-ratio: 1; border-radius: 8px; background: var(--border); object-fit: cover; display: block; }
  .thumb.ph { display: flex; align-items: center; justify-content: center; color: var(--muted); font-size: 22px; }
  .title { font-weight: 600; min-height: 2.6em; }
  .price { font-size: 15px; }
  .stock { font-size: 12px; color: var(--accent); }
  .stock.out { color: var(--muted); }
  .btn { border: 1px solid var(--border); background: var(--card); color: var(--fg); border-radius: 8px; padding: 7px 10px; cursor: pointer; font-weight: 600; }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .btn:disabled { opacity: .55; cursor: default; }
  .note { font-size: 12px; color: var(--muted); }
  .note.ok { color: var(--accent); }
  .note.err { color: var(--err); }
  .empty { padding: 24px; text-align: center; color: var(--muted); }
  .variants { display: flex; flex-direction: column; gap: 4px; }
</style>
</head>
<body>
<div id="root"></div>
<script>
(function () {
  var root = document.getElementById("root");

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function fmt(price) {
    if (!price) return "";
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: price.currency }).format(price.amount);
    } catch (e) {
      return price.amount + " " + price.currency;
    }
  }

  function note(card, cls, text) {
    var el = card.querySelector(".note");
    el.className = "note " + cls;
    el.textContent = text;
  }

  function addVariant(card, variantId) {
    var btns = card.querySelectorAll("button");
    btns.forEach(function (b) { b.disabled = true; });
    note(card, "", "Adding…");
    window.openai.callTool("add_to_cart", { variantId: variantId, quantity: 1 }).then(function (res) {
      var cart = res && res.structuredContent && res.structuredContent.cart;
      if (cart) {
        note(card, "ok", "In cart — total " + fmt(cart.total));
      } else {
        note(card, "err", "Could not add to cart.");
      }
      btns.forEach(function (b) { b.disabled = false; });
    }).catch(function () {
      note(card, "err", "Could not add to cart.");
      btns.forEach(function (b) { b.disabled = false; });
    });
  }

  function showVariants(card, variants) {
    var box = card.querySelector(".variants");
    box.innerHTML = "";
    variants.forEach(function (v) {
      var b = document.createElement("button");
      b.className = "btn";
      b.textContent = v.title + (v.price ? " — " + fmt(v.price) : "");
      b.disabled = !v.inStock;
      b.addEventListener("click", function () { addVariant(card, v.id); });
      box.appendChild(b);
    });
  }

  function onAdd(card, product) {
    if (product.variants && product.variants.length) {
      pick(card, product.variants);
      return;
    }
    note(card, "", "Loading options…");
    window.openai.callTool("get_product", { productId: product.id }).then(function (res) {
      var full = res && res.structuredContent && res.structuredContent.product;
      pick(card, (full && full.variants) || []);
    }).catch(function () {
      note(card, "err", "Could not load product options.");
    });
  }

  function pick(card, variants) {
    var inStock = variants.filter(function (v) { return v.inStock; });
    if (inStock.length === 0) {
      note(card, "err", "Out of stock.");
    } else if (inStock.length === 1) {
      addVariant(card, inStock[0].id);
    } else {
      note(card, "", "Choose an option:");
      showVariants(card, inStock);
    }
  }

  function card(product) {
    var el = document.createElement("div");
    el.className = "card";
    var img = product.thumbnail
      ? '<img class="thumb" src="' + esc(product.thumbnail) + '" alt="">'
      : '<div class="thumb ph">🛍️</div>';
    el.innerHTML =
      img +
      '<div class="title">' + esc(product.title) + "</div>" +
      '<div class="price">' + esc(fmt(product.price)) + "</div>" +
      '<div class="stock' + (product.inStock ? "" : " out") + '">' +
      (product.inStock ? "In stock" : "Out of stock") + "</div>" +
      '<button class="btn primary"' + (product.inStock ? "" : " disabled") + ">Add to cart</button>" +
      '<div class="variants"></div>' +
      '<div class="note"></div>';
    el.querySelector(".btn.primary").addEventListener("click", function () { onAdd(el, product); });
    return el;
  }

  function render() {
    var out = (window.openai && window.openai.toolOutput) || {};
    var products = out.products || (out.product ? [out.product] : []);
    root.innerHTML = "";
    if (!products.length) {
      var empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No products found.";
      root.appendChild(empty);
      return;
    }
    var grid = document.createElement("div");
    grid.className = "grid";
    products.forEach(function (p) { grid.appendChild(card(p)); });
    root.appendChild(grid);
  }

  window.addEventListener("openai:set_globals", render);
  render();
})();
</script>
</body>
</html>
`;

export const productGridWidget: WidgetDefinition = {
  name: "product-grid",
  uri: "ui://widget/product-grid.html",
  description:
    "Product cards with image, price, stock and an add-to-cart button for webshop catalog results.",
  html,
};
```

- [ ] **Step 4: Verify**

Run: `npx vitest run test/widgets.test.ts` → PASS.
Run: `npm run typecheck` → green.

- [ ] **Step 5: Commit**

```bash
git add src/widgets/productGridWidget.ts test/widgets.test.ts
git commit -m "Add product grid widget template"
```

---

### Task 4: Cart widget template

**Files:**
- Create: `src/widgets/cartWidget.ts`
- Test: `test/widgets.test.ts`

**Interfaces:**
- Consumes: `WidgetDefinition` from Task 2.
- Produces: `export const cartWidget: WidgetDefinition` with `uri = "ui://widget/cart.html"`, `name = "cart"`.
- Widget data contract (existing tool outputs, unchanged): `{ cart: { id, items: [{ id, title, quantity, unitPrice, lineTotal }], itemCount, total } | null }`.
- Interactions: − / + steppers and remove → `callTool("update_cart_item", { lineItemId, quantity })`, re-render from the returned cart; Checkout → `callTool("get_checkout_link", {})` then `window.openai.openExternal(checkoutUrl)` or show the returned message.

- [ ] **Step 1: Write the failing tests** — add to `test/widgets.test.ts`:

```ts
import { cartWidget } from "../src/widgets/cartWidget.js";

describe("cart widget template", () => {
  it("is a self-contained document wired to cart tools", () => {
    expect(cartWidget.uri).toBe("ui://widget/cart.html");
    expect(cartWidget.html).toContain("window.openai");
    expect(cartWidget.html).toContain("update_cart_item");
    expect(cartWidget.html).toContain("get_checkout_link");
    expect(cartWidget.html).toContain("openExternal");
    expect(cartWidget.html).not.toMatch(/<script[^>]+src=/i);
    expect(cartWidget.html).not.toMatch(/<link[^>]/i);
  });

  it("escapes shop-provided text and has an empty state", () => {
    expect(cartWidget.html).toContain("function esc(");
    expect(cartWidget.html).toContain("Your cart is empty");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/widgets.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/widgets/cartWidget.ts` (same no-backtick convention in embedded JS):

```ts
import type { WidgetDefinition } from "./registry.js";

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root { --fg:#1a1a1a; --muted:#6b7280; --card:#ffffff; --border:#e5e7eb; --accent:#0a7d33; --err:#b91c1c; }
  @media (prefers-color-scheme: dark) {
    :root { --fg:#ececec; --muted:#9ca3af; --card:#1f2123; --border:#3a3d41; --accent:#34c268; --err:#f87171; }
  }
  * { box-sizing: border-box; margin: 0; }
  body { font: 14px/1.45 system-ui, -apple-system, sans-serif; color: var(--fg); padding: 4px; }
  .cart { background: var(--card); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
  .row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--border); }
  .row .title { flex: 1; font-weight: 600; }
  .qty { display: flex; align-items: center; gap: 6px; }
  .qty button { width: 26px; height: 26px; border-radius: 6px; border: 1px solid var(--border); background: transparent; color: var(--fg); cursor: pointer; font-weight: 700; }
  .qty button:disabled { opacity: .5; cursor: default; }
  .lineTotal { min-width: 76px; text-align: right; font-variant-numeric: tabular-nums; }
  .remove { border: none; background: none; color: var(--muted); cursor: pointer; font-size: 16px; }
  .footer { display: flex; align-items: center; justify-content: space-between; padding: 12px; }
  .total { font-size: 16px; font-weight: 700; }
  .btn { border: 1px solid var(--accent); background: var(--accent); color: #fff; border-radius: 8px; padding: 8px 14px; cursor: pointer; font-weight: 600; }
  .btn:disabled { opacity: .55; cursor: default; }
  .note { padding: 0 12px 12px; font-size: 12px; color: var(--muted); }
  .note.err { color: var(--err); }
  .empty { padding: 28px; text-align: center; color: var(--muted); }
</style>
</head>
<body>
<div id="root"></div>
<script>
(function () {
  var root = document.getElementById("root");
  var busy = false;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function fmt(price) {
    if (!price) return "";
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: price.currency }).format(price.amount);
    } catch (e) {
      return price.amount + " " + price.currency;
    }
  }

  function setNote(cls, text) {
    var el = root.querySelector(".note");
    if (el) { el.className = "note " + cls; el.textContent = text; }
  }

  function update(lineItemId, quantity) {
    if (busy) return;
    busy = true;
    setNote("", "Updating…");
    window.openai.callTool("update_cart_item", { lineItemId: lineItemId, quantity: quantity }).then(function (res) {
      busy = false;
      var cart = res && res.structuredContent && res.structuredContent.cart;
      if (cart) { render(cart); } else { setNote("err", "Could not update the cart."); }
    }).catch(function () {
      busy = false;
      setNote("err", "Could not update the cart.");
    });
  }

  function checkout() {
    if (busy) return;
    busy = true;
    setNote("", "Getting checkout link…");
    window.openai.callTool("get_checkout_link", {}).then(function (res) {
      busy = false;
      var out = (res && res.structuredContent) || {};
      if (out.checkoutUrl) {
        window.openai.openExternal(out.checkoutUrl);
        setNote("", "Checkout opened in the webshop.");
      } else {
        setNote("err", out.message || "Checkout link is not available.");
      }
    }).catch(function () {
      busy = false;
      setNote("err", "Could not get the checkout link.");
    });
  }

  function row(line) {
    var el = document.createElement("div");
    el.className = "row";
    el.innerHTML =
      '<div class="title">' + esc(line.title) +
      ' <span style="color:var(--muted);font-weight:400">' + esc(fmt(line.unitPrice)) + "</span></div>" +
      '<div class="qty">' +
      '<button data-a="dec">−</button><span>' + esc(line.quantity) + "</span>" +
      '<button data-a="inc">+</button></div>' +
      '<div class="lineTotal">' + esc(fmt(line.lineTotal)) + "</div>" +
      '<button class="remove" title="Remove">✕</button>';
    el.querySelector('[data-a="dec"]').addEventListener("click", function () {
      update(line.id, Math.max(0, line.quantity - 1));
    });
    el.querySelector('[data-a="inc"]').addEventListener("click", function () {
      update(line.id, line.quantity + 1);
    });
    el.querySelector(".remove").addEventListener("click", function () { update(line.id, 0); });
    return el;
  }

  function render(cart) {
    root.innerHTML = "";
    if (!cart || !cart.items || cart.items.length === 0) {
      var empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Your cart is empty. Ask for products to get started.";
      root.appendChild(empty);
      return;
    }
    var box = document.createElement("div");
    box.className = "cart";
    cart.items.forEach(function (line) { box.appendChild(row(line)); });
    var footer = document.createElement("div");
    footer.className = "footer";
    footer.innerHTML =
      '<div class="total">Total: ' + esc(fmt(cart.total)) + "</div>" +
      '<button class="btn">Checkout</button>';
    footer.querySelector(".btn").addEventListener("click", checkout);
    box.appendChild(footer);
    root.appendChild(box);
    var note = document.createElement("div");
    note.className = "note";
    box.appendChild(note);
  }

  function renderFromGlobals() {
    var out = (window.openai && window.openai.toolOutput) || {};
    render(out.cart || null);
  }

  window.addEventListener("openai:set_globals", renderFromGlobals);
  renderFromGlobals();
})();
</script>
</body>
</html>
`;

export const cartWidget: WidgetDefinition = {
  name: "cart",
  uri: "ui://widget/cart.html",
  description:
    "Interactive shopping cart: line items with quantity steppers, running total and a checkout button.",
  html,
};
```

- [ ] **Step 4: Verify**

Run: `npx vitest run test/widgets.test.ts` → PASS.
Run: `npm run typecheck` → green.

- [ ] **Step 5: Commit**

```bash
git add src/widgets/cartWidget.ts test/widgets.test.ts
git commit -m "Add cart widget template"
```

---

### Task 5: Attach widgets to tools + registration + wiring tests

**Files:**
- Create: `src/widgets/index.ts`
- Modify: `src/tools/index.ts` (call `registerWidgets`)
- Modify: `src/tools/searchProducts.ts`, `src/tools/getProduct.ts`, `src/tools/viewCart.ts`, `src/tools/addToCart.ts`, `src/tools/updateCartItem.ts` (add `_meta` to each descriptor)
- Test: `test/tools.test.ts`

**Interfaces:**
- Consumes: `productGridWidget`, `cartWidget`, `registerWidgetResources`, `widgetToolMeta`, uris from Tasks 2-4.
- Produces: `registerWidgets(server, config)` from `src/widgets/index.ts`; exported constants `PRODUCT_GRID_URI`, `CART_URI` re-exported from the widget definitions for tool files.

- [ ] **Step 1: Write the failing tests** — add to `test/tools.test.ts`:

```ts
  it("serves both widget resources", async () => {
    const uris = await withClient(authenticated, workingShop(), async (client) => {
      const { resources } = await client.listResources();
      return resources.map((resource) => resource.uri).sort();
    });

    expect(uris).toEqual(["ui://widget/cart.html", "ui://widget/product-grid.html"]);
  });

  it("attaches widget templates to catalog and cart tools", async () => {
    const tools = await withClient(authenticated, workingShop(), async (client) => {
      const { tools: list } = await client.listTools();
      return list;
    });

    const templateOf = (name: string) =>
      (tools.find((tool) => tool.name === name)?._meta ?? {})["openai/outputTemplate"];

    expect(templateOf("search_products")).toBe("ui://widget/product-grid.html");
    expect(templateOf("get_product")).toBe("ui://widget/product-grid.html");
    expect(templateOf("view_cart")).toBe("ui://widget/cart.html");
    expect(templateOf("add_to_cart")).toBe("ui://widget/cart.html");
    expect(templateOf("update_cart_item")).toBe("ui://widget/cart.html");
    expect(templateOf("list_orders")).toBeUndefined();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/tools.test.ts`
Expected: FAIL — no resources served, `_meta` undefined.

- [ ] **Step 3: Implement.** Create `src/widgets/index.ts`:

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "../types.js";
import { cartWidget } from "./cartWidget.js";
import { productGridWidget } from "./productGridWidget.js";
import { registerWidgetResources, widgetToolMeta } from "./registry.js";

export const PRODUCT_GRID_URI = productGridWidget.uri;
export const CART_URI = cartWidget.uri;
export { widgetToolMeta };

export function registerWidgets(server: McpServer, config: AppConfig): void {
  registerWidgetResources(server, config, [productGridWidget, cartWidget]);
}
```

In `src/tools/index.ts`, import and call it before the tool registrations:

```ts
import { registerWidgets } from "../widgets/index.js";
```

```ts
  registerWidgets(server, options.config);
```

In each of the five tool files, add the `_meta` key to the `registerTool` config (after `annotations`), importing `widgetToolMeta` and the URI constant from `../widgets/index.js`:

`src/tools/searchProducts.ts`:
```ts
      _meta: widgetToolMeta(PRODUCT_GRID_URI, "Searching the catalog…", "Products found"),
```

`src/tools/getProduct.ts`:
```ts
      _meta: widgetToolMeta(PRODUCT_GRID_URI, "Loading product…", "Product loaded"),
```

`src/tools/viewCart.ts`:
```ts
      _meta: widgetToolMeta(CART_URI, "Loading your cart…", "Cart loaded"),
```

`src/tools/addToCart.ts`:
```ts
      _meta: widgetToolMeta(CART_URI, "Adding to your cart…", "Added to cart"),
```

`src/tools/updateCartItem.ts`:
```ts
      _meta: widgetToolMeta(CART_URI, "Updating your cart…", "Cart updated"),
```

- [ ] **Step 4: Verify**

Run: `npx vitest run test/tools.test.ts` → PASS.
Run: `npm run typecheck && npm test` → green.

- [ ] **Step 5: Commit**

```bash
git add src/widgets/index.ts src/tools/index.ts src/tools/searchProducts.ts src/tools/getProduct.ts src/tools/viewCart.ts src/tools/addToCart.ts src/tools/updateCartItem.ts test/tools.test.ts
git commit -m "Attach product grid and cart widgets to catalog/cart tools"
```

---

### Task 6: Docs, manual test checklist, full verification

**Files:**
- Modify: `README.md` (widgets section), `CLAUDE.md` (separation-of-concerns list gains `src/widgets/*`)
- Create: `docs/widgets.md` (manual ChatGPT verification checklist)
- Modify: `src/tools/index.ts` (version bump `0.4.0` → `0.5.0`)

- [ ] **Step 1: CLAUDE.md** — in the "Separation of concerns" list, after the tool definitions line, add:

```markdown
  - ChatGPT widget templates → `src/widgets/*` (Apps SDK resources; pure
    presentation, no business logic, self-contained HTML/JS)
```

- [ ] **Step 2: README.md** — after the tools list, add:

```markdown
### ChatGPT widgets

Catalog and cart tools render as interactive views in ChatGPT (Apps SDK):
product cards with add-to-cart, and a cart with quantity steppers and a
checkout button. Widgets are served by the MCP server itself
(`src/widgets/`). Set `WIDGET_IMAGE_DOMAINS` so product thumbnails may load
inside ChatGPT's sandbox; without it, placeholder tiles are shown.
```

- [ ] **Step 3: Create `docs/widgets.md`:**

```markdown
# Widget verification checklist (manual, ChatGPT developer mode)

Widgets cannot be tested from CI — verify after each deploy touching
`src/widgets/`:

1. Refresh the app in ChatGPT (or recreate) so resources re-import.
2. "show me products" → product cards render (grid, prices, stock badges).
   - With `WIDGET_IMAGE_DOMAINS` unset, tiles show the placeholder icon.
3. Click "Add to cart" on an in-stock product → confirmation line appears
   with the cart total ("In cart — total …").
4. "show my cart" → cart widget renders lines, unit prices, line totals.
5. Click + then − on a line → quantity and totals update in place.
6. Click ✕ on a line → line disappears; removing the last line shows the
   empty-cart state.
7. Click Checkout:
   - `CHECKOUT_URL_TEMPLATE` unset → "not configured" message appears.
   - Set → the storefront opens externally with the cart.
8. Dark mode: toggle ChatGPT theme; widgets follow.
```

- [ ] **Step 4: Version bump** — in `src/tools/index.ts`:

```ts
  const server = new McpServer({ name: "webshop-orders", version: "0.5.0" });
```

- [ ] **Step 5: Full verification**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green.

Docker smoke (mock mode): rebuild and run the container, then via curl with `Authorization: Bearer dev-token`:
- `resources/list` → both `ui://widget/*` URIs present with mimeType `text/html;profile=mcp-app`
- `resources/read` of each → HTML containing `window.openai`
- `tools/list` → `search_products` and `view_cart` descriptors carry `_meta["openai/outputTemplate"]`

- [ ] **Step 6: Commit**

```bash
git add README.md CLAUDE.md docs/widgets.md src/tools/index.ts
git commit -m "Document widgets, add manual test checklist; bump server to 0.5.0"
```

---

## Post-plan notes

- **Deploy:** after merge + push, refresh/recreate the ChatGPT app so it re-imports resources, then run `docs/widgets.md` checklist live. Set `WIDGET_IMAGE_DOMAINS` in Vercel to the store's thumbnail CDN origin when known.
- **v2 candidates (spec):** order/tracking widgets, storefront branding, image galleries.
