import {
  customerDisplayName,
  loginCustomer,
  maskEmail,
  MedusaAuthError,
  MedusaRequestError,
  medusaRequest,
  type MedusaCustomer,
} from "../../medusa/client.js";
import type {
  AppConfig,
  Identity,
  OrderFilters,
  ProductSearchQuery,
  ShopAdapter,
} from "../../types.js";
import {
  orderToDetails,
  orderToSummary,
  orderToTracking,
  productToDetails,
  productToSummary,
  type MedusaOrder,
  type MedusaProduct,
} from "./medusaMappers.js";

const ORDER_FIELDS =
  "id,display_id,created_at,status,fulfillment_status,payment_status,currency_code,total,item_total,subtotal,items.*";
const ORDER_DETAIL_FIELDS = `${ORDER_FIELDS},shipping_methods.*,fulfillments.*,fulfillments.labels.*`;
const PRODUCT_FIELDS =
  "id,title,handle,thumbnail,description,*variants.calculated_price,+variants.inventory_quantity";

export function createMedusaAdapter(config: AppConfig): ShopAdapter {
  let cachedToken: string | null = null;
  let tokenExpiresAt = 0;

  function assertFallbackLoginConfigured(): void {
    const missing: string[] = [];
    if (!config.medusa.customerEmail) missing.push("MEDUSA_CUSTOMER_EMAIL");
    if (!config.medusa.customerPassword) missing.push("MEDUSA_CUSTOMER_PASSWORD");
    if (missing.length > 0) {
      throw new Error(`Missing Medusa fallback login configuration: ${missing.join(", ")}`);
    }
  }

  async function login(): Promise<string> {
    assertFallbackLoginConfigured();
    cachedToken = await loginCustomer(
      config,
      config.medusa.customerEmail,
      config.medusa.customerPassword
    );
    tokenExpiresAt = Date.now() + config.medusa.tokenCacheMs;
    return cachedToken;
  }

  async function customerToken(identity: Identity | null): Promise<string> {
    if (identity?.medusaToken) return identity.medusaToken;
    if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
    return login();
  }

  // Authenticated store call on behalf of a customer, with one retry through the
  // shared fallback login when a cached (non per-customer) token has expired.
  async function customerRequest<T>(path: string, identity: Identity | null): Promise<T> {
    const token = await customerToken(identity);
    try {
      return await medusaRequest<T>(config, path, token);
    } catch (error) {
      if (!(error instanceof MedusaAuthError) || identity?.medusaToken) {
        throw error;
      }
      cachedToken = null;
      tokenExpiresAt = 0;
      return medusaRequest<T>(config, path, await login());
    }
  }

  // Catalog reads are public; they use the publishable key, not a customer token.
  function publicRequest<T>(path: string): Promise<T> {
    return medusaRequest<T>(config, path, null);
  }

  function regionQuery(): string {
    return config.medusa.regionId ? `&region_id=${encodeURIComponent(config.medusa.regionId)}` : "";
  }

  return {
    async getCurrentCustomer(identity) {
      const body = await customerRequest<{ customer?: MedusaCustomer }>(
        "/store/customers/me",
        identity
      );
      const customer = body?.customer ?? {};
      return {
        id: String(customer.id ?? "unknown"),
        displayName: customerDisplayName(customer),
        emailMasked: maskEmail(customer.email),
        loyaltyTier: null,
        defaultShop: "medusa",
      };
    },

    async listOrders(identity, filters: OrderFilters = {}) {
      const limit = Math.min(Math.max(Number(filters.limit ?? 10), 1), 25);
      const query = new URLSearchParams({
        limit: String(limit),
        offset: "0",
        fields: ORDER_FIELDS,
      });
      const body = await customerRequest<{ orders?: MedusaOrder[] }>(
        `/store/orders?${query.toString()}`,
        identity
      );
      const orders = Array.isArray(body?.orders) ? body.orders : [];
      const status = filters.status;

      return orders
        .filter(
          (order) =>
            !status ||
            order.status === status ||
            order.fulfillment_status === status ||
            order.payment_status === status
        )
        .slice(0, limit)
        .map(orderToSummary);
    },

    async getOrderDetails(identity, id) {
      const query = new URLSearchParams({ fields: ORDER_DETAIL_FIELDS });
      const body = await customerRequest<{ order?: MedusaOrder | null }>(
        `/store/orders/${encodeURIComponent(id)}?${query.toString()}`,
        identity
      );
      return orderToDetails(body?.order ?? null);
    },

    async getOrderTracking(identity, id) {
      const query = new URLSearchParams({
        fields: "id,fulfillment_status,fulfillments.*,fulfillments.labels.*",
      });
      const body = await customerRequest<{ order?: MedusaOrder | null }>(
        `/store/orders/${encodeURIComponent(id)}?${query.toString()}`,
        identity
      );
      return body?.order ? orderToTracking(body.order) : null;
    },

    async searchProducts(query: ProductSearchQuery = {}) {
      const limit = Math.min(Math.max(Number(query.limit ?? 10), 1), 25);
      const offset = Math.max(Number(query.offset ?? 0), 0);
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
        fields: PRODUCT_FIELDS,
      });
      if (query.query) params.set("q", query.query);
      const body = await publicRequest<{ products?: MedusaProduct[]; count?: number }>(
        `/store/products?${params.toString()}${regionQuery()}`
      );
      const products = Array.isArray(body?.products) ? body.products : [];
      return {
        products: products.map(productToSummary),
        count: Number(body?.count ?? products.length),
      };
    },

    async getProduct(id) {
      const params = new URLSearchParams({ fields: PRODUCT_FIELDS });
      const body = await publicRequest<{ product?: MedusaProduct | null }>(
        `/store/products/${encodeURIComponent(id)}?${params.toString()}${regionQuery()}`
      );
      return productToDetails(body?.product ?? null);
    },

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
  };
}
