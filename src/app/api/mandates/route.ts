import { nanoid } from "nanoid";
import { asc, eq } from "drizzle-orm";
import { route, body } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { logEvent, money, CrumbError } from "@/lib/core";

/** Public list of agent mandates (tokens and vault ids are never returned). */
export const GET = route(async () => {
  const db = await getDb();
  const rows = await db.select().from(schema.mandates).orderBy(asc(schema.mandates.createdAt));
  return Response.json({
    mandates: rows.map(({ token: _t, vaultId, paypalCustomerId: _c, ...m }) => ({ ...m, paypalSaved: !!vaultId })),
  });
});

/** Create or update a mandate: the rules an AI agent must follow when spending for you. */
export const POST = route(async (req: Request) => {
  const input = await body<{
    id?: string;
    buyerName: string;
    agentName?: string;
    preferences?: string;
    maxPerOrderCents: number;
    maxPerWeekCents: number;
    radiusKm?: number;
    earliestPickup?: string;
    standingOrder?: boolean;
    active?: boolean;
    lat?: number;
    lng?: number;
  }>(req);
  if (!input.buyerName?.trim()) throw new CrumbError("Name required");
  const perOrder = Math.max(100, Math.min(5000, Math.round(input.maxPerOrderCents)));
  const perWeek = Math.max(perOrder, Math.min(20000, Math.round(input.maxPerWeekCents)));
  const db = await getDb();
  const values = {
    buyerName: input.buyerName.trim().slice(0, 40),
    agentName: (input.agentName || `${input.buyerName.trim()}'s assistant`).slice(0, 60),
    preferences: (input.preferences ?? "").slice(0, 300),
    maxPerOrderCents: perOrder,
    maxPerWeekCents: perWeek,
    radiusKm: Math.max(0.2, Math.min(20, input.radiusKm ?? 1.5)),
    earliestPickup: /^\d{2}:\d{2}$/.test(input.earliestPickup ?? "") ? input.earliestPickup! : "17:00",
    standingOrder: input.standingOrder ?? true,
    active: input.active ?? true,
    lat: input.lat ?? 37.3772,
    lng: input.lng ?? -121.9221,
  };
  let id = input.id;
  if (id) {
    const [row] = await db.update(schema.mandates).set(values).where(eq(schema.mandates.id, id)).returning();
    if (!row) throw new CrumbError("Mandate not found", 404);
  } else {
    id = `man_${nanoid(10)}`;
    await db.insert(schema.mandates).values({ id, token: `agt_${nanoid(24)}`, ...values });
  }
  await logEvent({
    actor: "buyer",
    type: "mandate.saved",
    message: `${values.buyerName} set rules for ${values.agentName}: max ${money(perOrder)}/order, ${money(perWeek)}/week, within ${values.radiusKm} km${values.preferences ? `, "${values.preferences}"` : ""}`,
    mandateId: id,
  });
  return Response.json({ id });
});
