import {
  customerDisplayName,
  loginCustomer,
  maskEmail,
  MedusaAuthError,
  medusaRequest,
  type MedusaCustomer,
} from "../../medusa/client.js";
import type {
  AppConfig,
  Identity,
  Money,
  OrderDetails,
  OrderFilters,
  OrderItem,
  OrderSummary,
  ShopAdapter,
} from "../../types.js";

interface MedusaOrderItem {
  sku?: string | null;
  variant_sku?: string | null;
  variant?: { sku?: string | null } | null;
  product_title?: string | null;
  title?: string | null;
  variant_title?: string | null;
  product?: { title?: string | null } | null;
  quantity?: number | string;
  unit_price?: number | string;
  unitPrice?: number | string;
  total?: number | string;
  subtotal?: number | string;
}

interface MedusaOrder {
  id?: string | number;
  display_id?: string | number;
  order_id?: string | number;
  status?: string;
  fulfillment_status?: string;
  fulfillmentStatus?: string;
  payment_status?: string;
  created_at?: string;
  createdAt?: string;
  order_date?: string;
  total?: number | string;
  item_total?: number | string;
  subtotal?: number | string;
  summary?: { total?: number | string };
  currency_code?: string;
  currency?: string;
  items?: MedusaOrderItem[];
  shipping_methods?: Array<{
    name?: string | null;
    shipping_option?: { name?: string | null } | null;
  }>;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return 0;
}

function money(amount: unknown, currencyCode: unknown): Money {
  return {
    amount: toNumber(amount),
    currency: String(currencyCode ?? "EUR").toUpperCase(),
  };
}

function itemUnitPrice(item: MedusaOrderItem): number | string {
  const quantity = Math.max(toNumber(item.quantity), 1);
  if (item.unit_price !== undefined) return item.unit_price;
  if (item.unitPrice !== undefined) return item.unitPrice;
  if (item.total !== undefined) return toNumber(item.total) / quantity;
  if (item.subtotal !== undefined) return toNumber(item.subtotal) / quantity;
  return 0;
}

function orderId(order: MedusaOrder): string {
  return String(order.id ?? order.display_id ?? order.order_id);
}

function orderStatus(order: MedusaOrder): string {
  return String(order.status ?? "unknown");
}

function fulfillmentStatus(order: MedusaOrder): string {
  return String(order.fulfillment_status ?? order.fulfillmentStatus ?? "unknown");
}

function orderDate(order: MedusaOrder): string {
  return String(order.created_at ?? order.createdAt ?? order.order_date ?? "");
}

function orderTotal(order: MedusaOrder): Money {
  return money(
    order.total ?? order.summary?.total ?? order.item_total ?? order.subtotal,
    order.currency_code ?? order.currency
  );
}

function orderItems(order: MedusaOrder): OrderItem[] {
  const items = Array.isArray(order.items) ? order.items : [];
  const currency = order.currency_code ?? order.currency;

  return items.map((item) => ({
    sku: item.variant_sku ?? item.sku ?? item.variant?.sku ?? null,
    name:
      item.product_title ??
      item.title ??
      item.variant_title ??
      item.product?.title ??
      "Order item",
    quantity: toNumber(item.quantity),
    unitPrice: money(itemUnitPrice(item), currency),
  }));
}

function delivery(order: MedusaOrder): OrderDetails["delivery"] {
  const shippingMethods = Array.isArray(order.shipping_methods)
    ? order.shipping_methods
    : [];
  const method = shippingMethods[0]?.name ?? shippingMethods[0]?.shipping_option?.name;

  return {
    method: method ?? "unknown",
    status: fulfillmentStatus(order),
    trackingCode: null,
  };
}

function toSummary(order: MedusaOrder): OrderSummary {
  return {
    id: orderId(order),
    orderedAt: orderDate(order),
    status: orderStatus(order),
    fulfillment: fulfillmentStatus(order),
    total: orderTotal(order),
    itemCount: Array.isArray(order.items) ? order.items.length : 0,
  };
}

function toDetails(order: MedusaOrder | null): OrderDetails | null {
  if (!order) return null;

  return {
    ...toSummary(order),
    items: orderItems(order),
    delivery: delivery(order),
  };
}

export function createMedusaAdapter(config: AppConfig): ShopAdapter {
  let cachedToken: string | null = null;
  let tokenExpiresAt = 0;

  function assertFallbackLoginConfigured(): void {
    const missing: string[] = [];
    if (!config.medusa.customerEmail) missing.push("MEDUSA_CUSTOMER_EMAIL");
    if (!config.medusa.customerPassword) missing.push("MEDUSA_CUSTOMER_PASSWORD");

    if (missing.length > 0) {
      throw new Error(
        `Missing Medusa fallback login configuration: ${missing.join(", ")}`
      );
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

  async function token(identity: Identity | null): Promise<string> {
    if (identity?.medusaToken) {
      return identity.medusaToken;
    }

    if (cachedToken && Date.now() < tokenExpiresAt) {
      return cachedToken;
    }

    return login();
  }

  async function storeRequest<T>(
    path: string,
    identity: Identity | null
  ): Promise<T> {
    const bearer = await token(identity);

    try {
      return await medusaRequest<T>(config, path, bearer);
    } catch (error) {
      if (!(error instanceof MedusaAuthError)) {
        throw error;
      }

      // Per-customer broker tokens cannot be re-minted here; the caller must
      // surface an auth challenge so ChatGPT re-authenticates the user.
      if (identity?.medusaToken) {
        throw error;
      }

      cachedToken = null;
      tokenExpiresAt = 0;
      const freshBearer = await login();
      return medusaRequest<T>(config, path, freshBearer);
    }
  }

  return {
    async getCurrentCustomer(identity) {
      const body = await storeRequest<{ customer?: MedusaCustomer }>(
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
        fields:
          "id,display_id,created_at,status,fulfillment_status,payment_status,currency_code,total,item_total,subtotal,items.*",
      });

      const body = await storeRequest<{ orders?: MedusaOrder[] }>(
        `/store/orders?${query.toString()}`,
        identity
      );
      const status = filters.status;
      const orders = Array.isArray(body?.orders) ? body.orders : [];

      return orders
        .filter((order) => {
          if (!status) return true;
          return (
            order.status === status ||
            order.fulfillment_status === status ||
            order.payment_status === status
          );
        })
        .slice(0, limit)
        .map(toSummary);
    },

    async getOrderDetails(identity, id) {
      const body = await storeRequest<{ order?: MedusaOrder | null }>(
        `/store/orders/${encodeURIComponent(id)}`,
        identity
      );
      return toDetails(body?.order ?? null);
    },
  };
}
