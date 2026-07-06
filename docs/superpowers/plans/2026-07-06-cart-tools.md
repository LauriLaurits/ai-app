# Cart & Checkout-Handoff Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cart building in chat (`add_to_cart`, `view_cart`, `update_cart_item`) plus a storefront checkout handoff link (`get_checkout_link`) to the webshop MCP server. Payment never happens in chat.

**Architecture:** Four new MCP tools follow the existing one-file-per-tool pattern. `ShopAdapter` gains three cart methods; Medusa cart I/O lives in a new `medusaCart.ts` module (kept out of `medusaAdapter.ts` to respect the <150-line file rule) with pure mapping in `medusaMappers.ts`. The customer's active cart id persists in the broker storage layer (Upstash/memory) keyed by customer id, so carts survive token refreshes and conversations. Two new OAuth scopes (`cart.read`, `cart.write`) gate the tools.

**Tech Stack:** TypeScript (strict + noUncheckedIndexedAccess), zod, @modelcontextprotocol/sdk, vitest, Medusa store API.

**Spec:** `docs/superpowers/specs/2026-07-03-cart-tools-design.md`

## Global Constraints

- `npm run typecheck` and `npm test` must pass after every task. No `any`, no blanket `as` casts.
- Files stay under ~150 lines; one responsibility per file.
- All money through `src/money.ts` (`money()`); Medusa amounts are minor units.
- Raw Medusa shapes stay inside `medusaMappers.ts`; adapters return domain types only.
- TDD: write the failing test, watch it fail, implement, watch it pass, commit.
- No payment / order completion in chat. Write tools are annotated `readOnlyHint: false`.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: `cart.read` / `cart.write` scopes + `CHECKOUT_URL_TEMPLATE` config

**Files:**
- Modify: `src/types.ts` (AppConfig `scopes`, new `checkout` section)
- Modify: `src/config.ts`
- Modify: `src/oauth/validation.ts` (new `supportedScopes`, use it everywhere)
- Modify: `src/auth/tokenVerifier.ts:49,85` (mock/demo grant all scopes)
- Modify: `src/httpHandlers.ts:56,137,197` (metadata + challenges advertise all scopes)
- Modify: `test/helpers.ts` (`makeConfig` base)
- Modify: `.env.example`
- Test: `test/scopes.test.ts` (create)

**Interfaces:**
- Consumes: existing `AppConfig`, `parseScopes(config, value)`.
- Produces: `config.scopes.cartRead === "cart.read"`, `config.scopes.cartWrite === "cart.write"`, `config.checkout.urlTemplate: string`, and `supportedScopes(config: AppConfig): string[]` exported from `src/oauth/validation.ts`. Later tasks rely on these exact names.

- [ ] **Step 1: Write the failing test** — create `test/scopes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { protectedResourceMetadata } from "../src/httpHandlers.js";
import { parseScopes, supportedScopes } from "../src/oauth/validation.js";
import { makeConfig } from "./helpers.js";

describe("cart scopes", () => {
  it("lists all four scopes as supported", () => {
    const config = makeConfig();
    expect(supportedScopes(config)).toEqual([
      "profile.read",
      "orders.read",
      "cart.read",
      "cart.write",
    ]);
  });

  it("defaults token requests without a scope param to all supported scopes", () => {
    const config = makeConfig();
    expect(parseScopes(config, undefined)).toEqual([
      "profile.read",
      "orders.read",
      "cart.read",
      "cart.write",
    ]);
  });

  it("accepts explicitly requested cart scopes", () => {
    const config = makeConfig();
    expect(parseScopes(config, "cart.read cart.write")).toEqual([
      "cart.read",
      "cart.write",
    ]);
  });

  it("advertises cart scopes in protected resource metadata", () => {
    const scopes = protectedResourceMetadata().scopes_supported as string[];
    expect(scopes).toEqual(
      expect.arrayContaining(["cart.read", "cart.write"])
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/scopes.test.ts`
Expected: FAIL — `supportedScopes` is not exported / `cartRead` missing from config.

- [ ] **Step 3: Implement config + types.** In `src/types.ts`, extend `AppConfig`:

```ts
  scopes: {
    profileRead: string;
    ordersRead: string;
    cartRead: string;
    cartWrite: string;
  };
```

and after the `shop` section add:

```ts
  checkout: {
    urlTemplate: string;
  };
```

In `src/config.ts` replace the `scopes` block and add `checkout` after `shop`:

```ts
  scopes: {
    profileRead: "profile.read",
    ordersRead: "orders.read",
    cartRead: "cart.read",
    cartWrite: "cart.write",
  },
```

```ts
  checkout: {
    // Storefront handoff for get_checkout_link; {cartId} is replaced with the
    // active cart id. Empty disables the handoff link.
    urlTemplate: process.env.CHECKOUT_URL_TEMPLATE ?? "",
  },
```

In `test/helpers.ts` `makeConfig` base, mirror both changes:

```ts
    scopes: {
      profileRead: "profile.read",
      ordersRead: "orders.read",
      cartRead: "cart.read",
      cartWrite: "cart.write",
    },
```

and after `shop: { adapter: "medusa" },`:

```ts
    checkout: { urlTemplate: "" },
```

- [ ] **Step 4: Implement `supportedScopes` and use it.** In `src/oauth/validation.ts` replace `allowedScopes` and the `parseScopes` default:

```ts
export function supportedScopes(config: AppConfig): string[] {
  return [
    config.scopes.profileRead,
    config.scopes.ordersRead,
    config.scopes.cartRead,
    config.scopes.cartWrite,
  ];
}

function allowedScopes(config: AppConfig): Set<string> {
  return new Set([...supportedScopes(config), "offline", "offline_access"]);
}
```

and inside `parseScopes`:

```ts
  const scopes = requested.length
    ? requested.filter((scope) => allowed.has(scope))
    : supportedScopes(config);
```

In `src/auth/tokenVerifier.ts` add `import { supportedScopes } from "../oauth/validation.js";` and replace both `scopes: [config.scopes.profileRead, config.scopes.ordersRead],` occurrences (demo result ~line 49, mock result ~line 85) with:

```ts
    scopes: supportedScopes(config),
```

In `src/httpHandlers.ts` add `import { supportedScopes } from "./oauth/validation.js";` and replace all three `[config.scopes.profileRead, config.scopes.ordersRead]` occurrences (lines 56, 137, 197) with `supportedScopes(config)`.

Note: `src/oauth/loginPage.ts` needs NO change — it forwards the `scope` param as a hidden form field and renders no scope list; the new defaults flow through `parseScopes` in `src/oauth/handlers.ts` automatically.

In `.env.example`, after the `MEDUSA_REGION_ID=` block add:

```
# Storefront checkout handoff used by get_checkout_link. {cartId} is replaced
# with the active cart id, e.g. https://shop.example/checkout?cart={cartId}.
# Leave empty to disable the handoff link.
CHECKOUT_URL_TEMPLATE=
```

- [ ] **Step 5: Verify**

Run: `npx vitest run test/scopes.test.ts` → PASS.
Run: `npm run typecheck && npm test` → all green (existing oauthFlow tests must still pass; they don't pin the default scope list, but if any snapshot fails, update it to include the cart scopes — the new defaults are intentional).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/config.ts src/oauth/validation.ts src/auth/tokenVerifier.ts src/httpHandlers.ts test/helpers.ts test/scopes.test.ts .env.example
git commit -m "Add cart.read/cart.write scopes and checkout handoff config"
```

---

### Task 2: Order line items expose `variantId` / `productId`

**Files:**
- Modify: `src/types.ts` (`OrderItem`)
- Modify: `src/shop/adapters/medusaMappers.ts` (`MedusaOrderItem`, `mapItems`)
- Modify: `src/tools/schemas.ts` (`orderDetailsSchema` items)
- Modify: `src/shop/adapters/mockShopAdapter.ts` (order fixture items)
- Modify: `test/helpers.ts` (order item fixture)
- Test: `test/medusaAdapter.test.ts`

**Interfaces:**
- Produces: `OrderItem.variantId: string | null` and `OrderItem.productId: string | null` — the reorder flow (history → `add_to_cart`) depends on these.

- [ ] **Step 1: Write the failing test** — add to `test/medusaAdapter.test.ts` inside the existing `describe`:

```ts
  it("exposes variant and product ids on order line items", async () => {
    const adapter = createMedusaAdapter(config);
    const details = await adapter.getOrderDetails(identity, "order_1");

    expect(details?.items[0]?.variantId).toBe("var_1");
    expect(details?.items[0]?.productId).toBe("prod_1");
  });
```

In `test/helpers.ts`, extend the order item fixture (inside `makeMedusaFetchState` orders):

```ts
        items: [
          {
            title: "Item",
            quantity: 5,
            unit_price: 5946,
            variant_id: "var_1",
            product_id: "prod_1",
          },
        ],
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/medusaAdapter.test.ts`
Expected: FAIL — `variantId` is `undefined`.

- [ ] **Step 3: Implement.** In `src/types.ts`:

```ts
export interface OrderItem {
  sku: string | null;
  variantId: string | null;
  productId: string | null;
  name: string;
  quantity: number;
  unitPrice: Money;
}
```

In `src/shop/adapters/medusaMappers.ts`, add to `MedusaOrderItem`:

```ts
  variant_id?: string | null;
  product_id?: string | null;
```

and in `mapItems`, add to the returned object:

```ts
    variantId: item.variant_id ?? null,
    productId: item.product_id ?? null,
```

In `src/tools/schemas.ts`, extend the `orderDetailsSchema` items object:

```ts
      sku: z.string().nullable().optional(),
      variantId: z.string().nullable(),
      productId: z.string().nullable(),
```

In `src/shop/adapters/mockShopAdapter.ts`, add ids to every order item (catalog items get real ids; items not in the mock catalog get `null`):

```ts
        {
          sku: "demo-vit-d",
          variantId: "var_demo_vit_d_60",
          productId: "prod_demo_vitamin_d",
          name: "Vitamin D supplement",
          quantity: 1,
          unitPrice: { amount: 12.9, currency: "EUR" },
        },
        {
          sku: "demo-bandages",
          variantId: null,
          productId: null,
          name: "Elastic bandage",
          quantity: 2,
          unitPrice: { amount: 4.5, currency: "EUR" },
        },
        {
          sku: "demo-care",
          variantId: null,
          productId: null,
          name: "Skin care cream",
          quantity: 1,
          unitPrice: { amount: 20.7, currency: "EUR" },
        },
```

and in the second order:

```ts
        {
          sku: "demo-toothpaste",
          variantId: "var_demo_toothpaste",
          productId: "prod_demo_toothpaste",
          name: "Sensitive toothpaste",
          quantity: 1,
          unitPrice: { amount: 6.4, currency: "EUR" },
        },
        {
          sku: "demo-mouthwash",
          variantId: null,
          productId: null,
          name: "Mouthwash",
          quantity: 1,
          unitPrice: { amount: 11.8, currency: "EUR" },
        },
```

- [ ] **Step 4: Verify**

Run: `npx vitest run test/medusaAdapter.test.ts` → PASS.
Run: `npm run typecheck && npm test` → green.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/shop/adapters/medusaMappers.ts src/tools/schemas.ts src/shop/adapters/mockShopAdapter.ts test/helpers.ts test/medusaAdapter.test.ts
git commit -m "Expose variantId/productId on order line items for reorder flows"
```

---

### Task 3: Cart domain types + Medusa cart mapper (pure)

**Files:**
- Modify: `src/types.ts` (add `Cart`, `CartLine`, `CartItemInput` — NOT `ShopAdapter` yet)
- Modify: `src/shop/adapters/medusaMappers.ts` (raw cart shapes + `cartToDomain`)
- Test: `test/cartMappers.test.ts` (create)

**Interfaces:**
- Produces (exact — later tasks import these):

```ts
export interface CartLine {
  id: string;
  variantId: string | null;
  productId: string | null;
  title: string;
  quantity: number;
  unitPrice: Money;
  lineTotal: Money;
}

export interface Cart {
  id: string;
  items: CartLine[];
  itemCount: number; // sum of line quantities
  total: Money;
}

export interface CartItemInput {
  variantId: string;
  quantity: number;
}
```

and `cartToDomain(cart: MedusaCart): Cart` from `medusaMappers.ts`.

- [ ] **Step 1: Write the failing test** — create `test/cartMappers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cartToDomain } from "../src/shop/adapters/medusaMappers.js";

describe("cartToDomain", () => {
  it("maps a Medusa cart with minor-unit prices", () => {
    const cart = cartToDomain({
      id: "cart_1",
      currency_code: "eur",
      total: 3870,
      items: [
        {
          id: "line_1",
          variant_id: "var_1",
          product_id: "prod_1",
          product_title: "Vitamin D supplement",
          quantity: 3,
          unit_price: 1290,
          total: 3870,
        },
      ],
    });

    expect(cart).toEqual({
      id: "cart_1",
      itemCount: 3,
      total: { amount: 38.7, currency: "EUR" },
      items: [
        {
          id: "line_1",
          variantId: "var_1",
          productId: "prod_1",
          title: "Vitamin D supplement",
          quantity: 3,
          unitPrice: { amount: 12.9, currency: "EUR" },
          lineTotal: { amount: 38.7, currency: "EUR" },
        },
      ],
    });
  });

  it("keeps zero-decimal currencies intact", () => {
    const cart = cartToDomain({
      id: "cart_jp",
      currency_code: "jpy",
      total: 1500,
      items: [{ id: "l1", quantity: 1, unit_price: 1500, total: 1500 }],
    });

    expect(cart.total).toEqual({ amount: 1500, currency: "JPY" });
    expect(cart.items[0]?.unitPrice).toEqual({ amount: 1500, currency: "JPY" });
  });

  it("handles a cart with no items array", () => {
    const cart = cartToDomain({ id: "cart_empty", currency_code: "eur", total: 0 });

    expect(cart.items).toEqual([]);
    expect(cart.itemCount).toBe(0);
    expect(cart.total).toEqual({ amount: 0, currency: "EUR" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/cartMappers.test.ts`
Expected: FAIL — `cartToDomain` is not exported.

- [ ] **Step 3: Implement.** Add the three interfaces from the Interfaces block above to `src/types.ts` (place them after `ProductSearchResult`). Then in `src/shop/adapters/medusaMappers.ts`, add `Cart, CartLine` to the type import from `../../types.js`, and append:

```ts
export interface MedusaCartLine {
  id?: string;
  variant_id?: string | null;
  product_id?: string | null;
  product_title?: string | null;
  title?: string | null;
  variant_title?: string | null;
  quantity?: number | string;
  unit_price?: number | string;
  total?: number | string;
  subtotal?: number | string;
}

export interface MedusaCart {
  id?: string;
  currency_code?: string;
  total?: number | string;
  item_total?: number | string;
  subtotal?: number | string;
  items?: MedusaCartLine[];
}

export function cartToDomain(cart: MedusaCart): Cart {
  const items = Array.isArray(cart.items) ? cart.items : [];
  const currency = cart.currency_code;

  const lines: CartLine[] = items.map((item) => ({
    id: String(item.id ?? "unknown"),
    variantId: item.variant_id ?? null,
    productId: item.product_id ?? null,
    title: item.product_title ?? item.title ?? item.variant_title ?? "Cart item",
    quantity: toNumber(item.quantity),
    unitPrice: money(unitPriceMinor(item), currency),
    lineTotal: money(item.total ?? item.subtotal ?? 0, currency),
  }));

  return {
    id: String(cart.id ?? "unknown"),
    items: lines,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    total: money(cart.total ?? cart.item_total ?? cart.subtotal, currency),
  };
}
```

`unitPriceMinor` already exists for order items; loosen its parameter so both shapes fit (structural — no behavior change):

```ts
function unitPriceMinor(
  item: Pick<MedusaOrderItem, "quantity" | "unit_price" | "total" | "subtotal">
): number | string {
```

- [ ] **Step 4: Verify**

Run: `npx vitest run test/cartMappers.test.ts` → PASS.
Run: `npm run typecheck && npm test` → green.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/shop/adapters/medusaMappers.ts test/cartMappers.test.ts
git commit -m "Add Cart domain types and pure Medusa cart mapper"
```

---

### Task 4: Active-cart-id store (per customer, Redis/memory)

**Files:**
- Create: `src/shop/cartIdStore.ts`
- Test: `test/cartIdStore.test.ts` (create)

**Interfaces:**
- Consumes: `setJson`, `getJson`, `deleteKey` from `src/oauth/storage.ts` (already exported, Redis-or-memory).
- Produces: `getActiveCartId(userId: string): Promise<string | null>`, `setActiveCartId(userId: string, cartId: string): Promise<void>`, `clearActiveCartId(userId: string): Promise<void>`.

- [ ] **Step 1: Write the failing test** — create `test/cartIdStore.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  clearActiveCartId,
  getActiveCartId,
  setActiveCartId,
} from "../src/shop/cartIdStore.js";

describe("cart id store", () => {
  it("round-trips an active cart id per customer", async () => {
    await setActiveCartId("cus_cartstore_1", "cart_abc");
    expect(await getActiveCartId("cus_cartstore_1")).toBe("cart_abc");
  });

  it("clears the stored cart id", async () => {
    await setActiveCartId("cus_cartstore_2", "cart_def");
    await clearActiveCartId("cus_cartstore_2");
    expect(await getActiveCartId("cus_cartstore_2")).toBeNull();
  });

  it("returns null when nothing is stored", async () => {
    expect(await getActiveCartId("cus_cartstore_none")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/cartIdStore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/shop/cartIdStore.ts`:

```ts
import { deleteKey, getJson, setJson } from "../oauth/storage.js";

// Medusa carts live long; keep the pointer around for a month so a cart built
// in chat is still there next week. A stale id is recovered transparently
// (the adapter creates a fresh cart when Medusa 404s).
const CART_ID_TTL_SEC = 30 * 24 * 60 * 60;

function cartKey(userId: string): string {
  return `cart:customer:${userId}`;
}

export async function getActiveCartId(userId: string): Promise<string | null> {
  return getJson<string>(cartKey(userId));
}

export async function setActiveCartId(userId: string, cartId: string): Promise<void> {
  await setJson(cartKey(userId), cartId, CART_ID_TTL_SEC);
}

export async function clearActiveCartId(userId: string): Promise<void> {
  await deleteKey(cartKey(userId));
}
```

- [ ] **Step 4: Verify**

Run: `npx vitest run test/cartIdStore.test.ts` → PASS.
Run: `npm run typecheck` → green.

- [ ] **Step 5: Commit**

```bash
git add src/shop/cartIdStore.ts test/cartIdStore.test.ts
git commit -m "Add per-customer active cart id store on broker storage"
```

---

### Task 5: `ShopAdapter` cart methods + mock implementation

**Files:**
- Modify: `src/types.ts` (`ShopAdapter` +3 methods)
- Modify: `src/shop/adapters/mockShopAdapter.ts` (cart implementation)
- Modify: `src/shop/adapters/medusaAdapter.ts` (temporary 501 stubs — replaced in Task 6)
- Modify: `test/tools.test.ts` (`workingShop` / `expiredShop` gain cart methods)
- Test: `test/mockShopAdapter.test.ts`

**Interfaces:**
- Consumes: `Cart`, `CartItemInput` from Task 3.
- Produces (exact — tools in Task 7 call these):

```ts
  getCart(identity: Identity): Promise<Cart | null>;
  addToCart(identity: Identity, item: CartItemInput): Promise<Cart>;
  updateCartItem(identity: Identity, lineItemId: string, quantity: number): Promise<Cart>;
```

Mock line item ids are `line_<variantId>`; mock cart id is `mock-cart-<userId>`.

- [ ] **Step 1: Write the failing tests** — add to `test/mockShopAdapter.test.ts`:

```ts
import type { Identity } from "../src/types.js";

const cartIdentity: Identity = {
  userId: "cart-user-1",
  displayName: "Cart User",
  shopIds: ["apotheka"],
};

describe("mock shop adapter cart", () => {
  it("returns null before anything is added", async () => {
    const shop = createMockShopAdapter();
    expect(await shop.getCart(cartIdentity)).toBeNull();
  });

  it("adds items and computes totals", async () => {
    const shop = createMockShopAdapter();
    const cart = await shop.addToCart(cartIdentity, {
      variantId: "var_demo_vit_d_60",
      quantity: 2,
    });

    expect(cart.items).toHaveLength(1);
    expect(cart.itemCount).toBe(2);
    expect(cart.total).toEqual({ amount: 25.8, currency: "EUR" });
    expect(await shop.getCart(cartIdentity)).toEqual(cart);
  });

  it("merges repeated adds of the same variant", async () => {
    const shop = createMockShopAdapter();
    await shop.addToCart(cartIdentity, { variantId: "var_demo_vit_d_60", quantity: 1 });
    const cart = await shop.addToCart(cartIdentity, {
      variantId: "var_demo_vit_d_60",
      quantity: 2,
    });

    expect(cart.items).toHaveLength(1);
    expect(cart.itemCount).toBe(3);
  });

  it("updates quantity and removes the line at zero", async () => {
    const shop = createMockShopAdapter();
    const cart = await shop.addToCart(cartIdentity, {
      variantId: "var_demo_vit_d_60",
      quantity: 2,
    });
    const lineId = String(cart.items[0]?.id);

    const updated = await shop.updateCartItem(cartIdentity, lineId, 3);
    expect(updated.items[0]?.quantity).toBe(3);
    expect(updated.total).toEqual({ amount: 38.7, currency: "EUR" });

    const emptied = await shop.updateCartItem(cartIdentity, lineId, 0);
    expect(emptied.items).toHaveLength(0);
    expect(emptied.itemCount).toBe(0);
  });

  it("rejects unknown variants", async () => {
    const shop = createMockShopAdapter();
    await expect(
      shop.addToCart(cartIdentity, { variantId: "var_nope", quantity: 1 })
    ).rejects.toThrow(/variant/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/mockShopAdapter.test.ts`
Expected: FAIL — `getCart` does not exist.

- [ ] **Step 3: Extend the interface.** In `src/types.ts`, add to `ShopAdapter`:

```ts
  getCart(identity: Identity): Promise<Cart | null>;
  addToCart(identity: Identity, item: CartItemInput): Promise<Cart>;
  updateCartItem(identity: Identity, lineItemId: string, quantity: number): Promise<Cart>;
```

- [ ] **Step 4: Implement the mock cart.** In `src/shop/adapters/mockShopAdapter.ts`, add `Cart, CartItemInput, CartLine, ProductVariantInfo` to the type imports, then add module-level helpers after the `products` array:

```ts
function findVariant(
  variantId: string
): { product: ProductDetails; variant: ProductVariantInfo } | null {
  for (const product of products) {
    const variant = product.variants.find((entry) => entry.id === variantId);
    if (variant) return { product, variant };
  }
  return null;
}

function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function withQuantity(line: CartLine, quantity: number): CartLine {
  return {
    ...line,
    quantity,
    lineTotal: {
      amount: roundMoney(line.unitPrice.amount * quantity),
      currency: line.unitPrice.currency,
    },
  };
}

function recalc(cart: Cart): Cart {
  const itemCount = cart.items.reduce((sum, line) => sum + line.quantity, 0);
  const amount = roundMoney(
    cart.items.reduce((sum, line) => sum + line.lineTotal.amount, 0)
  );
  const currency = cart.items[0]?.lineTotal.currency ?? "EUR";
  return { ...cart, itemCount, total: { amount, currency } };
}
```

Inside `createMockShopAdapter`, add a per-adapter `const carts = new Map<string, Cart>();` (first line of the function body) and the three methods to the returned object:

```ts
    async getCart(identity) {
      return carts.get(identity.userId) ?? null;
    },

    async addToCart(identity, item: CartItemInput) {
      const match = findVariant(item.variantId);
      if (!match) {
        throw new Error(`Unknown product variant: ${item.variantId}`);
      }

      const unitPrice = match.variant.price ?? { amount: 0, currency: "EUR" };
      const cart = carts.get(identity.userId) ?? {
        id: `mock-cart-${identity.userId}`,
        items: [],
        itemCount: 0,
        total: { amount: 0, currency: unitPrice.currency },
      };
      const existing = cart.items.find((line) => line.variantId === item.variantId);
      const items = existing
        ? cart.items.map((line) =>
            line.variantId === item.variantId
              ? withQuantity(line, line.quantity + item.quantity)
              : line
          )
        : [
            ...cart.items,
            withQuantity(
              {
                id: `line_${item.variantId}`,
                variantId: item.variantId,
                productId: match.product.id,
                title: match.product.title,
                quantity: item.quantity,
                unitPrice,
                lineTotal: unitPrice,
              },
              item.quantity
            ),
          ];

      const next = recalc({ ...cart, items });
      carts.set(identity.userId, next);
      return next;
    },

    async updateCartItem(identity, lineItemId, quantity) {
      const cart = carts.get(identity.userId);
      const line = cart?.items.find((entry) => entry.id === lineItemId);
      if (!cart || !line) {
        throw new Error(`Unknown cart line item: ${lineItemId}`);
      }

      const items =
        quantity <= 0
          ? cart.items.filter((entry) => entry.id !== lineItemId)
          : cart.items.map((entry) =>
              entry.id === lineItemId ? withQuantity(entry, quantity) : entry
            );

      const next = recalc({ ...cart, items });
      carts.set(identity.userId, next);
      return next;
    },
```

- [ ] **Step 5: Keep the Medusa adapter compiling** with explicit stubs (replaced in Task 6). In `src/shop/adapters/medusaAdapter.ts`, add `MedusaRequestError` to the import from `../../medusa/client.js` and add to the returned object:

```ts
    // Implemented in Task 6 (medusaCart.ts). Explicit 501 beats a silent lie.
    async getCart() {
      throw new MedusaRequestError("Cart is not implemented for Medusa yet.", 501);
    },

    async addToCart() {
      throw new MedusaRequestError("Cart is not implemented for Medusa yet.", 501);
    },

    async updateCartItem() {
      throw new MedusaRequestError("Cart is not implemented for Medusa yet.", 501);
    },
```

- [ ] **Step 6: Fix the tool-test stubs.** In `test/tools.test.ts`, add to the object returned by `workingShop()`:

```ts
    async getCart() {
      return sampleCart();
    },
    async addToCart() {
      return sampleCart();
    },
    async updateCartItem() {
      return sampleCart();
    },
```

with this helper above `workingShop()`:

```ts
function sampleCart() {
  return {
    id: "cart_1",
    items: [
      {
        id: "line_1",
        variantId: "var_1",
        productId: "prod_1",
        title: "Vitamin D supplement",
        quantity: 2,
        unitPrice: { amount: 12.9, currency: "EUR" },
        lineTotal: { amount: 25.8, currency: "EUR" },
      },
    ],
    itemCount: 2,
    total: { amount: 25.8, currency: "EUR" },
  };
}
```

and extend `expiredShop()`'s returned object:

```ts
    getCart: fail,
    addToCart: fail,
    updateCartItem: fail,
```

- [ ] **Step 7: Verify**

Run: `npx vitest run test/mockShopAdapter.test.ts` → PASS.
Run: `npm run typecheck && npm test` → green.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/shop/adapters/mockShopAdapter.ts src/shop/adapters/medusaAdapter.ts test/tools.test.ts test/mockShopAdapter.test.ts
git commit -m "Add ShopAdapter cart methods with mock implementation"
```

---

### Task 6: Medusa cart implementation

**Files:**
- Create: `src/shop/adapters/medusaCart.ts`
- Modify: `src/shop/adapters/medusaAdapter.ts` (extend `customerRequest` with `init`, replace stubs with `...createMedusaCartMethods(...)`)
- Modify: `test/helpers.ts` (fetch fixture cart routes)
- Test: `test/medusaAdapter.test.ts`

**Interfaces:**
- Consumes: `cartToDomain`/`MedusaCart` (Task 3), `getActiveCartId`/`setActiveCartId`/`clearActiveCartId` (Task 4).
- Produces: `createMedusaCartMethods(config: AppConfig, request: MedusaRequester): Pick<ShopAdapter, "getCart" | "addToCart" | "updateCartItem">` where

```ts
export type MedusaRequester = <T>(
  path: string,
  identity: Identity | null,
  init?: RequestInit
) => Promise<T>;
```

Medusa store endpoints used: `POST /store/carts`, `GET /store/carts/:id`, `POST /store/carts/:id/line-items`, `POST /store/carts/:id/line-items/:lineId`, `DELETE /store/carts/:id/line-items/:lineId`.

- [ ] **Step 1: Add cart routes to the fetch fixture.** In `test/helpers.ts`, extend `MedusaFetchState`:

```ts
  carts: Array<Record<string, unknown>>;
  cartSequence: number;
```

initialize in `makeMedusaFetchState()`:

```ts
    carts: [],
    cartSequence: 0,
```

and in `makeMedusaFetch`, after the `/store/orders/` handler (all cart routes require a live token, so they stay below the `liveTokens` guard), add:

```ts
    const recalcCart = (cart: Record<string, unknown>): void => {
      const items = cart.items as Array<Record<string, unknown>>;
      cart.total = items.reduce((sum, line) => sum + Number(line.total ?? 0), 0);
    };
    const findCart = (id: string | undefined) =>
      state.carts.find((entry) => entry.id === decodeURIComponent(id ?? "")) ?? null;

    if (method === "POST" && url.pathname === "/store/carts") {
      state.cartSequence += 1;
      const cart = {
        id: `cart_${state.cartSequence}`,
        currency_code: "eur",
        total: 0,
        items: [] as Array<Record<string, unknown>>,
      };
      state.carts.push(cart);
      return json(200, { cart });
    }

    const linesMatch = url.pathname.match(/^\/store\/carts\/([^/]+)\/line-items$/);
    if (method === "POST" && linesMatch) {
      const cart = findCart(linesMatch[1]);
      if (!cart) return json(404, { message: "Cart not found" });
      const { variant_id, quantity } = JSON.parse(String(init?.body ?? "{}"));
      const items = cart.items as Array<Record<string, unknown>>;
      items.push({
        id: `line_${items.length + 1}`,
        variant_id,
        product_id: "prod_1",
        product_title: "Vitamin D supplement",
        quantity,
        unit_price: 1290,
        total: 1290 * Number(quantity),
      });
      recalcCart(cart);
      return json(200, { cart });
    }

    const lineMatch = url.pathname.match(/^\/store\/carts\/([^/]+)\/line-items\/([^/]+)$/);
    if (lineMatch) {
      const cart = findCart(lineMatch[1]);
      if (!cart) return json(404, { message: "Cart not found" });
      const items = cart.items as Array<Record<string, unknown>>;
      const line = items.find((entry) => entry.id === decodeURIComponent(lineMatch[2] ?? ""));
      if (!line) return json(404, { message: "Line item not found" });

      if (method === "POST") {
        const { quantity } = JSON.parse(String(init?.body ?? "{}"));
        line.quantity = quantity;
        line.total = Number(line.unit_price) * Number(quantity);
        recalcCart(cart);
        return json(200, { cart });
      }
      if (method === "DELETE") {
        cart.items = items.filter((entry) => entry !== line);
        recalcCart(cart);
        return json(200, { deleted: true });
      }
    }

    const cartMatch = url.pathname.match(/^\/store\/carts\/([^/]+)$/);
    if (method === "GET" && cartMatch) {
      const cart = findCart(cartMatch[1]);
      if (!cart) return json(404, { message: "Cart not found" });
      return json(200, { cart });
    }
```

- [ ] **Step 2: Write the failing tests.** In `test/medusaAdapter.test.ts`, add `clearActiveCartId` import and a new describe:

```ts
import { clearActiveCartId } from "../src/shop/cartIdStore.js";
```

```ts
describe("medusa adapter cart", () => {
  let state: MedusaFetchState;

  beforeEach(async () => {
    state = makeMedusaFetchState();
    vi.stubGlobal("fetch", makeMedusaFetch(state));
    await clearActiveCartId(identity.userId);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null when the customer has no cart", async () => {
    const adapter = createMedusaAdapter(config);
    expect(await adapter.getCart(identity)).toBeNull();
  });

  it("creates a cart on first add and reuses it afterwards", async () => {
    const adapter = createMedusaAdapter(config);
    const first = await adapter.addToCart(identity, { variantId: "var_1", quantity: 2 });
    const second = await adapter.addToCart(identity, { variantId: "var_1", quantity: 1 });

    expect(second.id).toBe(first.id);
    expect(state.carts).toHaveLength(1);
    expect(second.itemCount).toBe(3);
    expect(second.items[0]?.unitPrice).toEqual({ amount: 12.9, currency: "EUR" });
  });

  it("recovers with a fresh cart when the stored cart is gone", async () => {
    const adapter = createMedusaAdapter(config);
    const first = await adapter.addToCart(identity, { variantId: "var_1", quantity: 1 });

    state.carts.length = 0; // completed or expired on the Medusa side

    const second = await adapter.addToCart(identity, { variantId: "var_1", quantity: 1 });
    expect(second.id).not.toBe(first.id);
    expect(second.items).toHaveLength(1);
  });

  it("updates a line item quantity and removes it at zero", async () => {
    const adapter = createMedusaAdapter(config);
    const cart = await adapter.addToCart(identity, { variantId: "var_1", quantity: 2 });
    const lineId = String(cart.items[0]?.id);

    const updated = await adapter.updateCartItem(identity, lineId, 3);
    expect(updated.items[0]?.quantity).toBe(3);
    expect(updated.total).toEqual({ amount: 38.7, currency: "EUR" });

    const emptied = await adapter.updateCartItem(identity, lineId, 0);
    expect(emptied.items).toHaveLength(0);
  });
});
```

Note: `add_to_cart` line items in the fixture always price `var_1` at 1290 minor units; the two-add reuse test therefore expects two lines merged only by Medusa in reality — the fixture appends a second line, so assert `itemCount` (3) rather than line count.

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run test/medusaAdapter.test.ts`
Expected: FAIL — 501 "Cart is not implemented for Medusa yet."

- [ ] **Step 4: Implement.** First extend `customerRequest` in `src/shop/adapters/medusaAdapter.ts` to forward request options:

```ts
  async function customerRequest<T>(
    path: string,
    identity: Identity | null,
    init: RequestInit = {}
  ): Promise<T> {
    const token = await customerToken(identity);
    try {
      return await medusaRequest<T>(config, path, token, init);
    } catch (error) {
      if (!(error instanceof MedusaAuthError) || identity?.medusaToken) {
        throw error;
      }
      cachedToken = null;
      tokenExpiresAt = 0;
      return medusaRequest<T>(config, path, await login(), init);
    }
  }
```

Create `src/shop/adapters/medusaCart.ts`:

```ts
import { MedusaRequestError } from "../../medusa/client.js";
import {
  clearActiveCartId,
  getActiveCartId,
  setActiveCartId,
} from "../cartIdStore.js";
import type { AppConfig, Cart, CartItemInput, Identity, ShopAdapter } from "../../types.js";
import { cartToDomain, type MedusaCart } from "./medusaMappers.js";

export type MedusaRequester = <T>(
  path: string,
  identity: Identity | null,
  init?: RequestInit
) => Promise<T>;

const CART_FIELDS = "id,currency_code,total,item_total,subtotal,items.*";

function cartQuery(): string {
  return new URLSearchParams({ fields: CART_FIELDS }).toString();
}

// A cart Medusa no longer serves (completed order or expired) comes back as
// 404/409; that is recoverable by starting a fresh cart, unlike auth errors.
function isGoneCart(error: unknown): boolean {
  return (
    error instanceof MedusaRequestError &&
    (error.status === 404 || error.status === 409)
  );
}

export function createMedusaCartMethods(
  config: AppConfig,
  request: MedusaRequester
): Pick<ShopAdapter, "getCart" | "addToCart" | "updateCartItem"> {
  async function createRemoteCart(identity: Identity): Promise<MedusaCart> {
    const body = await request<{ cart?: MedusaCart }>(
      `/store/carts?${cartQuery()}`,
      identity,
      {
        method: "POST",
        body: JSON.stringify(
          config.medusa.regionId ? { region_id: config.medusa.regionId } : {}
        ),
      }
    );
    const cart = body?.cart;
    if (!cart?.id) {
      throw new MedusaRequestError("Medusa did not return a cart.", 502);
    }
    await setActiveCartId(identity.userId, String(cart.id));
    return cart;
  }

  async function fetchRemoteCart(
    identity: Identity,
    cartId: string
  ): Promise<MedusaCart | null> {
    try {
      const body = await request<{ cart?: MedusaCart | null }>(
        `/store/carts/${encodeURIComponent(cartId)}?${cartQuery()}`,
        identity
      );
      return body?.cart ?? null;
    } catch (error) {
      if (isGoneCart(error)) {
        await clearActiveCartId(identity.userId);
        return null;
      }
      throw error;
    }
  }

  async function activeCart(identity: Identity): Promise<MedusaCart | null> {
    const cartId = await getActiveCartId(identity.userId);
    return cartId ? fetchRemoteCart(identity, cartId) : null;
  }

  async function addLine(
    identity: Identity,
    cartId: string,
    item: CartItemInput
  ): Promise<Cart> {
    const body = await request<{ cart?: MedusaCart }>(
      `/store/carts/${encodeURIComponent(cartId)}/line-items?${cartQuery()}`,
      identity,
      {
        method: "POST",
        body: JSON.stringify({ variant_id: item.variantId, quantity: item.quantity }),
      }
    );
    return cartToDomain(body?.cart ?? {});
  }

  return {
    async getCart(identity) {
      const cart = await activeCart(identity);
      return cart ? cartToDomain(cart) : null;
    },

    async addToCart(identity, item) {
      const existing = await activeCart(identity);
      const cart = existing ?? (await createRemoteCart(identity));
      try {
        return await addLine(identity, String(cart.id), item);
      } catch (error) {
        // The cart can complete between the lookup and the add; retry once.
        if (!isGoneCart(error)) throw error;
        await clearActiveCartId(identity.userId);
        const fresh = await createRemoteCart(identity);
        return addLine(identity, String(fresh.id), item);
      }
    },

    async updateCartItem(identity, lineItemId, quantity) {
      const cartId = await getActiveCartId(identity.userId);
      if (!cartId) {
        throw new MedusaRequestError("No active cart to update.", 404);
      }

      const linePath = `/store/carts/${encodeURIComponent(cartId)}/line-items/${encodeURIComponent(lineItemId)}`;
      if (quantity <= 0) {
        await request<unknown>(linePath, identity, { method: "DELETE" });
        const cart = await fetchRemoteCart(identity, cartId);
        return cartToDomain(cart ?? {});
      }

      const body = await request<{ cart?: MedusaCart }>(
        `${linePath}?${cartQuery()}`,
        identity,
        { method: "POST", body: JSON.stringify({ quantity }) }
      );
      return cartToDomain(body?.cart ?? {});
    },
  };
}
```

In `src/shop/adapters/medusaAdapter.ts`: remove the three 501 stubs (and the now-unused `MedusaRequestError` import if nothing else uses it), add

```ts
import { createMedusaCartMethods } from "./medusaCart.js";
```

and inside the returned object add:

```ts
    ...createMedusaCartMethods(config, customerRequest),
```

- [ ] **Step 5: Verify**

Run: `npx vitest run test/medusaAdapter.test.ts` → PASS (all, including the pre-existing tests).
Run: `npm run typecheck && npm test` → green.

- [ ] **Step 6: Commit**

```bash
git add src/shop/adapters/medusaCart.ts src/shop/adapters/medusaAdapter.ts test/helpers.ts test/medusaAdapter.test.ts
git commit -m "Implement Medusa cart adapter with create-reuse-recover flow"
```

---

### Task 7: Cart schemas, the four tools, registration, wiring tests

**Files:**
- Modify: `src/tools/schemas.ts` (`cartLineSchema`, `cartSchema`)
- Create: `src/tools/addToCart.ts`, `src/tools/viewCart.ts`, `src/tools/updateCartItem.ts`, `src/tools/getCheckoutLink.ts`
- Modify: `src/tools/index.ts`
- Test: `test/tools.test.ts`

**Interfaces:**
- Consumes: `ShopAdapter.getCart/addToCart/updateCartItem` (Task 5), `config.scopes.cartRead/cartWrite` + `config.checkout.urlTemplate` (Task 1).
- Produces: MCP tools `add_to_cart`, `view_cart`, `update_cart_item`, `get_checkout_link`.

- [ ] **Step 1: Write the failing tests.** In `test/tools.test.ts`:

(a) extend `authenticated`:

```ts
  scopes: ["profile.read", "orders.read", "cart.read", "cart.write"],
```

(b) let `withClient` take a config override (import `AppConfig` type and `makeConfig` is already imported):

```ts
async function withClient<T>(
  auth: AuthResult,
  shop: ShopAdapter,
  fn: (client: Client) => Promise<T>,
  cfg: AppConfig = config
): Promise<T> {
  const server = createWebshopMcpServer({
    config: cfg,
    auth,
    shop,
    logger: silentLogger,
    requestId: "req-test",
  });
```

(add `AppConfig` to the type-import from `../src/types.js`).

(c) update the registered-tools expectation:

```ts
    expect(names).toEqual([
      "add_to_cart",
      "get_checkout_link",
      "get_current_customer",
      "get_order_details",
      "get_product",
      "list_orders",
      "search_products",
      "track_shipment",
      "update_cart_item",
      "view_cart",
    ]);
```

(d) add the new tests at the end of the describe:

```ts
  it("adds items to the cart and returns the updated cart", async () => {
    const result = await callTool(authenticated, workingShop(), "add_to_cart", {
      variantId: "var_1",
      quantity: 2,
    });

    expect(result.isError).toBeFalsy();
    const cart = (result.structuredContent as { cart: { itemCount: number } }).cart;
    expect(cart.itemCount).toBe(2);
  });

  it("marks cart write tools as non-read-only", async () => {
    const tools = await withClient(authenticated, workingShop(), async (client) => {
      const { tools: list } = await client.listTools();
      return list;
    });

    const addToCart = tools.find((tool) => tool.name === "add_to_cart");
    expect(addToCart?.annotations?.readOnlyHint).toBe(false);
    const viewCart = tools.find((tool) => tool.name === "view_cart");
    expect(viewCart?.annotations?.readOnlyHint).toBe(true);
  });

  it("blocks cart writes for tokens without cart.write", async () => {
    const readOnly: AuthResult = {
      ...authenticated,
      scopes: ["profile.read", "orders.read", "cart.read"],
    };
    const result = await callTool(readOnly, workingShop(), "add_to_cart", {
      variantId: "var_1",
      quantity: 1,
    });

    expect(result.isError).toBe(true);
    expect(result._meta?.["mcp/www_authenticate"]).toBeDefined();
  });

  it("reports when the checkout handoff is not configured", async () => {
    const result = await callTool(authenticated, workingShop(), "get_checkout_link");

    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { checkoutUrl: unknown }).checkoutUrl).toBeNull();
  });

  it("builds the checkout link from the configured template", async () => {
    const checkoutConfig = makeConfig({
      checkout: { urlTemplate: "https://shop.test/checkout?cart={cartId}" },
    });
    const result = (await withClient(
      authenticated,
      workingShop(),
      (client) => client.callTool({ name: "get_checkout_link", arguments: {} }),
      checkoutConfig
    )) as { structuredContent?: Record<string, unknown> };

    expect(result.structuredContent?.checkoutUrl).toBe(
      "https://shop.test/checkout?cart=cart_1"
    );
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/tools.test.ts`
Expected: FAIL — tool list mismatch, unknown tool `add_to_cart`.

- [ ] **Step 3: Add schemas.** In `src/tools/schemas.ts` append:

```ts
export const cartLineSchema = z.object({
  id: z.string(),
  variantId: z.string().nullable(),
  productId: z.string().nullable(),
  title: z.string(),
  quantity: z.number(),
  unitPrice: moneySchema,
  lineTotal: moneySchema,
});

export const cartSchema = z.object({
  id: z.string(),
  items: z.array(cartLineSchema),
  itemCount: z.number(),
  total: moneySchema,
});
```

- [ ] **Step 4: Create the four tools.**

`src/tools/addToCart.ts`:

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cartSchema } from "./schemas.js";
import { jsonResult, runTool, type ToolContext } from "./shared.js";

export function registerAddToCart(server: McpServer, ctx: ToolContext): void {
  const scopes = [ctx.config.scopes.cartWrite];

  server.registerTool(
    "add_to_cart",
    {
      title: "Add to cart",
      description:
        "Adds a product variant to the customer's shopping cart and returns the " +
        "updated cart with prices. Creates the cart on first use. Never takes payment.",
      inputSchema: {
        variantId: z.string().min(1),
        quantity: z.number().int().min(1).max(99),
      },
      outputSchema: { cart: cartSchema },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) =>
      runTool(ctx, "add_to_cart", args, scopes, async (identity) => {
        const cart = await ctx.shop.addToCart(identity, {
          variantId: args.variantId,
          quantity: args.quantity,
        });
        return jsonResult({ cart });
      })
  );
}
```

`src/tools/viewCart.ts`:

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { cartSchema } from "./schemas.js";
import { jsonResult, runTool, type ToolContext } from "./shared.js";

export function registerViewCart(server: McpServer, ctx: ToolContext): void {
  const scopes = [ctx.config.scopes.cartRead];

  server.registerTool(
    "view_cart",
    {
      title: "View cart",
      description:
        "Returns the customer's active shopping cart: items, quantities, unit " +
        "prices and totals. Returns null when no cart exists yet.",
      inputSchema: {},
      outputSchema: { cart: cartSchema.nullable() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) =>
      runTool(ctx, "view_cart", args, scopes, async (identity) => {
        const cart = await ctx.shop.getCart(identity);
        return jsonResult({ cart });
      })
  );
}
```

`src/tools/updateCartItem.ts`:

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cartSchema } from "./schemas.js";
import { jsonResult, runTool, type ToolContext } from "./shared.js";

export function registerUpdateCartItem(server: McpServer, ctx: ToolContext): void {
  const scopes = [ctx.config.scopes.cartWrite];

  server.registerTool(
    "update_cart_item",
    {
      title: "Update cart item",
      description:
        "Sets the quantity of a cart line item; quantity 0 removes the line. " +
        "Returns the updated cart.",
      inputSchema: {
        lineItemId: z.string().min(1),
        quantity: z.number().int().min(0).max(99),
      },
      outputSchema: { cart: cartSchema },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) =>
      runTool(ctx, "update_cart_item", args, scopes, async (identity) => {
        const cart = await ctx.shop.updateCartItem(
          identity,
          args.lineItemId,
          args.quantity
        );
        return jsonResult({ cart });
      })
  );
}
```

`src/tools/getCheckoutLink.ts`:

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jsonResult, runTool, type ToolContext } from "./shared.js";

export function registerGetCheckoutLink(server: McpServer, ctx: ToolContext): void {
  const scopes = [ctx.config.scopes.cartRead];

  server.registerTool(
    "get_checkout_link",
    {
      title: "Get checkout link",
      description:
        "Returns a link to the webshop checkout for the customer's active cart. " +
        "Payment happens on the webshop, never in chat.",
      inputSchema: {},
      outputSchema: {
        checkoutUrl: z.string().nullable(),
        message: z.string().nullable(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) =>
      runTool(ctx, "get_checkout_link", args, scopes, async (identity) => {
        const template = ctx.config.checkout.urlTemplate;
        if (!template) {
          return jsonResult({
            checkoutUrl: null,
            message: "Checkout handoff is not configured for this shop yet.",
          });
        }

        const cart = await ctx.shop.getCart(identity);
        if (!cart || cart.items.length === 0) {
          return jsonResult({
            checkoutUrl: null,
            message: "The cart is empty. Add items before checking out.",
          });
        }

        return jsonResult({
          checkoutUrl: template.replace("{cartId}", encodeURIComponent(cart.id)),
          message: null,
        });
      })
  );
}
```

- [ ] **Step 5: Register.** In `src/tools/index.ts` add the four imports and, after `registerGetProduct(server, ctx);`:

```ts
  registerAddToCart(server, ctx);
  registerViewCart(server, ctx);
  registerUpdateCartItem(server, ctx);
  registerGetCheckoutLink(server, ctx);
```

- [ ] **Step 6: Verify**

Run: `npx vitest run test/tools.test.ts` → PASS.
Run: `npm run typecheck && npm test` → green.

- [ ] **Step 7: Commit**

```bash
git add src/tools/schemas.ts src/tools/addToCart.ts src/tools/viewCart.ts src/tools/updateCartItem.ts src/tools/getCheckoutLink.ts src/tools/index.ts test/tools.test.ts
git commit -m "Add cart tools: add_to_cart, view_cart, update_cart_item, get_checkout_link"
```

---

### Task 8: Docs, version bump, final verification

**Files:**
- Modify: `CLAUDE.md` (security bullet), `README.md` (tool list), `docs/oauth-broker.md` (scopes, if listed), `docs/superpowers/specs/2026-07-03-cart-tools-design.md` (cart-state wording), `src/tools/index.ts` (version)

- [ ] **Step 1: Update CLAUDE.md.** Replace the bullet

> - Tools are **read-only**. Any future write/action tool needs explicit confirmation semantics and must not take payment in chat.

with:

```markdown
- Tools are read-only except the cart tools (`add_to_cart`, `update_cart_item`),
  which are annotated `readOnlyHint: false` so clients confirm before running
  them and always return the full resulting cart. No tool may take payment in
  chat; checkout is a handoff link to the storefront (`CHECKOUT_URL_TEMPLATE`).
```

- [ ] **Step 2: Update README.md and docs/oauth-broker.md.** In README's tool list (search for `track_shipment` to find it), append entries following the existing format:

```
- `add_to_cart` — add a product variant to the customer's cart (requires `cart.write`)
- `view_cart` — show the active cart with totals (requires `cart.read`)
- `update_cart_item` — change a line's quantity; 0 removes it (requires `cart.write`)
- `get_checkout_link` — hand off to the storefront checkout; payment never happens in chat
```

In both files, wherever `profile.read` / `orders.read` are listed as the scope set (grep for `orders.read`), extend the list with `cart.read` and `cart.write`.

- [ ] **Step 3: Align the spec's cart-state wording** (implementation stores the pointer per customer, not on the session record). In `docs/superpowers/specs/2026-07-03-cart-tools-design.md`, replace the first bullet under **Cart state** with:

```markdown
- The active cart id is stored in the broker storage layer keyed by customer
  (`cart:customer:<id>`, 30-day TTL) so it survives token refreshes and new
  conversations. `add_to_cart` reuses it while the cart is open; on Medusa
  404/409 (expired/completed) it transparently creates a fresh cart and
  updates the pointer.
```

- [ ] **Step 4: Version bump.** In `src/tools/index.ts` change the server version:

```ts
  const server = new McpServer({ name: "webshop-orders", version: "0.4.0" });
```

- [ ] **Step 5: Full verification**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green.

Then a live smoke test through Docker (mock mode):

```bash
docker build -t ai-app-mcp . && docker rm -f ai-app-mcp 2>/dev/null; docker run -d --name ai-app-mcp -p 8787:8787 -e AUTH_MODE=mock -e SHOP_ADAPTER=mock ai-app-mcp
```

then call `tools/list` with `Authorization: Bearer dev-token` and confirm the four cart tools appear, and an `add_to_cart` → `view_cart` → `get_checkout_link` sequence behaves (link reports "not configured", which is correct without `CHECKOUT_URL_TEMPLATE`).

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md README.md docs/oauth-broker.md docs/superpowers/specs/2026-07-03-cart-tools-design.md src/tools/index.ts
git commit -m "Document cart tools, scopes and checkout handoff; bump server to 0.4.0"
```

---

## Post-plan notes

- **Deploy:** after merge, set `CHECKOUT_URL_TEMPLATE` in Vercel env when the storefront handoff route exists; without it the tools work and `get_checkout_link` degrades gracefully. ChatGPT connections made before this change will re-authorize on first cart tool call (scope challenge) — expected, no action needed.
- **Out of scope (per spec):** shipping/address selection in chat, order completion, storefront auto-discovery of the cart, promotions.
