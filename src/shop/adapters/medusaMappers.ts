import { money, toNumber } from "../../money.js";
import type {
  Cart,
  CartLine,
  Money,
  OrderDetails,
  OrderItem,
  OrderSummary,
  OrderTracking,
  ProductDetails,
  ProductSummary,
  ProductVariantInfo,
  ShipmentTracking,
} from "../../types.js";

// Raw Medusa store API shapes. Only the fields we read are modeled; everything
// is optional because store responses vary by version and field selection.

export interface MedusaOrderItem {
  sku?: string | null;
  variant_sku?: string | null;
  variant?: { sku?: string | null } | null;
  product_title?: string | null;
  title?: string | null;
  variant_title?: string | null;
  product?: { title?: string | null } | null;
  quantity?: number | string;
  unit_price?: number | string;
  total?: number | string;
  subtotal?: number | string;
  variant_id?: string | null;
  product_id?: string | null;
}

export interface MedusaFulfillmentLabel {
  tracking_number?: string | null;
  tracking_url?: string | null;
}

export interface MedusaFulfillment {
  labels?: MedusaFulfillmentLabel[];
  packed_at?: string | null;
  shipped_at?: string | null;
  delivered_at?: string | null;
  canceled_at?: string | null;
}

export interface MedusaOrder {
  id?: string | number;
  display_id?: string | number;
  order_id?: string | number;
  status?: string;
  fulfillment_status?: string;
  payment_status?: string;
  created_at?: string;
  currency_code?: string;
  currency?: string;
  total?: number | string;
  item_total?: number | string;
  subtotal?: number | string;
  summary?: { total?: number | string };
  items?: MedusaOrderItem[];
  fulfillments?: MedusaFulfillment[];
  shipping_methods?: Array<{
    name?: string | null;
    shipping_option?: { name?: string | null } | null;
  }>;
}

export interface MedusaVariant {
  id?: string;
  title?: string | null;
  sku?: string | null;
  manage_inventory?: boolean;
  inventory_quantity?: number | null;
  calculated_price?: { calculated_amount?: number; amount?: number; currency_code?: string };
}

export interface MedusaProduct {
  id?: string;
  title?: string | null;
  handle?: string | null;
  description?: string | null;
  thumbnail?: string | null;
  variants?: MedusaVariant[];
}

function currencyOf(order: MedusaOrder): string | undefined {
  return order.currency_code ?? order.currency;
}

function orderId(order: MedusaOrder): string {
  return String(order.id ?? order.display_id ?? order.order_id);
}

function fulfillmentStatus(order: MedusaOrder): string {
  return String(order.fulfillment_status ?? "unknown");
}

function unitPriceMinor(
  item: Pick<MedusaOrderItem, "quantity" | "unit_price" | "total" | "subtotal">
): number | string {
  const quantity = Math.max(toNumber(item.quantity), 1);
  if (item.unit_price !== undefined) return item.unit_price;
  if (item.total !== undefined) return toNumber(item.total) / quantity;
  if (item.subtotal !== undefined) return toNumber(item.subtotal) / quantity;
  return 0;
}

function mapItems(order: MedusaOrder): OrderItem[] {
  const items = Array.isArray(order.items) ? order.items : [];
  const currency = currencyOf(order);

  return items.map((item) => ({
    sku: item.variant_sku ?? item.sku ?? item.variant?.sku ?? null,
    variantId: item.variant_id ?? null,
    productId: item.product_id ?? null,
    name:
      item.product_title ??
      item.title ??
      item.variant_title ??
      item.product?.title ??
      "Order item",
    quantity: toNumber(item.quantity),
    unitPrice: money(unitPriceMinor(item), currency),
  }));
}

export function orderToSummary(order: MedusaOrder): OrderSummary {
  return {
    id: orderId(order),
    orderedAt: String(order.created_at ?? ""),
    status: String(order.status ?? "unknown"),
    fulfillment: fulfillmentStatus(order),
    total: money(
      order.total ?? order.summary?.total ?? order.item_total ?? order.subtotal,
      currencyOf(order)
    ),
    itemCount: Array.isArray(order.items) ? order.items.length : 0,
  };
}

export function orderToDetails(order: MedusaOrder | null): OrderDetails | null {
  if (!order) return null;

  const shippingMethods = Array.isArray(order.shipping_methods)
    ? order.shipping_methods
    : [];
  const tracking = orderToTracking(order);

  return {
    ...orderToSummary(order),
    items: mapItems(order),
    delivery: {
      method:
        shippingMethods[0]?.name ?? shippingMethods[0]?.shipping_option?.name ?? "unknown",
      status: fulfillmentStatus(order),
      trackingCode: tracking.shipments[0]?.trackingNumber ?? null,
    },
  };
}

function shipmentStatus(fulfillment: MedusaFulfillment): string {
  if (fulfillment.canceled_at) return "canceled";
  if (fulfillment.delivered_at) return "delivered";
  if (fulfillment.shipped_at) return "shipped";
  if (fulfillment.packed_at) return "packed";
  return "pending";
}

export function orderToTracking(order: MedusaOrder): OrderTracking {
  const fulfillments = Array.isArray(order.fulfillments) ? order.fulfillments : [];

  const shipments: ShipmentTracking[] = fulfillments.map((fulfillment) => {
    const label = (fulfillment.labels ?? [])[0];
    return {
      status: shipmentStatus(fulfillment),
      trackingNumber: label?.tracking_number ?? null,
      trackingUrl: label?.tracking_url ?? null,
      shippedAt: fulfillment.shipped_at ?? null,
      deliveredAt: fulfillment.delivered_at ?? null,
    };
  });

  return { orderId: orderId(order), fulfillment: fulfillmentStatus(order), shipments };
}

function variantPrice(variant: MedusaVariant): Money | null {
  const price = variant.calculated_price;
  const amount = price?.calculated_amount ?? price?.amount;
  if (amount === undefined || price?.currency_code === undefined) return null;
  return money(amount, price.currency_code);
}

function variantInStock(variant: MedusaVariant): boolean {
  if (variant.manage_inventory === false) return true;
  return toNumber(variant.inventory_quantity) > 0;
}

function cheapestPrice(variants: MedusaVariant[]): Money | null {
  const prices = variants
    .map(variantPrice)
    .filter((price): price is Money => price !== null);
  if (prices.length === 0) return null;
  return prices.reduce((min, price) => (price.amount < min.amount ? price : min));
}

export function productToSummary(product: MedusaProduct): ProductSummary {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  return {
    id: String(product.id ?? "unknown"),
    title: String(product.title ?? "Product"),
    handle: product.handle ?? null,
    thumbnail: product.thumbnail ?? null,
    price: cheapestPrice(variants),
    inStock: variants.some(variantInStock),
  };
}

export function productToDetails(product: MedusaProduct | null): ProductDetails | null {
  if (!product) return null;

  const variants = Array.isArray(product.variants) ? product.variants : [];
  const variantInfos: ProductVariantInfo[] = variants.map((variant) => ({
    id: String(variant.id ?? "unknown"),
    title: String(variant.title ?? "Default"),
    sku: variant.sku ?? null,
    price: variantPrice(variant),
    inStock: variantInStock(variant),
  }));

  return {
    ...productToSummary(product),
    description: product.description ?? null,
    variants: variantInfos,
  };
}

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
