export interface AppConfig {
  port: number;
  mcpPath: string;
  publicBaseUrl: string;
  auth: {
    mode: string;
    mockBearerToken: string;
    issuer: string;
    audience: string;
    jwksUrl: string;
  };
  scopes: {
    profileRead: string;
    ordersRead: string;
    cartRead: string;
    cartWrite: string;
  };
  logging: {
    payloadMode: "off" | "error" | "all";
  };
  shop: {
    adapter: string;
  };
  checkout: {
    urlTemplate: string;
  };
  medusa: {
    baseUrl: string;
    publishableKey: string;
    customerEmail: string;
    customerPassword: string;
    tokenCacheMs: number;
    regionId: string;
  };
  broker: {
    clientId: string;
    redirectUris: string[];
    codeTtlSec: number;
    accessTokenTtlSec: number;
    refreshTokenTtlSec: number;
    storageNamespace: string;
  };
  rateLimit: {
    loginPerIp: number;
    loginPerEmail: number;
    windowSec: number;
  };
  storage: {
    upstashUrl: string;
    upstashToken: string;
  };
  openObserve: {
    ingestUrl: string;
    authHeader: string;
  };
  telemetry: {
    serviceName: string;
    serviceEnv: string;
    gitSha: string;
    deploymentUrl: string;
    vercelEnv: string | null;
    vercelRegion: string | null;
    hashSalt: string;
  };
}

export interface Money {
  amount: number;
  currency: string;
}

export interface OrderItem {
  sku: string | null;
  variantId: string | null;
  productId: string | null;
  name: string;
  quantity: number;
  unitPrice: Money;
}

export interface OrderSummary {
  id: string;
  orderedAt: string;
  status: string;
  fulfillment: string;
  total: Money;
  itemCount: number;
}

export interface OrderDelivery {
  method: string;
  status: string;
  trackingCode: string | null;
}

export interface OrderDetails extends OrderSummary {
  items: OrderItem[];
  delivery: OrderDelivery;
}

export interface CustomerProfile {
  id: string;
  displayName: string;
  emailMasked: string | null;
  loyaltyTier: string | null;
  defaultShop: string;
}

export interface OrderFilters {
  status?: string;
  limit?: number;
}

export interface ShipmentTracking {
  status: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
}

export interface OrderTracking {
  orderId: string;
  fulfillment: string;
  shipments: ShipmentTracking[];
}

export interface ProductVariantInfo {
  id: string;
  title: string;
  sku: string | null;
  price: Money | null;
  inStock: boolean;
}

export interface ProductSummary {
  id: string;
  title: string;
  handle: string | null;
  thumbnail: string | null;
  price: Money | null;
  inStock: boolean;
}

export interface ProductDetails extends ProductSummary {
  description: string | null;
  variants: ProductVariantInfo[];
}

export interface ProductSearchQuery {
  query?: string;
  limit?: number;
  offset?: number;
}

export interface ProductSearchResult {
  products: ProductSummary[];
  count: number;
}

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
  itemCount: number;
  total: Money;
}

export interface CartItemInput {
  variantId: string;
  quantity: number;
}

export interface Identity {
  userId: string;
  displayName: string;
  shopIds: string[];
  medusaToken?: string;
  emailMasked?: string | null;
}

export type AuthStatus = "authenticated" | "missing" | "invalid";

export interface AuthResult {
  status: AuthStatus;
  identity: Identity | null;
  scopes: string[];
  reason: string | null;
}

export interface ShopAdapter {
  getCurrentCustomer(identity: Identity): Promise<CustomerProfile>;
  listOrders(identity: Identity, filters?: OrderFilters): Promise<OrderSummary[]>;
  getOrderDetails(identity: Identity, orderId: string): Promise<OrderDetails | null>;
  getOrderTracking(identity: Identity, orderId: string): Promise<OrderTracking | null>;
  searchProducts(query: ProductSearchQuery): Promise<ProductSearchResult>;
  getProduct(id: string): Promise<ProductDetails | null>;
  getCart(identity: Identity): Promise<Cart | null>;
  addToCart(identity: Identity, item: CartItemInput): Promise<Cart>;
  updateCartItem(identity: Identity, lineItemId: string, quantity: number): Promise<Cart>;
}

export interface BrokerSession {
  customerId: string;
  displayName: string;
  emailMasked: string | null;
  scopes: string[];
  medusaToken: string;
  issuedAt?: string;
}

export interface AppLogger {
  info(eventName: string, payload?: Record<string, unknown>): void;
  warn(eventName: string, payload?: Record<string, unknown>): void;
  error(eventName: string, payload?: Record<string, unknown>): void;
}
