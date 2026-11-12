import "server-only";
import { and, eq, gte, inArray, lt, sql, desc } from "drizzle-orm";
import { customAlphabet, nanoid } from "nanoid";
import { getDb, schema } from "./db";
import type { Listing, Mandate, Reservation, Shop, BagCheck } from "./db/schema";
import { paypal, PayPalError } from "./paypal";
import { checkBag, judgeFit } from "./ai";
import { hhmm, minutesOfDay } from "./time";

const { shops, listings, reservations, mandates, events } = schema;
const pickupCodeGen = customAlphabet("0123456789", 6);
export const money = (c: number) => `$${(c / 100).toFixed(2)}`;

export class CrumbError extends Error {
  constructor(message: string, public status = 400, public code = "bad_request") {
    super(message);
  }
}

// ------------------------------------------------------------------ audit trail
export async function logEvent(e: {
  actor: "shop" | "buyer" | "agent" | "ai" | "paypal" | "system";
  type: string;
  message: string;
  shopId?: string | null;
  listingId?: string | null;
  reservationId?: string | null;
  mandateId?: string | null;
  data?: Record<string, unknown>;
}) {
  const db = await getDb();
  await db.insert(events).values({
    actor: e.actor,
    type: e.type,
    message: e.message,
    shopId: e.shopId ?? null,
    listingId: e.listingId ?? null,
    reservationId: e.reservationId ?? null,
    mandateId: e.mandateId ?? null,
    data: e.data ?? null,
  });
}

// ------------------------------------------------------------------ lookups
export async function getShop(id: string): Promise<Shop> {
  const db = await getDb();
  const [s] = await db.select().from(shops).where(eq(shops.id, id));
  if (!s) throw new CrumbError("Shop not found", 404, "not_found");
  return s;
}

export async function getListing(id: string): Promise<Listing> {
  const db = await getDb();
  const [l] = await db.select().from(listings).where(eq(listings.id, id));
  if (!l) throw new CrumbError("Listing not found", 404, "not_found");
  return l;
}

export async function getReservation(id: string): Promise<Reservation> {
  const db = await getDb();
  const [r] = await db.select().from(reservations).where(eq(reservations.id, id));
  if (!r) throw new CrumbError("Reservation not found", 404, "not_found");
  return r;
}

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ------------------------------------------------------------------ inventory
async function takeOne(listingId: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .update(listings)
    .set({ remaining: sql`${listings.remaining} - 1` })
    .where(and(eq(listings.id, listingId), eq(listings.status, "live"), sql`${listings.remaining} > 0`))
    .returning({ remaining: listings.remaining });
  if (!rows.length) return false;
  if (rows[0].remaining === 0) {
    await db.update(listings).set({ status: "sold_out" }).where(eq(listings.id, listingId));
  }
  return true;
}

async function giveBack(listingId: string) {
  const db = await getDb();
  await db
    .update(listings)
    .set({
      remaining: sql`${listings.remaining} + 1`,
      status: sql`CASE WHEN ${listings.status} = 'sold_out' THEN 'live' ELSE ${listings.status} END`,
    })
    .where(eq(listings.id, listingId));
}

async function newPickupCode(): Promise<string> {
  const db = await getDb();
  for (let i = 0; i < 10; i++) {
    const code = pickupCodeGen();
    const clash = await db
      .select({ id: reservations.id })
      .from(reservations)
      .where(and(eq(reservations.pickupCode, code), inArray(reservations.status, ["pending_approval", "held"])));
    if (!clash.length) return code;
  }
  throw new CrumbError("Could not allocate a pickup code", 500, "internal");
}

function isLive(l: Listing) {
  return l.status === "live" && l.remaining > 0 && new Date(l.pickupEnd).getTime() > Date.now();
}

// ------------------------------------------------------------------ app reservation (buyer approves in PayPal)
export async function startAppReservation(listingId: string, buyerName: string) {
  const listing = await getListing(listingId);
  if (!isLive(listing)) throw new CrumbError("This bag is no longer available", 409, "unavailable");
  const shop = await getShop(listing.shopId);
  if (!(await takeOne(listingId))) throw new CrumbError("Just sold out — sorry!", 409, "sold_out");

  const db = await getDb();
  const id = `res_${nanoid(12)}`;
  const pickupCode = await newPickupCode();
  await db.insert(reservations).values({
    id,
    listingId,
    shopId: shop.id,
    buyerName: buyerName.trim().slice(0, 60) || "Guest",
    channel: "app",
    amountCents: listing.priceCents,
    status: "pending_approval",
    pickupCode,
  });
  try {
    const order = await paypal.createHoldOrder({
      reservationId: id,
      amountCents: listing.priceCents,
      description: `${listing.title} — ${shop.name}`,
      shopName: shop.name,
    });
    await db.update(reservations).set({ paypalOrderId: order.orderId, updatedAt: new Date() }).where(eq(reservations.id, id));
    await logEvent({
      actor: "paypal",
      type: "order.created",
      message: `PayPal order ${order.orderId} created for ${money(listing.priceCents)} (intent AUTHORIZE — a hold, not a charge)`,
      shopId: shop.id,
      listingId,
      reservationId: id,
      data: { orderId: order.orderId },
    });
    return { reservationId: id, orderId: order.orderId };
  } catch (err) {
    await db.update(reservations).set({ status: "failed", updatedAt: new Date() }).where(eq(reservations.id, id));
    await giveBack(listingId);
    throw err;
  }
}

/** Buyer approved in PayPal: place the hold. */
export async function confirmAppReservation(reservationId: string, orderId: string) {
  const r = await getReservation(reservationId);
  if (r.paypalOrderId !== orderId) throw new CrumbError("Order does not match reservation", 400);
  if (r.status === "held") return r;
  if (r.status !== "pending_approval") throw new CrumbError(`Reservation is ${r.status}`, 409);
  const auth = await paypal.authorizeOrder(orderId);
  const db = await getDb();
  const [updated] = await db
    .update(reservations)
    .set({ status: "held", authorizationId: auth.authorizationId, updatedAt: new Date() })
    .where(eq(reservations.id, reservationId))
    .returning();
  await logEvent({
    actor: "paypal",
    type: "authorization.created",
    message: `${money(r.amountCents)} held on ${r.buyerName}'s PayPal (authorization ${auth.authorizationId}). Nothing charged until the food is in their hand.`,
    shopId: r.shopId,
    listingId: r.listingId,
    reservationId,
    data: { authorizationId: auth.authorizationId, expiresAt: auth.expiresAt },
  });
  return updated;
}

export async function abandonAppReservation(reservationId: string) {
  const r = await getReservation(reservationId);
  if (r.status !== "pending_approval") return r;
  const db = await getDb();
  await db.update(reservations).set({ status: "failed", updatedAt: new Date() }).where(eq(reservations.id, reservationId));
  await giveBack(r.listingId);
  await logEvent({
    actor: "buyer",
    type: "reservation.abandoned",
    message: `${r.buyerName} closed PayPal without approving — bag released back to the shelf`,
    shopId: r.shopId,
    listingId: r.listingId,
    reservationId,
  });
  return r;
}

// ------------------------------------------------------------------ agent reservation (saved PayPal + mandate)
export type MandateCheck = { ok: boolean; rule: string; detail: string };

async function weekSpend(mandateId: string) {
  const db = await getDb();
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const rows = await db
    .select({ amount: reservations.amountCents, captured: reservations.capturedCents, status: reservations.status })
    .from(reservations)
    .where(and(eq(reservations.mandateId, mandateId), gte(reservations.createdAt, since)));
  return rows.reduce((s, r) => s + (r.status === "held" ? r.amount : r.status === "captured" ? r.captured : 0), 0);
}

/** Every rule is checked in code. The AI only judges "does this food fit the stated preferences". */
export async function evaluateMandate(m: Mandate, listing: Listing, shop: Shop): Promise<MandateCheck[]> {
  const checks: MandateCheck[] = [];
  checks.push({ ok: m.active, rule: "Mandate active", detail: m.active ? "Active" : "Paused by owner" });
  checks.push({ ok: !!m.vaultId, rule: "Saved PayPal", detail: m.vaultId ? "PayPal saved for agent holds" : "Owner has not saved PayPal yet" });
  checks.push({ ok: isLive(listing), rule: "Available", detail: isLive(listing) ? `${listing.remaining} left` : "Not available" });
  checks.push({
    ok: listing.priceCents <= m.maxPerOrderCents,
    rule: "Per-order limit",
    detail: `${money(listing.priceCents)} vs limit ${money(m.maxPerOrderCents)}`,
  });
  const spent = await weekSpend(m.id);
  checks.push({
    ok: spent + listing.priceCents <= m.maxPerWeekCents,
    rule: "Weekly budget",
    detail: `${money(spent)} used + ${money(listing.priceCents)} vs ${money(m.maxPerWeekCents)}`,
  });
  const km = distanceKm(m, shop);
  checks.push({ ok: km <= m.radiusKm, rule: "Distance", detail: `${km.toFixed(2)} km vs ${m.radiusKm} km` });
  const [eh, em] = m.earliestPickup.split(":").map(Number);
  const crossesMidnight = minutesOfDay(listing.pickupEnd) < minutesOfDay(listing.pickupStart);
  const okTime = crossesMidnight || minutesOfDay(listing.pickupEnd) >= eh * 60 + (em || 0);
  checks.push({
    ok: okTime,
    rule: "Pickup time",
    detail: `Pickup until ${hhmm(listing.pickupEnd)}, owner can collect from ${m.earliestPickup}`,
  });
  if (checks.every((c) => c.ok)) {
    const fit = await judgeFit(m.preferences, listing);
    checks.push({ ok: fit.fits, rule: "Food preferences (AI)", detail: fit.reason });
  }
  return checks;
}

export async function agentReserve(m: Mandate, listingId: string, source: "standing_order" | "agent_request") {
  const listing = await getListing(listingId);
  const shop = await getShop(listing.shopId);
  const checks = await evaluateMandate(m, listing, shop);
  const failed = checks.filter((c) => !c.ok);
  if (failed.length) {
    await logEvent({
      actor: "agent",
      type: "agent.declined",
      message: `${m.agentName} (for ${m.buyerName}) did not reserve "${listing.title}": ${failed.map((f) => `${f.rule} — ${f.detail}`).join("; ")}`,
      shopId: shop.id,
      listingId,
      mandateId: m.id,
      data: { checks, source },
    });
    return { reserved: false as const, checks };
  }
  if (!(await takeOne(listingId))) {
    return { reserved: false as const, checks: [...checks, { ok: false, rule: "Available", detail: "Sold out a moment ago" }] };
  }
  const db = await getDb();
  const id = `res_${nanoid(12)}`;
  const pickupCode = await newPickupCode();
  await db.insert(reservations).values({
    id,
    listingId,
    shopId: shop.id,
    buyerName: m.buyerName,
    channel: "agent",
    agentName: m.agentName,
    mandateId: m.id,
    amountCents: listing.priceCents,
    status: "pending_approval",
    pickupCode,
  });
  try {
    const order = await paypal.createHoldOrder({
      reservationId: id,
      amountCents: listing.priceCents,
      description: `${listing.title} — ${shop.name}`,
      shopName: shop.name,
      vaultId: m.vaultId!,
    });
    const auth = order.authorization ?? (await paypal.authorizeOrder(order.orderId));
    const [r] = await db
      .update(reservations)
      .set({ status: "held", paypalOrderId: order.orderId, authorizationId: auth.authorizationId, updatedAt: new Date() })
      .where(eq(reservations.id, id))
      .returning();
    await logEvent({
      actor: "agent",
      type: "agent.reserved",
      message: `${m.agentName} reserved "${listing.title}" for ${m.buyerName} — ${money(listing.priceCents)} held on saved PayPal (${source === "standing_order" ? "standing order" : "asked by owner"})`,
      shopId: shop.id,
      listingId,
      reservationId: id,
      mandateId: m.id,
      data: { checks, orderId: order.orderId, authorizationId: auth.authorizationId, source },
    });
    return { reserved: true as const, reservation: r, checks };
  } catch (err) {
    await db.update(reservations).set({ status: "failed", updatedAt: new Date() }).where(eq(reservations.id, id));
    await giveBack(listingId);
    await logEvent({
      actor: "paypal",
      type: "agent.hold_failed",
      message: `PayPal hold for ${m.buyerName}'s agent failed: ${(err as Error).message}`,
      shopId: shop.id,
      listingId,
      mandateId: m.id,
      data: err instanceof PayPalError ? { status: err.status, debugId: err.debugId } : undefined,
    });
    throw err;
  }
}

/** A new listing just went live: every standing order gets a chance, fastest-first is fine. */
export async function runStandingOrders(listingId: string) {
  const db = await getDb();
  const all = await db
    .select()
    .from(mandates)
    .where(and(eq(mandates.active, true), eq(mandates.standingOrder, true)));
  const results: { mandateId: string; buyerName: string; agentName: string; reserved: boolean; reason?: string }[] = [];
  // All agents decide in parallel (inventory is taken atomically, so the fastest fitting agent wins).
  await Promise.all(all.map(async (m) => {
    // one bag per mandate per listing
    const existing = await db
      .select({ id: reservations.id })
      .from(reservations)
      .where(and(eq(reservations.mandateId, m.id), eq(reservations.listingId, listingId), inArray(reservations.status, ["held", "captured"])));
    if (existing.length) return;
    try {
      const res = await agentReserve(m, listingId, "standing_order");
      results.push({
        mandateId: m.id,
        buyerName: m.buyerName,
        agentName: m.agentName,
        reserved: res.reserved,
        reason: res.reserved
          ? undefined
          : res.checks
              .filter((c) => !c.ok)
              .map((c) => (c.rule === "Food preferences (AI)" ? c.detail : `${c.rule}: ${c.detail}`))
              .join("; "),
      });
    } catch (err) {
      results.push({ mandateId: m.id, buyerName: m.buyerName, agentName: m.agentName, reserved: false, reason: (err as Error).message });
    }
  }));
  return results.sort((a, b) => Number(b.reserved) - Number(a.reserved) || a.buyerName.localeCompare(b.buyerName));
}

// ------------------------------------------------------------------ pickup: AI bag check -> person confirms -> capture
export async function findByPickupCode(shopId: string, code: string) {
  const db = await getDb();
  const [r] = await db
    .select()
    .from(reservations)
    .where(and(eq(reservations.shopId, shopId), eq(reservations.pickupCode, code.trim())))
    .orderBy(desc(reservations.createdAt))
    .limit(1);
  if (!r) throw new CrumbError("No reservation with that code", 404, "not_found");
  return r;
}

export async function runBagCheck(reservationId: string, photo: string) {
  const r = await getReservation(reservationId);
  if (r.status !== "held") throw new CrumbError(`Reservation is ${r.status}`, 409);
  const listing = await getListing(r.listingId);
  const unitValues: Record<string, number> = {};
  const totalCount = listing.contents.reduce((s, c) => s + c.count, 0) || 1;
  for (const c of listing.contents) unitValues[c.name] = Math.round(listing.valueCents / totalCount);
  const expected = listing.contents.map((c) => ({ name: c.name, count: c.count }));
  const result = await checkBag(photo, expected, unitValues);
  const bagCheck: BagCheck = { expected, ...result, photo };
  const db = await getDb();
  await db.update(reservations).set({ bagCheck, updatedAt: new Date() }).where(eq(reservations.id, reservationId));
  const proposed = proposedCapture(r.amountCents, result.fraction);
  await logEvent({
    actor: "ai",
    type: "bagcheck.done",
    message: `AI bag check: ${result.summary} → ${Math.round(result.fraction * 100)}% of the bag's value present, propose charging ${money(proposed)} of the ${money(r.amountCents)} hold (confidence ${Math.round(result.confidence * 100)}%)`,
    shopId: r.shopId,
    listingId: r.listingId,
    reservationId,
    data: { found: result.found, missing: result.missing, fraction: result.fraction, confidence: result.confidence },
  });
  return { bagCheck, proposedCents: proposed };
}

export function proposedCapture(holdCents: number, fraction: number) {
  return Math.max(0, Math.min(holdCents, Math.round(holdCents * fraction)));
}

/** A person (shop staff, with the buyer there) confirms the amount. 0 => void the hold. */
export async function completeHandover(reservationId: string, amountCents: number) {
  const r = await getReservation(reservationId);
  if (r.status !== "held" || !r.authorizationId) throw new CrumbError(`Reservation is ${r.status}`, 409);
  const amount = Math.max(0, Math.min(r.amountCents, Math.round(amountCents)));
  const db = await getDb();
  if (amount === 0) {
    await paypal.voidAuthorization(r.authorizationId);
    const [u] = await db.update(reservations).set({ status: "voided", updatedAt: new Date() }).where(eq(reservations.id, reservationId)).returning();
    await logEvent({
      actor: "paypal",
      type: "authorization.voided",
      message: `Empty bag — hold of ${money(r.amountCents)} voided. ${r.buyerName} paid nothing, no refund needed.`,
      shopId: r.shopId,
      listingId: r.listingId,
      reservationId,
    });
    return u;
  }
  const cap = await paypal.captureAuthorization(
    r.authorizationId,
    amount,
    amount < r.amountCents
      ? `Charged ${money(amount)} for what was in your bag; the rest of the ${money(r.amountCents)} hold was released.`
      : "Thanks for rescuing food with Crumb!",
    r.id,
  );
  const [u] = await db
    .update(reservations)
    .set({ status: "captured", capturedCents: cap.amountCents, updatedAt: new Date() })
    .where(eq(reservations.id, reservationId))
    .returning();
  await logEvent({
    actor: "paypal",
    type: amount < r.amountCents ? "capture.partial" : "capture.full",
    message:
      amount < r.amountCents
        ? `Partial capture: ${money(cap.amountCents)} of the ${money(r.amountCents)} hold charged, ${money(r.amountCents - cap.amountCents)} released automatically (final_capture)`
        : `Captured ${money(cap.amountCents)} — food handed over to ${r.buyerName}`,
    shopId: r.shopId,
    listingId: r.listingId,
    reservationId,
    data: { captureId: cap.captureId },
  });
  return u;
}

/** Buyer (or their agent) changes their mind before pickup: void the hold, bag goes back on the shelf. */
export async function buyerCancel(reservationId: string, mandateId?: string) {
  const r = await getReservation(reservationId);
  if (mandateId && r.mandateId !== mandateId) throw new CrumbError("Not your reservation", 403, "forbidden");
  if (r.status !== "held") throw new CrumbError(`Reservation is ${r.status}`, 409);
  if (r.authorizationId) await paypal.voidAuthorization(r.authorizationId);
  const db = await getDb();
  await db.update(reservations).set({ status: "voided", updatedAt: new Date() }).where(eq(reservations.id, reservationId));
  await giveBack(r.listingId);
  await logEvent({
    actor: r.channel === "agent" ? "agent" : "buyer",
    type: "reservation.cancelled",
    message: `${r.agentName ?? r.buyerName} cancelled before pickup — ${money(r.amountCents)} hold voided, bag back on the shelf for someone else`,
    shopId: r.shopId,
    listingId: r.listingId,
    reservationId,
    mandateId: r.mandateId,
  });
  return { status: "voided" };
}

export async function mandateByToken(token: string | null | undefined): Promise<Mandate> {
  if (!token) throw new CrumbError("Missing agent token", 401, "unauthorized");
  const db = await getDb();
  const [m] = await db.select().from(mandates).where(eq(mandates.token, token.replace(/^Bearer\s+/i, "").trim()));
  if (!m) throw new CrumbError("Unknown agent token", 401, "unauthorized");
  return m;
}

// ------------------------------------------------------------------ shop cancels / closing time
export async function cancelListing(listingId: string, reason = "The shop ran out") {
  const listing = await getListing(listingId);
  const db = await getDb();
  await db.update(listings).set({ status: "cancelled", remaining: 0 }).where(eq(listings.id, listingId));
  const held = await db
    .select()
    .from(reservations)
    .where(and(eq(reservations.listingId, listingId), inArray(reservations.status, ["held", "pending_approval"])));
  for (const r of held) {
    if (r.status === "held" && r.authorizationId) await paypal.voidAuthorization(r.authorizationId);
    await db.update(reservations).set({ status: "voided", updatedAt: new Date() }).where(eq(reservations.id, r.id));
  }
  await logEvent({
    actor: "shop",
    type: "listing.cancelled",
    message: `"${listing.title}" cancelled (${reason}). ${held.length} hold(s) voided instantly — buyers were never charged, nothing to refund.`,
    shopId: listing.shopId,
    listingId,
    data: { voided: held.length },
  });
  return { voided: held.length };
}

/** Run on every dashboard load (and by cron): close listings whose pickup window ended. */
export async function sweepExpired() {
  const db = await getDb();
  const now = new Date();
  // Pending PayPal approvals older than 15 minutes give the bag back.
  const stale = await db
    .select()
    .from(reservations)
    .where(and(eq(reservations.status, "pending_approval"), lt(reservations.createdAt, new Date(now.getTime() - 15 * 60_000))));
  for (const r of stale) await abandonAppReservation(r.id);

  const ended = await db
    .select()
    .from(listings)
    .where(and(inArray(listings.status, ["live", "sold_out"]), lt(listings.pickupEnd, now)));
  for (const l of ended) {
    const shop = await getShop(l.shopId);
    await db.update(listings).set({ status: "closed" }).where(eq(listings.id, l.id));
    const held = await db.select().from(reservations).where(and(eq(reservations.listingId, l.id), eq(reservations.status, "held")));
    for (const r of held) {
      if (!r.authorizationId) continue;
      const fee = Math.round((r.amountCents * shop.noShowFeePct) / 100);
      if (fee > 0) {
        await paypal.captureAuthorization(r.authorizationId, fee, `No-show fee (${shop.noShowFeePct}%) — the rest of your hold was released.`, r.id);
        await db.update(reservations).set({ status: "expired", capturedCents: fee, updatedAt: new Date() }).where(eq(reservations.id, r.id));
      } else {
        await paypal.voidAuthorization(r.authorizationId);
        await db.update(reservations).set({ status: "expired", updatedAt: new Date() }).where(eq(reservations.id, r.id));
      }
      await logEvent({
        actor: "system",
        type: "reservation.no_show",
        message: fee > 0 ? `${r.buyerName} didn't collect — ${money(fee)} no-show fee captured, rest released` : `${r.buyerName} didn't collect — hold voided, no charge`,
        shopId: l.shopId,
        listingId: l.id,
        reservationId: r.id,
      });
    }
  }
}
