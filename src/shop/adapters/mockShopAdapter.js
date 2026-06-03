const customers = {
  "demo-user-1": {
    id: "customer-demo-1",
    displayName: "Demo Customer",
    emailMasked: "de***@example.com",
    loyaltyTier: "standard",
    defaultShop: "apotheka",
  },
};

const orders = {
  "demo-user-1": [
    {
      id: "APT-100045",
      orderedAt: "2026-05-28T10:12:00.000Z",
      status: "delivered",
      fulfillment: "parcel_locker",
      total: { amount: 42.6, currency: "EUR" },
      itemCount: 3,
      items: [
        {
          sku: "demo-vit-d",
          name: "Vitamin D supplement",
          quantity: 1,
          unitPrice: { amount: 12.9, currency: "EUR" },
        },
        {
          sku: "demo-bandages",
          name: "Elastic bandage",
          quantity: 2,
          unitPrice: { amount: 4.5, currency: "EUR" },
        },
        {
          sku: "demo-care",
          name: "Skin care cream",
          quantity: 1,
          unitPrice: { amount: 20.7, currency: "EUR" },
        },
      ],
      delivery: {
        method: "parcel_locker",
        status: "delivered",
        trackingCode: "DEMO-TRACK-100045",
      },
    },
    {
      id: "APT-100052",
      orderedAt: "2026-06-01T13:45:00.000Z",
      status: "processing",
      fulfillment: "pickup",
      total: { amount: 18.2, currency: "EUR" },
      itemCount: 2,
      items: [
        {
          sku: "demo-toothpaste",
          name: "Sensitive toothpaste",
          quantity: 1,
          unitPrice: { amount: 6.4, currency: "EUR" },
        },
        {
          sku: "demo-mouthwash",
          name: "Mouthwash",
          quantity: 1,
          unitPrice: { amount: 11.8, currency: "EUR" },
        },
      ],
      delivery: {
        method: "pickup",
        status: "ready_soon",
        trackingCode: null,
      },
    },
  ],
};

function currentOrders(identity) {
  return orders[identity.userId] ?? [];
}

function toSummary(order) {
  return {
    id: order.id,
    orderedAt: order.orderedAt,
    status: order.status,
    fulfillment: order.fulfillment,
    total: order.total,
    itemCount: order.itemCount,
  };
}

export function createMockShopAdapter() {
  return {
    async getCurrentCustomer(identity) {
      return customers[identity.userId] ?? {
        id: `customer-${identity.userId}`,
        displayName: identity.displayName,
        emailMasked: null,
        loyaltyTier: null,
        defaultShop: identity.shopIds[0] ?? "apotheka",
      };
    },

    async listOrders(identity, filters = {}) {
      const limit = Math.min(Math.max(Number(filters.limit ?? 10), 1), 25);
      const status = filters.status;

      return currentOrders(identity)
        .filter((order) => !status || order.status === status)
        .slice(0, limit)
        .map(toSummary);
    },

    async getOrderDetails(identity, orderId) {
      return currentOrders(identity).find((order) => order.id === orderId) ?? null;
    },
  };
}
