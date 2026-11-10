import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  boolean,
  doublePrecision,
  serial,
} from "drizzle-orm/pg-core";

export type BagItem = { name: string; count: number; allergens: string[] };

export type BagCheck = {
  expected: { name: string; count: number }[];
  found: { name: string; count: number }[];
  missing: { name: string; count: number }[];
  fraction: number; // share of the bag's listed value that was handed over (0..1)
  confidence: number; // 0..1
  summary: string;
  photo?: string; // data URL of the handover photo (downscaled)
};

export const shops = pgTable("shops", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // bakery, cafe, restaurant ...
  address: text("address").notNull(),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  closesAt: text("closes_at").notNull(), // "21:00"
  minPricePct: integer("min_price_pct").notNull().default(30), // never sell below 30% of value
  noShowFeePct: integer("no_show_fee_pct").notNull().default(0), // 0 = buyers never pay for no-shows
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const listings = pgTable("listings", {
  id: text("id").primaryKey(),
  shopId: text("shop_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  contents: jsonb("contents").$type<BagItem[]>().notNull(),
  tags: jsonb("tags").$type<string[]>().notNull().default([]), // vegetarian, vegan, ...
  valueCents: integer("value_cents").notNull(), // what it would cost at full price
  priceCents: integer("price_cents").notNull(),
  quantity: integer("quantity").notNull(),
  remaining: integer("remaining").notNull(),
  weightGrams: integer("weight_grams").notNull().default(400), // per bag, for impact maths
  pickupStart: timestamp("pickup_start", { withTimezone: true }).notNull(),
  pickupEnd: timestamp("pickup_end", { withTimezone: true }).notNull(),
  photo: text("photo"), // downscaled data URL
  aiNotes: text("ai_notes").notNull().default(""),
  status: text("status").notNull().default("live"), // live | sold_out | cancelled | closed
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reservations = pgTable("reservations", {
  id: text("id").primaryKey(),
  listingId: text("listing_id").notNull(),
  shopId: text("shop_id").notNull(),
  buyerName: text("buyer_name").notNull(),
  channel: text("channel").notNull(), // app | agent
  agentName: text("agent_name"),
  mandateId: text("mandate_id"),
  paypalOrderId: text("paypal_order_id"),
  authorizationId: text("authorization_id"),
  amountCents: integer("amount_cents").notNull(),
  capturedCents: integer("captured_cents").notNull().default(0),
  // pending_approval | held | captured | voided | expired | failed
  status: text("status").notNull().default("pending_approval"),
  pickupCode: text("pickup_code").notNull(),
  bagCheck: jsonb("bag_check").$type<BagCheck>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const mandates = pgTable("mandates", {
  id: text("id").primaryKey(),
  buyerName: text("buyer_name").notNull(),
  agentName: text("agent_name").notNull().default("Personal AI assistant"),
  token: text("token").notNull(), // bearer secret the agent uses
  vaultId: text("vault_id"), // PayPal payment token (saved PayPal) for agent-initiated holds
  paypalCustomerId: text("paypal_customer_id"),
  maxPerOrderCents: integer("max_per_order_cents").notNull().default(600),
  maxPerWeekCents: integer("max_per_week_cents").notNull().default(2500),
  preferences: text("preferences").notNull().default(""), // plain language: "vegetarian, no nuts"
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  radiusKm: doublePrecision("radius_km").notNull().default(1.5),
  earliestPickup: text("earliest_pickup").notNull().default("17:00"),
  standingOrder: boolean("standing_order").notNull().default(true),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  shopId: text("shop_id"),
  listingId: text("listing_id"),
  reservationId: text("reservation_id"),
  mandateId: text("mandate_id"),
  actor: text("actor").notNull(), // shop | buyer | agent | ai | paypal | system
  type: text("type").notNull(),
  message: text("message").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Shop = typeof shops.$inferSelect;
export type Listing = typeof listings.$inferSelect;
export type Reservation = typeof reservations.$inferSelect;
export type Mandate = typeof mandates.$inferSelect;
export type EventRow = typeof events.$inferSelect;
