import { nanoid } from "nanoid";
import { after } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { route, requireShop, body } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { getShop, logEvent, runStandingOrders, sweepExpired, CrumbError, money, distanceKm } from "@/lib/core";
import { todayAt } from "@/lib/time";
import type { BagItem } from "@/lib/db/schema";

export const maxDuration = 60;

type BagInput = {
  title: string;
  description: string;
  contents: { name: string; count: number }[];
  valueCents: number;
  priceCents: number;
  quantity: number;
  weightGrams: number;
  tags: string[];
};

/** Public: live listings, optionally sorted by distance from lat/lng. */
export const GET = route(async (req: Request) => {
  await sweepExpired();
  const url = new URL(req.url);
  const shopId = url.searchParams.get("shopId");
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  const db = await getDb();
  const rows = await db
    .select({ l: schema.listings, s: schema.shops })
    .from(schema.listings)
    .innerJoin(schema.shops, eq(schema.shops.id, schema.listings.shopId))
    .where(
      shopId
        ? eq(schema.listings.shopId, shopId)
        : inArray(schema.listings.status, ["live", "sold_out"]),
    )
    .orderBy(desc(schema.listings.createdAt))
    .limit(100);
  const items = rows.map(({ l, s }) => ({
    ...l,
    shop: { id: s.id, name: s.name, kind: s.kind, address: s.address, lat: s.lat, lng: s.lng, noShowFeePct: s.noShowFeePct },
    distanceKm: Number.isFinite(lat) && Number.isFinite(lng) && url.searchParams.has("lat") ? distanceKm({ lat, lng }, s) : null,
  }));
  if (items.some((i) => i.distanceKm !== null)) items.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
  return Response.json({ listings: items });
});

/** Shop publishes the bags the AI proposed (after editing). Standing orders run right after. */
export const POST = route(async (req: Request) => {
  requireShop(req);
  const input = await body<{
    shopId: string;
    photo?: string;
    pickupUntil: string; // "HH:MM" today, shop timezone
    bags: BagInput[];
    items: { name: string; allergens: string[] }[];
    aiNotes?: string;
  }>(req);
  const shop = await getShop(input.shopId);
  if (!input.bags?.length) throw new CrumbError("Nothing to publish");
  let pickupEnd = todayAt(input.pickupUntil || shop.closesAt);
  // "00:30" entered at 23:00 means tonight after midnight, not this morning.
  if (pickupEnd.getTime() < Date.now() - 60 * 60_000) pickupEnd = new Date(pickupEnd.getTime() + 24 * 3600_000);
  if (pickupEnd.getTime() <= Date.now() + 5 * 60_000) throw new CrumbError("Pickup window must end at least 5 minutes from now");

  const allergenOf = new Map(input.items?.map((i) => [i.name.toLowerCase(), i.allergens]) ?? []);
  const db = await getDb();
  const created = [];
  for (const b of input.bags) {
    const valueCents = Math.max(100, Math.round(b.valueCents));
    const floor = Math.ceil((valueCents * shop.minPricePct) / 100);
    const priceCents = Math.min(valueCents, Math.max(floor, Math.round(b.priceCents)));
    const quantity = Math.max(1, Math.min(50, Math.round(b.quantity)));
    const contents: BagItem[] = b.contents
      .filter((c) => c.count > 0 && c.name.trim())
      .map((c) => ({ name: c.name.trim(), count: Math.round(c.count), allergens: allergenOf.get(c.name.toLowerCase()) ?? [] }));
    if (!contents.length) continue;
    const [row] = await db
      .insert(schema.listings)
      .values({
        id: `lst_${nanoid(10)}`,
        shopId: shop.id,
        title: b.title.trim().slice(0, 80) || "Rescue bag",
        description: b.description?.trim().slice(0, 300) ?? "",
        contents,
        tags: (b.tags ?? []).slice(0, 6),
        valueCents,
        priceCents,
        quantity,
        remaining: quantity,
        weightGrams: Math.max(100, Math.min(3000, Math.round(b.weightGrams || 400))),
        pickupStart: new Date(),
        pickupEnd,
        photo: input.photo ?? null,
        aiNotes: input.aiNotes ?? "",
      })
      .returning();
    created.push(row);
    await logEvent({
      actor: "shop",
      type: "listing.published",
      message: `${shop.name} published ${quantity} × "${row.title}" at ${money(priceCents)} (worth ${money(valueCents)}) — now visible to people and AI agents`,
      shopId: shop.id,
      listingId: row.id,
    });
  }

  // Standing orders: agents whose rules match grab bags right away.
  const agentResults = [];
  for (const l of created) agentResults.push(...(await runStandingOrders(l.id)).map((r) => ({ ...r, listingId: l.id })));

  after(async () => {
    // keep the "pending approval" pool tidy
    await sweepExpired().catch(() => {});
  });

  const fresh = created.length
    ? await db.select().from(schema.listings).where(and(inArray(schema.listings.id, created.map((c) => c.id))))
    : [];
  return Response.json({ listings: fresh, agentResults });
});
