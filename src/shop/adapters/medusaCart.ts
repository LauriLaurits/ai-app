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
