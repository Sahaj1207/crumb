"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { api, ApiError, fileToDataUrl, money, useConfig, usePoll, useStored } from "@/lib/client";
import { prettyTime } from "@/lib/time";
import { Button, MoneyReceipt, Notice, StatusPill, Sticker, ModeBadge } from "@/components/bits";
import { EventFeed, type FeedEvent } from "@/components/event-feed";

const SHOPS = [
  { id: "shop_golden_crust", name: "Golden Crust Bakery", closesAt: "20:00", minPricePct: 30 },
  { id: "shop_little_saigon", name: "Pho & Bao Kitchen", closesAt: "21:30", minPricePct: 35 },
  { id: "shop_green_bowl", name: "Green Bowl Café", closesAt: "19:00", minPricePct: 30 },
];

type Tab = "list" | "pickup" | "board";

/** Free-licence stand-in photos (see /public/samples/CREDITS.md) for people testing without food at hand. */
const SAMPLES: Record<string, { src: string; label: string }[]> = {
  shop_golden_crust: [
    { src: "/samples/pastry-basket.jpg", label: "Pastry basket" },
    { src: "/samples/croissant-tray.jpg", label: "Croissant tray" },
  ],
  shop_little_saigon: [{ src: "/samples/dim-sum-table.jpg", label: "Dim sum leftovers" }],
  shop_green_bowl: [{ src: "/samples/cafe-bowls.jpg", label: "Salad bar" }],
};
const SAMPLE_BAG = "/samples/bag-two-croissants.jpg";

async function sampleFile(src: string) {
  const blob = await (await fetch(src)).blob();
  return new File([blob], src.split("/").pop()!, { type: blob.type || "image/jpeg" });
}

export default function ShopConsole() {
  const cfg = useConfig();
  const [shopId, setShopId] = useStored("crumb.shop", SHOPS[0].id);
  const [pin, setPin] = useStored("crumb.pin", "");
  const [tab, setTab] = useState<Tab>("list");
  const shop = SHOPS.find((s) => s.id === shopId) ?? SHOPS[0];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex flex-wrap items-end gap-4 justify-between">
        <div>
          <h1 className="text-4xl font-extrabold">Shop counter</h1>
          <p className="text-ink-soft mt-1">Sell what&apos;s left before closing. One photo, a quick check, and it&apos;s on sale.</p>
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          <label className="text-sm font-bold">
            Shop
            <select
              value={shop.id}
              onChange={(e) => setShopId(e.target.value)}
              className="mt-1 block rounded-xl border-2 border-line bg-paper px-3 py-2 font-normal"
            >
              {SHOPS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-bold">
            Staff PIN
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              inputMode="numeric"
              placeholder="2468"
              className="mt-1 block w-28 rounded-xl border-2 border-line bg-paper px-3 py-2 font-normal"
            />
          </label>
        </div>
      </div>
      <p className="mt-2 text-sm text-ink-soft">Demo staff PIN: 2468.</p>
      <div className="mt-2">
        <ModeBadge paypal={cfg?.paypalMode} ai={cfg?.aiMode} />
      </div>

      <div role="tablist" aria-label="Shop tasks" className="mt-6 flex gap-2 border-b border-line">
        {(
          [
            ["list", "List what's left"],
            ["pickup", "Hand over a bag"],
            ["board", "Tonight's board"],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 font-bold rounded-t-xl -mb-px border-b-4 ${tab === t ? "border-ink text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="pt-6">
        {tab === "list" && <ListSurplus shop={shop} pin={pin} onDone={() => setTab("board")} />}
        {tab === "pickup" && <Pickup shopId={shop.id} pin={pin} />}
        {tab === "board" && <Board shopId={shop.id} pin={pin} />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ 1. List surplus
type Proposal = {
  items: { name: string; count: number; allergens: string[]; unitValueCents: number }[];
  bags: {
    title: string;
    description: string;
    contents: { name: string; count: number }[];
    valueCents: number;
    priceCents: number;
    quantity: number;
    weightGrams: number;
    tags: string[];
  }[];
  notes: string;
  warnings: string[];
};
type AgentResult = { mandateId: string; buyerName: string; agentName: string; reserved: boolean; reason?: string; listingId: string };

function defaultPickup(closesAt: string) {
  const now = new Date();
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit", hour12: false });
  const inAnHour = f.format(new Date(now.getTime() + 60 * 60_000));
  const nowHm = f.format(now);
  // before closing: collect until closing; otherwise give an hour from now
  return nowHm < closesAt && closesAt > inAnHour ? closesAt : inAnHour;
}

function ListSurplus({ shop, pin, onDone }: { shop: (typeof SHOPS)[number]; pin: string; onDone: () => void }) {
  const [photo, setPhoto] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [pickupUntil, setPickupUntil] = useState("");
  const [phase, setPhase] = useState<"idle" | "reading" | "review" | "publishing" | "published">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [agentResults, setAgentResults] = useState<AgentResult[] | null>(null);
  const [publishMs, setPublishMs] = useState(0);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (phase !== "reading") return;
    const started = Date.now();
    const t = setInterval(() => setElapsed((Date.now() - started) / 1000), 100);
    return () => clearInterval(t);
  }, [phase]);

  async function pick(file?: File) {
    if (!file) return;
    setError(null);
    setPhoto(await fileToDataUrl(file));
    setProposal(null);
    setPhase("idle");
  }

  async function read() {
    if (!photo) return;
    setPhase("reading");
    setError(null);
    try {
      const r = await api<{ proposal: Proposal }>("/api/shop/analyze", { body: { shopId: shop.id, photo, note }, pin });
      setProposal(r.proposal);
      setPickupUntil((prev) => prev || defaultPickup(shop.closesAt));
      setPhase("review");
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? "Enter the staff PIN first (demo PIN 2468)." : (e as Error).message);
      setPhase("idle");
    }
  }

  async function publish() {
    if (!proposal) return;
    setPhase("publishing");
    setError(null);
    const t0 = performance.now();
    try {
      const r = await api<{ agentResults: AgentResult[]; listings: { id: string; title: string }[] }>("/api/listings", {
        body: { shopId: shop.id, photo, pickupUntil, bags: proposal.bags, items: proposal.items, aiNotes: proposal.notes },
        pin,
      });
      setPublishMs(performance.now() - t0);
      setTitles(Object.fromEntries(r.listings.map((l) => [l.id, l.title])));
      setAgentResults(r.agentResults);
      setPhase("published");
    } catch (e) {
      setError((e as Error).message);
      setPhase("review");
    }
  }

  function updateBag(i: number, patch: Partial<Proposal["bags"][number]>) {
    setProposal((p) => (p ? { ...p, bags: p.bags.map((b, j) => (j === i ? { ...b, ...patch } : b)) } : p));
  }
  function updateItemAllergens(name: string, allergens: string[]) {
    setProposal((p) => (p ? { ...p, items: p.items.map((it) => (it.name === name ? { ...it, allergens } : it)) } : p));
  }

  if (phase === "published" && agentResults) {
    const reserved = agentResults.filter((a) => a.reserved);
    return (
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <h2 className="text-3xl font-extrabold">On sale.</h2>
          <p className="mt-2 text-lg">
            Published in {(publishMs / 1000).toFixed(1)} s.{" "}
            {reserved.length > 0
              ? `${reserved.length} bag${reserved.length === 1 ? " was" : "s were"} reserved straight away by customers' AI assistants, each with a PayPal hold.`
              : "No standing orders matched this time; it's visible to everyone nearby."}
          </p>
          <div className="mt-5 flex gap-3 flex-wrap">
            <Button onClick={onDone}>See tonight&apos;s board</Button>
            <Button
              variant="secondary"
              onClick={() => {
                setPhoto(null);
                setProposal(null);
                setAgentResults(null);
                setPhase("idle");
              }}
            >
              List another photo
            </Button>
          </div>
        </div>
        <div className="rounded-2xl bg-paper border border-line p-5">
          <p className="font-bold">What customers&apos; AI assistants did</p>
          {agentResults.length === 0 && <p className="text-ink-soft mt-2">No AI assistants have standing orders near this shop yet.</p>}
          {Object.entries(
            agentResults.reduce<Record<string, AgentResult[]>>((acc, a) => {
              (acc[a.listingId] ??= []).push(a);
              return acc;
            }, {}),
          ).map(([listingId, rows]) => (
            <div key={listingId} className="mt-3">
              <p className="text-sm font-bold text-ink-soft">{titles[listingId] ?? "Bag"}</p>
              <ul className="mt-1 space-y-1.5">
                {rows.map((a) => (
                  <li key={a.mandateId} className={`rounded-xl px-3 py-2 ${a.reserved ? "bg-hold-soft" : "bg-flour"}`}>
                    <span className="font-bold">{a.agentName}</span>{" "}
                    {a.reserved ? (
                      <span className="text-hold font-bold">reserved one for {a.buyerName}. PayPal hold placed.</span>
                    ) : (
                      <span className="text-ink-soft">skipped it. {a.reason}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="mt-3 text-sm text-ink-soft">Each assistant can only spend inside the limits its owner set. Crumb checks those limits in code, not the AI.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <div>
        <h2 className="text-2xl font-bold">Photograph what&apos;s left</h2>
        <p className="text-ink-soft mt-1">The counter, a tray or a shelf. AI counts items, flags allergens and suggests rescue bags and prices.</p>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="mt-4 w-full aspect-[4/3] rounded-2xl border-2 border-dashed border-ink/40 hover:border-ink bg-paper grid place-items-center overflow-hidden"
        >
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="Your photo of today's leftovers" className="w-full h-full object-cover" />
          ) : (
            <span className="text-center px-6">
              <span className="block font-display font-bold text-xl">Take or choose a photo</span>
              <span className="block text-ink-soft">JPEG or PNG; it&apos;s resized on your device first.</span>
            </span>
          )}
        </button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
        {(SAMPLES[shop.id] ?? []).length > 0 && (
          <div className="mt-3">
            <p className="text-sm text-ink-soft">No food to hand? Try a sample photo:</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {SAMPLES[shop.id].map((s) => (
                <button
                  key={s.src}
                  type="button"
                  onClick={async () => pick(await sampleFile(s.src))}
                  className="flex items-center gap-2 rounded-xl border-2 border-line bg-paper pr-3 hover:border-ink"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.src} alt="" className="w-12 h-12 rounded-l-[10px] object-cover" />
                  <span className="text-sm font-bold">{s.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <label className="block mt-4 text-sm font-bold" htmlFor="note">
          Anything AI should know? <span className="font-normal text-ink-soft">(optional)</span>
        </label>
        <input
          id="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. the rolls are vegan; keep 2 croissants back"
          className="mt-1 w-full rounded-xl border-2 border-line bg-paper px-3 py-2.5"
        />
        <Button className="mt-4 w-full" disabled={!photo || phase === "reading"} onClick={read}>
          {phase === "reading" ? `Reading your counter… ${elapsed.toFixed(1)} s` : "Turn this photo into listings"}
        </Button>
        {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}
      </div>

      <div>
        {!proposal && (
          <div className="h-full min-h-64 rounded-2xl kraft p-6 grid place-items-center text-center">
            <p className="max-w-[36ch] text-[1.05rem]">
              Your listings appear here to check. Nothing goes on sale until you press <strong>Publish</strong>.
            </p>
          </div>
        )}
        {proposal && (
          <div>
            <h2 className="text-2xl font-bold">Check and publish</h2>
            {proposal.warnings.length > 0 && (
              <div className="mt-3 rounded-xl bg-sticker/60 px-4 py-3">
                <p className="font-bold">Please double-check</p>
                <ul className="list-disc pl-5">{proposal.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
              </div>
            )}

            <details className="mt-4 rounded-xl bg-paper border border-line px-4 py-3" open>
              <summary className="font-bold cursor-pointer">{proposal.items.length} items spotted, allergens flagged</summary>
              <ul className="mt-2 divide-y divide-line">
                {proposal.items.map((it) => (
                  <li key={it.name} className="py-2 grid grid-cols-[1fr_auto] gap-2 items-center">
                    <span>
                      {it.count} × {it.name} <span className="text-ink-soft text-sm">usually {money(it.unitValueCents)}</span>
                    </span>
                    <input
                      aria-label={`Allergens in ${it.name}`}
                      defaultValue={it.allergens.join(", ")}
                      onBlur={(e) => updateItemAllergens(it.name, e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
                      className="w-44 rounded-lg border border-line bg-flour px-2 py-1 text-sm"
                    />
                  </li>
                ))}
              </ul>
            </details>

            <ul className="mt-4 space-y-4">
              {proposal.bags.map((b, i) => {
                const floor = Math.ceil((b.valueCents * shop.minPricePct) / 100);
                return (
                  <li key={i} className="rounded-2xl bg-paper border-2 border-line p-4 grid grid-cols-[1fr_auto] gap-4">
                    <div className="min-w-0">
                      <input
                        aria-label="Bag name"
                        value={b.title}
                        onChange={(e) => updateBag(i, { title: e.target.value })}
                        className="w-full font-display font-bold text-xl bg-transparent border-b-2 border-transparent focus:border-ink outline-none"
                      />
                      <p className="text-ink-soft text-[0.95rem]">{b.contents.map((c) => `${c.count} × ${c.name}`).join(", ")}</p>
                      <div className="mt-3 flex flex-wrap gap-4 items-end">
                        <label className="text-sm font-bold">
                          Price
                          <input
                            type="number"
                            step="0.01"
                            min={floor / 100}
                            value={(b.priceCents / 100).toFixed(2)}
                            onChange={(e) => updateBag(i, { priceCents: Math.round(Number(e.target.value) * 100) })}
                            className="mt-1 block w-24 rounded-lg border-2 border-line bg-flour px-2 py-1.5 font-normal"
                          />
                        </label>
                        <label className="text-sm font-bold">
                          Bags
                          <input
                            type="number"
                            min={1}
                            max={50}
                            value={b.quantity}
                            onChange={(e) => updateBag(i, { quantity: Math.max(1, Number(e.target.value)) })}
                            className="mt-1 block w-20 rounded-lg border-2 border-line bg-flour px-2 py-1.5 font-normal"
                          />
                        </label>
                        <span className="text-sm text-ink-soft pb-2">
                          Worth {money(b.valueCents)}; your floor is {money(floor)}
                        </span>
                      </div>
                      {b.tags.length > 0 && <p className="mt-2 text-sm">{b.tags.join(", ")}</p>}
                    </div>
                    <Sticker priceCents={Math.max(floor, b.priceCents)} valueCents={b.valueCents} size={78} />
                  </li>
                );
              })}
            </ul>

            <div className="mt-4 flex flex-wrap items-end gap-4">
              <label className="text-sm font-bold">
                Collect by
                <input
                  type="time"
                  value={pickupUntil}
                  onChange={(e) => setPickupUntil(e.target.value)}
                  className="mt-1 block rounded-lg border-2 border-line bg-paper px-2 py-1.5 font-normal"
                />
              </label>
              <Button onClick={publish} disabled={phase === "publishing"} className="grow">
                {phase === "publishing" ? "Publishing…" : `Publish ${proposal.bags.reduce((s, b) => s + b.quantity, 0)} bags`}
              </Button>
            </div>
            {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ 2. Pickup
type Res = {
  id: string;
  status: string;
  buyerName: string;
  channel: string;
  agentName: string | null;
  amountCents: number;
  capturedCents: number;
};
type BagCheck = {
  expected: { name: string; count: number }[];
  found: { name: string; count: number }[];
  missing: { name: string; count: number }[];
  fraction: number;
  confidence: number;
  summary: string;
};

function Pickup({ shopId, pin }: { shopId: string; pin: string }) {
  const [code, setCode] = useState("");
  const [res, setRes] = useState<Res | null>(null);
  const [listing, setListing] = useState<{ title: string; contents: { name: string; count: number }[] } | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [check, setCheck] = useState<BagCheck | null>(null);
  const [amount, setAmount] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setCode("");
    setRes(null);
    setListing(null);
    setPhoto(null);
    setCheck(null);
    setError(null);
  }

  async function lookup() {
    setBusy("lookup");
    setError(null);
    try {
      const r = await api<{ reservation: Res; listing: { title: string; contents: { name: string; count: number }[] } }>("/api/pickup/lookup", {
        body: { shopId, code },
        pin,
      });
      setRes(r.reservation);
      setListing(r.listing);
      setAmount(r.reservation.amountCents);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? "Enter the staff PIN first (demo PIN 2468)." : (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function runCheck(file?: File) {
    if (!file || !res) return;
    const p = await fileToDataUrl(file, 1024);
    setPhoto(p);
    setBusy("check");
    setError(null);
    try {
      const r = await api<{ bagCheck: BagCheck; proposedCents: number }>(`/api/reservations/${res.id}/bagcheck`, { body: { photo: p }, pin });
      setCheck(r.bagCheck);
      setAmount(r.proposedCents);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handover(cents: number) {
    if (!res) return;
    setBusy("handover");
    setError(null);
    try {
      const r = await api<{ reservation: Res }>(`/api/reservations/${res.id}/handover`, { body: { amountCents: cents }, pin });
      setRes(r.reservation);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!res) {
    return (
      <div className="max-w-md">
        <h2 className="text-2xl font-bold">Enter the customer&apos;s pickup code</h2>
        <p className="text-ink-soft mt-1">It&apos;s the 6-digit number on their ticket.</p>
        <form
          className="mt-4 flex gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            lookup();
          }}
        >
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            aria-label="Pickup code"
            placeholder="000000"
            className="w-44 rounded-xl border-2 border-line bg-paper px-3 py-2.5 font-display font-bold text-2xl tracking-[0.15em] tabular-nums"
          />
          <Button type="submit" disabled={code.length !== 6 || busy === "lookup"}>
            {busy === "lookup" ? "Finding…" : "Find reservation"}
          </Button>
        </form>
        {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}
      </div>
    );
  }

  const done = res.status !== "held";
  const released = res.amountCents - amount;
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div>
        <div className="flex items-center gap-3">
          <StatusPill status={res.status} />
          {res.channel === "agent" && <span className="text-sm text-ink-soft">Reserved by {res.agentName}</span>}
        </div>
        <h2 className="mt-2 text-3xl font-extrabold">
          {listing?.title} for {res.buyerName}
        </h2>
        <p className="text-ink-soft">{money(res.amountCents)} is held on their PayPal.</p>
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {listing?.contents.map((c) => {
            const found = check?.found.find((f) => f.name === c.name)?.count;
            return (
              <li key={c.name} className="py-2 flex justify-between">
                <span>
                  {c.count} × {c.name}
                </span>
                {check && (
                  <span className={`font-bold ${found === c.count ? "text-charged" : "text-alert"}`}>
                    {found === c.count ? "In the bag" : `${found ?? 0} of ${c.count} in the bag`}
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        {!done && (
          <>
            <p className="mt-6 font-bold">Open the bag and take a photo so the customer pays only for what&apos;s inside.</p>
            <div className="mt-3 flex flex-wrap gap-3">
              <Button onClick={() => fileRef.current?.click()} disabled={busy === "check"}>
                {busy === "check" ? "Checking the bag…" : photo ? "Retake bag photo" : "Photograph the open bag"}
              </Button>
              <Button variant="secondary" onClick={() => handover(res.amountCents)} disabled={!!busy}>
                Skip check, charge {money(res.amountCents)}
              </Button>
            </div>
            <button
              type="button"
              className="mt-3 text-sm underline text-ink-soft hover:text-ink disabled:opacity-50"
              disabled={busy === "check"}
              onClick={async () => runCheck(await sampleFile(SAMPLE_BAG))}
            >
              No bag to hand? Use a sample photo (2 croissants)
            </button>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => runCheck(e.target.files?.[0])} />
          </>
        )}
        {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}
      </div>

      <div>
        {photo && !done && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="Photo of the open bag" className="w-full max-h-72 object-cover rounded-2xl" />
        )}
        {check && !done && (
          <div className="mt-4 rounded-2xl bg-paper border-2 border-ink p-5">
            <p className="font-bold text-lg">{check.summary}</p>
            <p className="text-sm text-ink-soft">AI confidence {Math.round(check.confidence * 100)}%. You have the final say.</p>
            <label className="block mt-4 text-sm font-bold" htmlFor="amount">
              Charge the customer
            </label>
            <div className="flex items-center gap-3 mt-1">
              <input
                id="amount"
                type="range"
                min={0}
                max={res.amountCents}
                step={1}
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                className="grow accent-[--color-charged]"
              />
              <span className="font-display font-extrabold text-2xl tabular-nums w-24 text-right">{money(amount)}</span>
            </div>
            <Button className="mt-4 w-full" onClick={() => handover(amount)} disabled={!!busy}>
              {busy === "handover"
                ? "Talking to PayPal…"
                : amount === 0
                  ? "Release the hold (nothing charged)"
                  : released > 0
                    ? `Charge ${money(amount)} and release ${money(released)}`
                    : `Charge ${money(amount)}`}
            </Button>
          </div>
        )}
        {done && listing && (
          <div>
            <Notice tone="ok">
              {res.status === "captured" ? `Done. ${money(res.capturedCents)} charged through PayPal.` : "Hold released. The customer paid nothing."}
            </Notice>
            <div className="mt-4">
              <MoneyReceipt
                status={res.status}
                amountCents={res.amountCents}
                capturedCents={res.capturedCents}
                title={listing.title}
                shopName={SHOPS.find((s) => s.id === shopId)?.name ?? ""}
                missing={check?.missing}
              />
            </div>
            <Button variant="secondary" className="mt-4" onClick={reset}>
              Next customer
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ 3. Board
type FeedData = {
  events: FeedEvent[];
  stats: { rescuedBags: number; rescuedKg: number; revenueCents: number; savedByBagCheckCents: number; voidedHolds: number; agentBags: number };
  active: { id: string; buyerName: string; channel: string; agentName: string | null; status: string; amountCents: number; pickupCode?: string; listingTitle: string }[];
  listings: { id: string; title: string; priceCents: number; valueCents: number; remaining: number; quantity: number; status: string; pickupEnd: string }[];
};

function Board({ shopId, pin }: { shopId: string; pin: string }) {
  const { data, reload } = usePoll<FeedData>(`/api/feed?shopId=${shopId}`, 3000);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useMemo(() => data?.listings.filter((l) => l.status === "live" || l.status === "sold_out") ?? [], [data]);

  async function cancel(id: string) {
    if (!confirm("Cancel this listing? Every hold on it is released straight away; nobody is charged.")) return;
    setBusy(id);
    setError(null);
    try {
      await api(`/api/listings/${id}/cancel`, { body: { reason: "the shop ran out" }, pin });
      await reload();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? "Enter the staff PIN first (demo PIN 2468)." : (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!data) return <p className="text-ink-soft">Loading…</p>;
  return (
    <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr]">
      <div>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Bags rescued" value={String(data.stats.rescuedBags)} />
          <Stat label="Food saved" value={`${data.stats.rescuedKg} kg`} />
          <Stat label="Taken through PayPal" value={money(data.stats.revenueCents)} />
          <Stat label="Sold to AI agents" value={String(data.stats.agentBags)} />
        </dl>

        <h2 className="mt-8 text-xl font-bold">On sale now</h2>
        {live.length === 0 && (
          <p className="text-ink-soft mt-1">
            Nothing on sale. <Link className="underline font-bold" href="/shop">List what&apos;s left</Link>.
          </p>
        )}
        <ul className="mt-2 space-y-3">
          {live.map((l) => (
            <li key={l.id} className="rounded-2xl bg-paper border border-line p-4 flex items-center gap-4">
              <Sticker priceCents={l.priceCents} valueCents={l.valueCents} size={56} />
              <div className="grow min-w-0">
                <p className="font-bold">{l.title}</p>
                <p className="text-sm text-ink-soft">
                  {l.remaining} of {l.quantity} left, collect by {prettyTime(l.pickupEnd)}
                </p>
              </div>
              <Button variant="danger" className="text-sm px-3 py-2" onClick={() => cancel(l.id)} disabled={busy === l.id}>
                {busy === l.id ? "Cancelling…" : "We ran out"}
              </Button>
            </li>
          ))}
        </ul>
        {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}

        <h2 className="mt-8 text-xl font-bold">Waiting to be collected</h2>
        {data.active.length === 0 && <p className="text-ink-soft mt-1">No open reservations.</p>}
        <ul className="mt-2 divide-y divide-line border-y border-line">
          {data.active.map((a) => (
            <li key={a.id} className="py-2.5 grid grid-cols-[1fr_auto] gap-2 items-center">
              <span>
                <span className="font-bold">{a.buyerName}</span>
                {a.channel === "agent" ? <span className="text-ink-soft"> via {a.agentName}</span> : null}
                <span className="block text-sm text-ink-soft">
                  {a.listingTitle}, code {a.pickupCode}
                </span>
              </span>
              <span className="text-right">
                <StatusPill status={a.status} />
                <span className="block text-sm font-bold text-hold">{money(a.amountCents)} held</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2 className="text-xl font-bold">Every money movement, explained</h2>
        <EventFeed events={data.events} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-paper border border-line p-3">
      <dt className="text-sm text-ink-soft">{label}</dt>
      <dd className="font-display font-extrabold text-2xl tabular-nums">{value}</dd>
    </div>
  );
}
