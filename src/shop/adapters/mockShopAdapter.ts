import { CartNotFoundError } from "../cartErrors.js";
import type {
  Cart,
  CartItemInput,
  CartLine,
  CustomerProfile,
  Identity,
  OrderDetails,
  OrderFilters,
  OrderSummary,
  OrderTracking,
  ProductDetails,
  ProductSearchQuery,
  ProductSummary,
  ProductVariantInfo,
  ShopAdapter,
} from "../../types.js";

const customers: Record<string, CustomerProfile> = {
  "demo-user-1": {
    id: "customer-demo-1",
    displayName: "Demo Customer",
    emailMasked: "de***@example.com",
    loyaltyTier: "standard",
    defaultShop: "apotheka",
  },
};

const orders: Record<string, OrderDetails[]> = {
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
      ],
      delivery: {
        method: "pickup",
        status: "ready_soon",
        trackingCode: null,
      },
    },
  ],
};

const products: ProductDetails[] = [
  {
    id: "prod_demo_vitamin_d",
    title: "Vitamin D supplement",
    handle: "vitamin-d",
    thumbnail: null,
    price: { amount: 12.9, currency: "EUR" },
    inStock: true,
    description: "Daily vitamin D3 supplement.",
    variants: [
      {
        id: "var_demo_vit_d_60",
        title: "60 tablets",
        sku: "demo-vit-d",
        price: { amount: 12.9, currency: "EUR" },
        inStock: true,
      },
    ],
  },
  {
    id: "prod_demo_toothpaste",
    title: "Sensitive toothpaste",
    handle: "sensitive-toothpaste",
    thumbnail: null,
    price: { amount: 6.4, currency: "EUR" },
    inStock: false,
    description: "Toothpaste for sensitive teeth.",
    variants: [
      {
        id: "var_demo_toothpaste",
        title: "75ml",
        sku: "demo-toothpaste",
        price: { amount: 6.4, currency: "EUR" },
        inStock: false,
      },
    ],
  },
];

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

function currentOrders(identity: Identity): OrderDetails[] {
  return orders[identity.userId] ?? [];
}

function toProductSummary(product: ProductDetails): ProductSummary {
  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    thumbnail: product.thumbnail,
    price: product.price,
    inStock: product.inStock,
  };
}

function toTracking(order: OrderDetails): OrderTracking {
  return {
    orderId: order.id,
    fulfillment: order.fulfillment,
    shipments: [
      {
        status: order.delivery.status,
        trackingNumber: order.delivery.trackingCode,
        trackingUrl: null,
        shippedAt: null,
        deliveredAt: null,
      },
    ],
  };
}

function toSummary(order: OrderDetails): OrderSummary {
  return {
    id: order.id,
    orderedAt: order.orderedAt,
    status: order.status,
    fulfillment: order.fulfillment,
    total: order.total,
    itemCount: order.itemCount,
  };
}

export function createMockShopAdapter(): ShopAdapter {
  const carts = new Map<string, Cart>();
  return {
    async getCurrentCustomer(identity) {
      return (
        customers[identity.userId] ?? {
          id: `customer-${identity.userId}`,
          displayName: identity.displayName,
          emailMasked: null,
          loyaltyTier: null,
          defaultShop: identity.shopIds[0] ?? "apotheka",
        }
      );
    },

    async listOrders(identity, filters: OrderFilters = {}) {
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

    async getOrderTracking(identity, orderId) {
      const order = currentOrders(identity).find((entry) => entry.id === orderId);
      return order ? toTracking(order) : null;
    },

    async searchProducts(query: ProductSearchQuery = {}) {
      const limit = Math.min(Math.max(Number(query.limit ?? 10), 1), 25);
      const offset = Math.max(Number(query.offset ?? 0), 0);
      const term = query.query?.toLowerCase();
      const matched = products.filter(
        (product) => !term || product.title.toLowerCase().includes(term)
      );
      return {
        products: matched.slice(offset, offset + limit).map(toProductSummary),
        count: matched.length,
      };
    },

    async getProduct(id) {
      return products.find((product) => product.id === id) ?? null;
    },

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
        throw new CartNotFoundError(
          `No cart line item ${lineItemId}. Use view_cart to see current line items.`
        );
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
  };
}
