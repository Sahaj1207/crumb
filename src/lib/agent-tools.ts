import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "./db";
import type { Mandate } from "./db/schema";
import { agentReserve, buyerCancel, distanceKm, evaluateMandate, getListing, getShop, money, sweepExpired } from "./core";
import { hhmm } from "./time";

/**
 * The buyer-side agent toolset. Exposed over MCP (/api/mcp) for any AI assistant
 * and reused by the in-app agent console. Every tool acts *as one mandate* and
 * can never exceed its limits — the limits are enforced in core.ts, not by the model.
 */

const base = () => process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") ?? "";

export async function findSurplusFood(m: Mandate, args: { query?: string; max_price_usd?: number }) {
  await sweepExpired();
  const db = await getDb();
  const rows = await db
    .select({ l: schema.listings, s: schema.shops })
    .from(schema.listings)
    .innerJoin(schema.shops, eq(schema.shops.id, schema.listings.shopId))
    .where(eq(schema.listings.status, "live"))
    .orderBy(desc(schema.listings.createdAt))
    .limit(50);
  const q = args.query?.toLowerCase().trim();
  const results = rows
    .map(({ l, s }) => ({ l, s, km: distanceKm(m, s) }))
    .filter(({ l }) => l.remaining > 0)
    .filter(({ l }) => (args.max_price_usd ? l.priceCents <= args.max_price_usd * 100 : true))
    .filter(({ l, s }) =>
      q
        ? [l.title, l.description, s.name, s.kind, ...l.tags, ...l.contents.map((c) => c.name)].join(" ").toLowerCase().includes(q) ||
          q.split(/\s+/).some((w) => w.length > 3 && [l.title, ...l.tags, ...l.contents.map((c) => c.name)].join(" ").toLowerCase().includes(w))
        : true,
    )
    .sort((a, b) => a.km - b.km)
    .slice(0, 10)
    .map(({ l, s, km }) => ({
      listing_id: l.id,
      title: l.title,
      shop: s.name,
      distance_km: Math.round(km * 100) / 100,
      within_your_radius: km <= m.radiusKm,
      price: money(l.priceCents),
      worth: money(l.valueCents),
      contents: l.contents.map((c) => `${c.count} x ${c.name}${c.allergens.length ? ` [${c.allergens.join(", ")}]` : ""}`),
      tags: l.tags,
      bags_left: l.remaining,
      pickup_until: hhmm(l.pickupEnd),
      url: `${base()}/l/${l.id}`,
    }));
  return { owner: m.buyerName, results, note: results.length ? undefined : "No live surplus bags match right now." };
}

export async function checkMandate(m: Mandate, args: { listing_id: string }) {
  const listing = await getListing(args.listing_id);
  const shop = await getShop(listing.shopId);
  const checks = await evaluateMandate(m, listing, shop);
  return {
    listing: listing.title,
    shop: shop.name,
    allowed: checks.every((c) => c.ok),
    checks: checks.map((c) => `${c.ok ? "PASS" : "FAIL"} ${c.rule}: ${c.detail}`),
  };
}

export async function reserveBag(m: Mandate, args: { listing_id: string }) {
  const res = await agentReserve(m, args.listing_id, "agent_request");
  if (!res.reserved) {
    return {
      reserved: false,
      reason: "Blocked by the owner's rules (enforced by Crumb, not by you)",
      checks: res.checks.map((c) => `${c.ok ? "PASS" : "FAIL"} ${c.rule}: ${c.detail}`),
    };
  }
  const r = res.reservation;
  const listing = await getListing(r.listingId);
  const shop = await getShop(r.shopId);
  return {
    reserved: true,
    reservation_id: r.id,
    pickup_code: r.pickupCode,
    shop: shop.name,
    address: shop.address,
    pickup_until: hhmm(listing.pickupEnd),
    payment: `${money(r.amountCents)} is HELD on ${m.buyerName}'s saved PayPal, not charged. It is only captured when the food is handed over, and only for what is actually in the bag.`,
    ticket_url: `${base()}/r/${r.id}`,
  };
}

export async function myReservations(m: Mandate) {
  const db = await getDb();
  const rows = await db
    .select({ r: schema.reservations, l: schema.listings, s: schema.shops })
    .from(schema.reservations)
    .innerJoin(schema.listings, eq(schema.listings.id, schema.reservations.listingId))
    .innerJoin(schema.shops, eq(schema.shops.id, schema.reservations.shopId))
    .where(and(eq(schema.reservations.mandateId, m.id), inArray(schema.reservations.status, ["held", "captured", "voided", "expired"])))
    .orderBy(desc(schema.reservations.createdAt))
    .limit(10);
  return {
    reservations: rows.map(({ r, l, s }) => ({
      reservation_id: r.id,
      status: r.status,
      bag: l.title,
      shop: s.name,
      pickup_code: r.status === "held" ? r.pickupCode : undefined,
      held: money(r.amountCents),
      charged: money(r.capturedCents),
      pickup_until: hhmm(l.pickupEnd),
    })),
  };
}

export async function cancelReservation(m: Mandate, args: { reservation_id: string }) {
  return buyerCancel(args.reservation_id, m.id);
}

export async function mandateSummary(m: Mandate) {
  return {
    owner: m.buyerName,
    agent: m.agentName,
    saved_paypal: !!m.vaultId,
    max_per_order: money(m.maxPerOrderCents),
    max_per_week: money(m.maxPerWeekCents),
    radius_km: m.radiusKm,
    earliest_pickup: m.earliestPickup,
    preferences: m.preferences || "none",
    standing_order: m.standingOrder,
  };
}
