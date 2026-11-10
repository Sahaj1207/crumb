import "server-only";
import { GoogleGenAI } from "@google/genai";
import type { BagItem } from "./db/schema";

/**
 * All AI in Crumb goes through this file.
 *  1. listFromPhoto  — counter photo  -> structured surplus bags (items, allergens, value, price)
 *  2. checkBag       — handover photo -> what is actually in the bag vs what was listed
 *  3. judgeFit       — does a listing fit a buyer's plain-language preferences (standing orders)
 *
 * The AI only ever *proposes*. Prices are clamped to the shop's floor in code, the shop
 * confirms every listing, and money only moves after a person confirms the handover.
 * Without GEMINI_API_KEY a deterministic mock is used so the app still runs end to end.
 */

const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
export const AI_MODE = process.env.GEMINI_API_KEY ? "gemini" : "mock";

let client: GoogleGenAI | undefined;
function ai() {
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  return client;
}

function splitDataUrl(dataUrl: string): { mime: string; data: string } {
  const m = /^data:([^;]+);base64,([\s\S]*)$/.exec(dataUrl);
  if (!m) throw new Error("Expected a base64 data URL image");
  return { mime: m[1], data: m[2] };
}

/** Models to try in order. Free-tier models get "high demand" 503s; a demo must not die on one. */
export const MODEL_CHAIN = [
  MODEL,
  ...(process.env.GEMINI_FALLBACK_MODELS ?? "gemini-3.5-flash,gemini-3.1-flash-lite").split(",").map((s) => s.trim()),
].filter((m, i, a) => m && a.indexOf(m) === i);

const ATTEMPT_TIMEOUT_MS = 25_000;

function isTransient(e: unknown) {
  const msg = String((e as Error)?.message ?? e);
  return /\b(404|429|500|503|504)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|NOT_FOUND|high demand|overloaded|deadline|timed out/i.test(msg);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`AI call timed out after ${ms / 1000}s`)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

/** One attempt per model, with a hard timeout; a busy, retired or hanging model falls through to the next. */
export async function withFallback<T>(fn: (model: string) => Promise<T>): Promise<T> {
  let last: unknown;
  for (const model of MODEL_CHAIN) {
    try {
      return await withTimeout(fn(model), ATTEMPT_TIMEOUT_MS);
    } catch (e) {
      last = e;
      console.warn(`[ai] ${model} failed: ${String((e as Error)?.message ?? e).slice(0, 140)}`);
      if (!isTransient(e)) throw e;
    }
  }
  throw new Error(`The AI service is busy right now (${String((last as Error)?.message ?? last).slice(0, 120)}). Please try again in a minute.`);
}

async function askJson<T>(prompt: string, schema: object, images: string[] = []): Promise<T> {
  const parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[] = [];
  for (const img of images) {
    const { mime, data } = splitDataUrl(img);
    parts.push({ inlineData: { mimeType: mime, data } });
  }
  parts.push({ text: prompt });
  const res = await withFallback((model) =>
    ai().models.generateContent({
      model,
      contents: [{ role: "user", parts }],
      config: { responseMimeType: "application/json", responseJsonSchema: schema, temperature: 0.2 },
    }),
  );
  const text = res.text ?? "";
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`AI returned invalid JSON: ${text.slice(0, 200)}`);
  }
}

// ------------------------------------------------------------------ 1. photo -> listing
export type DetectedItem = BagItem & { unitValueCents: number };
export type ProposedBag = {
  title: string;
  description: string;
  contents: { name: string; count: number }[];
  valueCents: number;
  priceCents: number;
  quantity: number;
  weightGrams: number;
  tags: string[];
};
export type ListingProposal = {
  items: DetectedItem[];
  bags: ProposedBag[];
  notes: string;
  warnings: string[];
};

const listingSchema = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          count: { type: "integer" },
          allergens: { type: "array", items: { type: "string" } },
          unitValueCents: { type: "integer", description: "normal full retail price per unit in US cents" },
        },
        required: ["name", "count", "allergens", "unitValueCents"],
      },
    },
    bags: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          contents: {
            type: "array",
            items: {
              type: "object",
              properties: { name: { type: "string" }, count: { type: "integer" } },
              required: ["name", "count"],
            },
          },
          valueCents: { type: "integer" },
          priceCents: { type: "integer" },
          quantity: { type: "integer" },
          weightGrams: { type: "integer" },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["title", "description", "contents", "valueCents", "priceCents", "quantity", "weightGrams", "tags"],
      },
    },
    notes: { type: "string" },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["items", "bags", "notes", "warnings"],
};

export async function listFromPhoto(
  photo: string,
  shop: { name: string; kind: string; minPricePct: number },
  ownerNote = "",
): Promise<ListingProposal> {
  const proposal =
    AI_MODE === "mock"
      ? mockListing()
      : await askJson<ListingProposal>(
          `You help a small ${shop.kind} called "${shop.name}" sell today's unsold food before closing instead of throwing it away.
Look at the photo of what is left on the counter / shelves.
1. List every distinct food item you can see with a realistic count, likely allergens (gluten, dairy, egg, nuts, soy, sesame, fish, shellfish) and its normal full US retail price per unit in cents.
2. Group the items into 1-3 "rescue bags" a customer would be happy to get (e.g. "Sweet bakery bag", "Savoury lunch bag"). Each bag type has contents per bag and how many identical bags can be made from what is visible (quantity). Use every item at most once across all bags.
3. valueCents = full retail value of ONE bag. priceCents = a fair rescue price around 35-45% of value, never below ${shop.minPricePct}% of value. Round prices to end in 49 or 99 cents.
4. weightGrams = realistic food weight of one bag.
5. tags: from [vegetarian, vegan, contains-meat, contains-fish, sweet, savoury, gluten-free] — only tags you are confident about.
6. warnings: anything the owner must double-check (uncertain items, allergens you cannot rule out, food that may not be safe to resell).
Be conservative: if unsure about a count, choose the lower number. ${ownerNote ? `Owner's note: "${ownerNote}"` : ""}`,
          listingSchema,
          [photo],
        );
  // Guardrails in code, not in the prompt.
  for (const bag of proposal.bags) {
    bag.quantity = Math.max(1, Math.min(50, Math.round(bag.quantity)));
    bag.valueCents = Math.max(100, Math.round(bag.valueCents));
    const floor = Math.ceil((bag.valueCents * shop.minPricePct) / 100);
    bag.priceCents = Math.min(bag.valueCents, Math.max(floor, Math.round(bag.priceCents)));
    bag.weightGrams = Math.max(100, Math.min(3000, Math.round(bag.weightGrams || 400)));
  }
  return proposal;
}

// ------------------------------------------------------------------ 2. handover bag check
export type BagCheckResult = {
  found: { name: string; count: number }[];
  missing: { name: string; count: number }[];
  fraction: number;
  confidence: number;
  summary: string;
};

const bagSchema = {
  type: "object",
  properties: {
    found: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, count: { type: "integer" } },
        required: ["name", "count"],
      },
    },
    confidence: { type: "number", description: "0 to 1, how sure you are about the counts" },
    summary: { type: "string" },
  },
  required: ["found", "confidence", "summary"],
};

export async function checkBag(
  photo: string,
  expected: { name: string; count: number }[],
  unitValues: Record<string, number>,
): Promise<BagCheckResult> {
  const raw =
    AI_MODE === "mock"
      ? mockBagCheck(expected)
      : await askJson<{ found: { name: string; count: number }[]; confidence: number; summary: string }>(
          `This photo was taken at pickup of a surplus-food bag, opened so the contents are visible.
The bag was listed as containing: ${expected.map((e) => `${e.count} x ${e.name}`).join(", ")}.
For each listed item, count how many you can actually see. Use EXACTLY the listed item names. Ignore anything that was not listed.
Return found (one entry per listed item, count may be 0), your confidence 0-1, and a one-sentence plain summary for the customer.`,
          bagSchema,
          [photo],
        );

  // Deterministic money maths: value of what is present / value of what was promised.
  const found = expected.map((e) => {
    const hit = raw.found.find((f) => f.name.trim().toLowerCase() === e.name.trim().toLowerCase());
    return { name: e.name, count: Math.max(0, Math.min(e.count, Math.round(hit?.count ?? 0))) };
  });
  const missing = expected
    .map((e, i) => ({ name: e.name, count: e.count - found[i].count }))
    .filter((m) => m.count > 0);
  const value = (list: { name: string; count: number }[]) =>
    list.reduce((s, x) => s + x.count * (unitValues[x.name] ?? 100), 0);
  const promised = value(expected);
  const fraction = promised > 0 ? Math.round((value(found) / promised) * 1000) / 1000 : 0;
  return {
    found,
    missing,
    fraction,
    confidence: Math.max(0, Math.min(1, raw.confidence)),
    summary: raw.summary,
  };
}

// ------------------------------------------------------------------ 3. preference fit
export async function judgeFit(
  preferences: string,
  listing: { title: string; contents: BagItem[]; tags: string[] },
): Promise<{ fits: boolean; reason: string }> {
  if (!preferences.trim()) return { fits: true, reason: "No food preferences set." };
  if (AI_MODE === "mock") return mockFit(preferences, listing);
  return askJson(
    `A buyer told their AI assistant: "${preferences}".
Surplus bag: "${listing.title}" containing ${listing.contents
      .map((c) => `${c.count} x ${c.name}${c.allergens.length ? ` (allergens: ${c.allergens.join(", ")})` : ""}`)
      .join("; ")}. Tags: ${listing.tags.join(", ") || "none"}.
Would this bag respect the buyer's preferences and restrictions? Treat allergies and diets as hard rules; when unsure, say it does not fit.`,
    {
      type: "object",
      properties: { fits: { type: "boolean" }, reason: { type: "string" } },
      required: ["fits", "reason"],
    },
  );
}

// ------------------------------------------------------------------ mocks
function mockListing(): ListingProposal {
  return {
    items: [
      { name: "Butter croissant", count: 6, allergens: ["gluten", "dairy", "egg"], unitValueCents: 375 },
      { name: "Blueberry muffin", count: 4, allergens: ["gluten", "dairy", "egg"], unitValueCents: 350 },
      { name: "Sourdough loaf", count: 2, allergens: ["gluten"], unitValueCents: 850 },
      { name: "Spinach & feta roll", count: 3, allergens: ["gluten", "dairy"], unitValueCents: 525 },
    ],
    bags: [
      {
        title: "Sweet bakery bag",
        description: "Two flaky butter croissants and a blueberry muffin from today's bake.",
        contents: [
          { name: "Butter croissant", count: 2 },
          { name: "Blueberry muffin", count: 1 },
        ],
        valueCents: 1100,
        priceCents: 449,
        quantity: 3,
        weightGrams: 260,
        tags: ["vegetarian", "sweet"],
      },
      {
        title: "Savoury supper bag",
        description: "Half a sourdough loaf's worth and a spinach & feta roll — dinner sorted.",
        contents: [
          { name: "Sourdough loaf", count: 1 },
          { name: "Spinach & feta roll", count: 1 },
        ],
        valueCents: 1375,
        priceCents: 549,
        quantity: 2,
        weightGrams: 700,
        tags: ["vegetarian", "savoury"],
      },
    ],
    notes: "Mock AI (no GEMINI_API_KEY set): sample bakery counter.",
    warnings: ["Check the spinach & feta rolls were baked today."],
  };
}

function mockBagCheck(expected: { name: string; count: number }[]) {
  // Deterministic: the first item is one short if it had more than one, everything else present.
  const found = expected.map((e, i) => ({ name: e.name, count: i === 0 && e.count > 1 ? e.count - 1 : e.count }));
  const short = expected[0] && expected[0].count > 1;
  return {
    found,
    confidence: 0.86,
    summary: short ? `One ${expected[0].name.toLowerCase()} is missing; everything else is in the bag.` : "Everything listed is in the bag.",
  };
}

function mockFit(preferences: string, listing: { title: string; contents: BagItem[]; tags: string[] }) {
  const p = preferences.toLowerCase();
  const allergens = new Set(listing.contents.flatMap((c) => c.allergens.map((a) => a.toLowerCase())));
  const tags = listing.tags.map((t) => t.toLowerCase());
  if (p.includes("vegan") && !tags.includes("vegan"))
    return { fits: false, reason: `Not vegan — contains ${[...allergens].filter((a) => ["dairy", "egg"].includes(a)).join(" and ") || "animal products"}.` };
  if ((p.includes("vegetarian") || p.includes("veggie")) && (tags.includes("contains-meat") || tags.includes("contains-fish")))
    return { fits: false, reason: "Contains meat or fish." };
  for (const a of ["nut", "dairy", "gluten", "egg", "sesame", "soy"]) {
    if (p.includes(`no ${a}`) && [...allergens].some((x) => x.includes(a))) return { fits: false, reason: `Contains ${a}.` };
  }
  const wantsSavouryOnly = p.includes("savoury") && !p.includes("sweet");
  if (wantsSavouryOnly && !tags.includes("savoury")) return { fits: false, reason: "Owner wants savoury food; this bag is sweet." };
  return { fits: true, reason: "Fits the stated diet and preferences." };
}
