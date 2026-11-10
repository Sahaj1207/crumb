import { desc, eq, inArray } from "drizzle-orm";
import { route } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { sweepExpired } from "@/lib/core";

/**
 * Live audit trail + impact numbers. Public on purpose: every money movement is explainable.
 * ?shopId= narrows to one shop. Buyer names are first names only in this demo.
 */
export const GET = route(async (req: Request) => {
  await sweepExpired();
  const url = new URL(req.url);
  const shopId = url.searchParams.get("shopId");
  const since = Number(url.searchParams.get("after") ?? 0);
  const db = await getDb();

  const events = (
    await db
      .select()
      .from(schema.events)
      .where(shopId ? eq(schema.events.shopId, shopId) : undefined)
      .orderBy(desc(schema.events.id))
      .limit(80)
  ).filter((e) => e.id > since);

  const rows = await db
    .select({ r: schema.reservations, l: schema.listings })
    .from(schema.reservations)
    .innerJoin(schema.listings, eq(schema.listings.id, schema.reservations.listingId))
    .where(shopId ? eq(schema.reservations.shopId, shopId) : undefined)
    .orderBy(desc(schema.reservations.createdAt))
    .limit(500);

  let rescuedBags = 0,
    rescuedGrams = 0,
    revenueCents = 0,
    savedByBagCheckCents = 0,
    voidedHolds = 0,
    agentBags = 0,
    buyerSavingsCents = 0;
  for (const { r, l } of rows) {
    if (r.status === "captured") {
      const fraction = r.amountCents ? r.capturedCents / r.amountCents : 1;
      rescuedBags += 1;
      rescuedGrams += Math.round(l.weightGrams * fraction);
      revenueCents += r.capturedCents;
      savedByBagCheckCents += r.amountCents - r.capturedCents;
      buyerSavingsCents += Math.round(l.valueCents * fraction) - r.capturedCents;
      if (r.channel === "agent") agentBags += 1;
    }
    if (r.status === "voided") voidedHolds += 1;
    if (r.status === "expired") voidedHolds += r.capturedCents === 0 ? 1 : 0;
  }

  const active = rows
    .filter(({ r }) => r.status === "held" || r.status === "pending_approval")
    .map(({ r, l }) => ({
      id: r.id,
      buyerName: r.buyerName,
      channel: r.channel,
      agentName: r.agentName,
      status: r.status,
      amountCents: r.amountCents,
      pickupCode: shopId ? r.pickupCode : undefined,
      listingTitle: l.title,
      createdAt: r.createdAt,
    }));

  const liveListings = shopId
    ? await db.select().from(schema.listings).where(eq(schema.listings.shopId, shopId)).orderBy(desc(schema.listings.createdAt)).limit(30)
    : await db.select().from(schema.listings).where(inArray(schema.listings.status, ["live", "sold_out"])).limit(30);

  return Response.json({
    events,
    stats: {
      rescuedBags,
      rescuedKg: Math.round(rescuedGrams / 100) / 10,
      // ~2.5 kg CO2e avoided per kg of food not wasted (WRAP / FAO order of magnitude; shown as an estimate)
      co2eKg: Math.round(rescuedGrams * 2.5) / 1000,
      revenueCents,
      savedByBagCheckCents,
      voidedHolds,
      agentBags,
      buyerSavingsCents,
    },
    active,
    listings: liveListings.map((l) => ({ ...l, photo: undefined })),
  });
});
