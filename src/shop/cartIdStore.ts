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
