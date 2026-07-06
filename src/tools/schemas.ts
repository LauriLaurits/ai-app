import { z } from "zod";

export const moneySchema = z.object({
  amount: z.number(),
  currency: z.string(),
});

export const orderSummarySchema = z.object({
  id: z.string(),
  orderedAt: z.string(),
  status: z.string(),
  fulfillment: z.string(),
  total: moneySchema,
  itemCount: z.number(),
});

export const orderDetailsSchema = orderSummarySchema.extend({
  items: z.array(
    z.object({
      sku: z.string().nullable().optional(),
      variantId: z.string().nullable(),
      productId: z.string().nullable(),
      name: z.string(),
      quantity: z.number(),
      unitPrice: moneySchema,
    })
  ),
  delivery: z.object({
    method: z.string(),
    status: z.string(),
    trackingCode: z.string().nullable(),
  }),
});

export const orderTrackingSchema = z.object({
  orderId: z.string(),
  fulfillment: z.string(),
  shipments: z.array(
    z.object({
      status: z.string(),
      trackingNumber: z.string().nullable(),
      trackingUrl: z.string().nullable(),
      shippedAt: z.string().nullable(),
      deliveredAt: z.string().nullable(),
    })
  ),
});

export const productSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  handle: z.string().nullable(),
  thumbnail: z.string().nullable(),
  price: moneySchema.nullable(),
  inStock: z.boolean(),
});

export const productDetailsSchema = productSummarySchema.extend({
  description: z.string().nullable(),
  variants: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      sku: z.string().nullable(),
      price: moneySchema.nullable(),
      inStock: z.boolean(),
    })
  ),
});

export const customerSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  emailMasked: z.string().nullable(),
  loyaltyTier: z.string().nullable(),
  defaultShop: z.string(),
});

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
