function normalizeBaseUrl(value) {
  return String(value ?? "").replace(/\/+$/, "");
}

function toNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return 0;
}

function money(amount, currencyCode) {
  return {
    amount: toNumber(amount),
    currency: String(currencyCode ?? "EUR").toUpperCase(),
  };
}

function itemUnitPrice(item) {
  const quantity = Math.max(toNumber(item.quantity), 1);
  if (item.unit_price !== undefined) return item.unit_price;
  if (item.unitPrice !== undefined) return item.unitPrice;
  if (item.total !== undefined) return toNumber(item.total) / quantity;
  if (item.subtotal !== undefined) return toNumber(item.subtotal) / quantity;
  return 0;
}

function displayName(customer) {
  const parts = [customer.first_name, customer.last_name].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "Customer";
}

function maskEmail(email) {
  if (!email || !String(email).includes("@")) return null;
  const [name, domain] = String(email).split("@");
  const visible = name.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(name.length - visible.length, 3))}@${domain}`;
}

function orderId(order) {
  return String(order.id ?? order.display_id ?? order.order_id);
}

function orderStatus(order) {
  return String(order.status ?? "unknown");
}

function fulfillmentStatus(order) {
  return String(order.fulfillment_status ?? order.fulfillmentStatus ?? "unknown");
}

function orderDate(order) {
  return String(order.created_at ?? order.createdAt ?? order.order_date ?? "");
}

function orderTotal(order) {
  return money(
    order.total ?? order.summary?.total ?? order.item_total ?? order.subtotal,
    order.currency_code ?? order.currency
  );
}

function orderItems(order) {
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

function delivery(order) {
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

function toSummary(order) {
  return {
    id: orderId(order),
    orderedAt: orderDate(order),
    status: orderStatus(order),
    fulfillment: fulfillmentStatus(order),
    total: orderTotal(order),
    itemCount: Array.isArray(order.items) ? order.items.length : 0,
  };
}

function toDetails(order) {
  if (!order) return null;

  return {
    ...toSummary(order),
    items: orderItems(order),
    delivery: delivery(order),
  };
}

export function createMedusaAdapter(config) {
  const baseUrl = normalizeBaseUrl(config.medusa.baseUrl);
  let cachedToken = null;
  let tokenExpiresAt = 0;

  function assertConfigured() {
    const missing = [];
    if (!baseUrl) missing.push("MEDUSA_BASE_URL");
    if (!config.medusa.publishableKey) missing.push("MEDUSA_PUBLISHABLE_KEY");
    if (!config.medusa.customerEmail) missing.push("MEDUSA_CUSTOMER_EMAIL");
    if (!config.medusa.customerPassword) missing.push("MEDUSA_CUSTOMER_PASSWORD");

    if (missing.length > 0) {
      throw new Error(`Missing Medusa configuration: ${missing.join(", ")}`);
    }
  }

  async function request(path, options = {}) {
    assertConfigured();

    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        "content-type": "application/json",
        "x-publishable-api-key": config.medusa.publishableKey,
        ...options.headers,
      },
    });

    const bodyText = await response.text();
    const body = bodyText ? JSON.parse(bodyText) : null;

    if (!response.ok) {
      throw new Error(
        `Medusa request failed: ${response.status} ${body?.message ?? response.statusText}`
      );
    }

    return body;
  }

  async function login() {
    const body = await request("/auth/customer/emailpass", {
      method: "POST",
      body: JSON.stringify({
        email: config.medusa.customerEmail,
        password: config.medusa.customerPassword,
      }),
    });

    if (!body?.token) {
      throw new Error("Medusa login did not return a token");
    }

    cachedToken = body.token;
    tokenExpiresAt = Date.now() + config.medusa.tokenCacheMs;
    return cachedToken;
  }

  async function token() {
    if (cachedToken && Date.now() < tokenExpiresAt) {
      return cachedToken;
    }

    return login();
  }

  async function storeRequest(path, options = {}) {
    const bearer = await token();

    try {
      return await request(path, {
        ...options,
        headers: {
          Authorization: `Bearer ${bearer}`,
          ...options.headers,
        },
      });
    } catch (error) {
      if (!String(error?.message ?? "").includes("401")) {
        throw error;
      }

      cachedToken = null;
      tokenExpiresAt = 0;
      const freshBearer = await login();
      return request(path, {
        ...options,
        headers: {
          Authorization: `Bearer ${freshBearer}`,
          ...options.headers,
        },
      });
    }
  }

  return {
    async getCurrentCustomer() {
      const body = await storeRequest("/store/customers/me");
      const customer = body?.customer ?? {};

      return {
        id: String(customer.id ?? "unknown"),
        displayName: displayName(customer),
        emailMasked: maskEmail(customer.email),
        loyaltyTier: null,
        defaultShop: "medusa",
      };
    },

    async listOrders(_identity, filters = {}) {
      const limit = Math.min(Math.max(Number(filters.limit ?? 10), 1), 25);
      const query = new URLSearchParams({
        limit: String(limit),
        offset: "0",
        fields:
          "id,display_id,created_at,status,fulfillment_status,payment_status,currency_code,total,item_total,subtotal,items.*",
      });

      const body = await storeRequest(`/store/orders?${query.toString()}`);
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

    async getOrderDetails(_identity, id) {
      const body = await storeRequest(`/store/orders/${encodeURIComponent(id)}`);
      return toDetails(body?.order ?? null);
    },
  };
}
