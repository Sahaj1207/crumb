import "server-only";
import { nanoid } from "nanoid";
import { getDb, schema } from "./db";

/**
 * Demo world: three independent food shops a few minutes' walk from PayPal HQ
 * (2211 North First Street, San Jose) and three people with AI assistants.
 * All fictional.
 */
export const DEMO_SHOPS = [
  {
    id: "shop_golden_crust",
    name: "Golden Crust Bakery",
    kind: "bakery",
    address: "North First St, San Jose",
    lat: 37.3794,
    lng: -121.9239,
    closesAt: "20:00",
    minPricePct: 30,
    noShowFeePct: 0,
  },
  {
    id: "shop_little_saigon",
    name: "Pho & Bao Kitchen",
    kind: "restaurant",
    address: "Brokaw Rd, San Jose",
    lat: 37.3746,
    lng: -121.9186,
    closesAt: "21:30",
    minPricePct: 35,
    noShowFeePct: 25,
  },
  {
    id: "shop_green_bowl",
    name: "Green Bowl Café",
    kind: "café",
    address: "Rio Robles, San Jose",
    lat: 37.3817,
    lng: -121.9285,
    closesAt: "19:00",
    minPricePct: 30,
    noShowFeePct: 0,
  },
];

export const DEMO_MANDATES = [
  { buyerName: "Maya", agentName: "Maya's Claude", preferences: "vegetarian, anything sweet or savoury", maxPerOrderCents: 600, maxPerWeekCents: 2500, lat: 37.3779, lng: -121.9212, radiusKm: 1.5, earliestPickup: "00:00" },
  { buyerName: "Dev", agentName: "Dev's assistant", preferences: "no nuts (allergy), savoury dinner food", maxPerOrderCents: 800, maxPerWeekCents: 3000, lat: 37.3759, lng: -121.9201, radiusKm: 1.0, earliestPickup: "18:00" },
  { buyerName: "Sam", agentName: "Sam's Gemini", preferences: "vegan only", maxPerOrderCents: 500, maxPerWeekCents: 1500, lat: 37.3801, lng: -121.9265, radiusKm: 2.0, earliestPickup: "00:00" },
];

const flag = globalThis as unknown as { __crumbSeeded?: Promise<void> };

export function ensureSeed() {
  flag.__crumbSeeded ??= (async () => {
    const db = await getDb();
    const existing = await db.select({ id: schema.shops.id }).from(schema.shops);
    if (existing.length) return;
    await db.insert(schema.shops).values(DEMO_SHOPS).onConflictDoNothing();
    await db
      .insert(schema.mandates)
      .values(
        DEMO_MANDATES.map((m) => ({
          id: `man_${m.buyerName.toLowerCase()}`,
          token: `agt_${nanoid(24)}`,
          standingOrder: true,
          active: true,
          // In PAYPAL_MODE=mock the demo agents get a fake saved PayPal; in sandbox the
          // owner connects a real sandbox buyer account on /agent.
          vaultId: process.env.PAYPAL_MODE === "mock" ? `MOCK-VAULT-${m.buyerName.toUpperCase()}` : null,
          ...m,
        })),
      )
      .onConflictDoNothing();
  })().catch((e) => {
    flag.__crumbSeeded = undefined;
    throw e;
  });
  return flag.__crumbSeeded;
}
