"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePoll, useConfig, timeLeftLabel, money } from "@/lib/client";
import { Sticker, StatusPill, BagGlyph, ModeBadge } from "@/components/bits";

type Listing = {
  id: string;
  title: string;
  description: string;
  contents: { name: string; count: number; allergens: string[] }[];
  tags: string[];
  valueCents: number;
  priceCents: number;
  quantity: number;
  remaining: number;
  pickupEnd: string;
  photo: string | null;
  status: string;
  shop: { id: string; name: string; kind: string; address: string };
  distanceKm: number | null;
};

// Demo location: PayPal HQ, 2211 North First Street, San Jose
const HERE = { lat: 37.3772, lng: -121.9221 };

export default function Tonight() {
  const cfg = useConfig();
  const { data, error } = usePoll<{ listings: Listing[] }>(`/api/listings?lat=${HERE.lat}&lng=${HERE.lng}`, 4000);
  const seen = useRef<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!data) return;
    const ids = data.listings.map((l) => l.id);
    const isFirst = seen.current.size === 0;
    const newOnes = ids.filter((id) => !seen.current.has(id));
    ids.forEach((id) => seen.current.add(id));
    if (!isFirst && newOnes.length) setFresh(new Set(newOnes));
  }, [data]);

  const listings = data?.listings ?? [];
  const live = listings.filter((l) => l.status === "live");
  const gone = listings.filter((l) => l.status !== "live");

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
      <section className="grid gap-6 sm:grid-cols-[1.4fr_1fr] sm:items-end mb-10">
        <div>
          <h1 className="text-4xl sm:text-6xl font-extrabold">Tonight&apos;s leftovers, a short walk away.</h1>
          <p className="mt-4 max-w-[60ch] text-lg text-ink-soft">
            Local shops photograph what didn&apos;t sell and it&apos;s listed in seconds. Reserve with PayPal: we only <strong className="text-ink">hold</strong> the money,
            and you&apos;re charged at the counter for what&apos;s actually in your bag. Shop runs out? The hold just disappears.
          </p>
        </div>
        <div className="kraft rounded-2xl p-5 text-[0.95rem]">
          <p className="font-display font-bold text-lg">How paying works</p>
          <ol className="mt-2 space-y-1.5 list-decimal pl-5">
            <li>Reserve — PayPal holds the price.</li>
            <li>Collect — staff snap the open bag; AI checks it against the listing.</li>
            <li>Pay only for what&apos;s there. The rest of the hold is released.</li>
          </ol>
        </div>
      </section>

      <div className="flex items-baseline justify-between gap-4 mb-4">
        <h2 className="text-2xl font-bold">{live.length ? `${live.length} bag type${live.length === 1 ? "" : "s"} near PayPal HQ, San Jose` : "Near PayPal HQ, San Jose"}</h2>
        <ModeBadge paypal={cfg?.paypalMode} ai={cfg?.aiMode} />
      </div>

      {error && <p className="text-alert font-bold">Couldn&apos;t load listings: {error}</p>}
      {data && live.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-line p-8 text-center">
          <BagGlyph className="mx-auto w-14 h-14" />
          <p className="mt-3 font-display text-xl font-bold">No bags on sale right now.</p>
          <p className="text-ink-soft mt-1">
            Shops list surplus near closing time. Try it yourself: <Link href="/shop" className="underline font-bold">list a bag as a shop</Link>.
          </p>
        </div>
      )}

      <ul className="grid gap-4 sm:grid-cols-2">
        {live.map((l) => (
          <li key={l.id} className={fresh.has(l.id) ? "row-new rounded-2xl" : ""}>
            <ListingCard l={l} />
          </li>
        ))}
      </ul>

      {gone.length > 0 && (
        <>
          <h2 className="mt-12 mb-3 text-xl font-bold text-ink-soft">Already rescued tonight</h2>
          <ul className="divide-y divide-line border-y border-line">
            {gone.slice(0, 8).map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 py-3">
                <span>
                  <span className="font-bold">{l.title}</span> <span className="text-ink-soft">· {l.shop.name}</span>
                </span>
                <StatusPill status={l.status} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ListingCard({ l }: { l: Listing }) {
  return (
    <Link
      href={`/l/${l.id}`}
      className="group grid grid-cols-[96px_1fr] gap-4 rounded-2xl bg-paper p-4 border border-line hover:border-ink transition-colors h-full"
    >
      <div className="relative">
        {l.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={l.photo} alt="" className="w-24 h-24 rounded-xl object-cover" />
        ) : (
          <div className="kraft w-24 h-24 rounded-xl grid place-items-center">
            <BagGlyph className="w-12 h-12" />
          </div>
        )}
        <span className="absolute -right-3 -bottom-3">
          <Sticker priceCents={l.priceCents} valueCents={l.valueCents} size={58} />
        </span>
      </div>
      <div className="min-w-0">
        <h3 className="text-lg font-bold group-hover:underline">{l.title}</h3>
        <p className="text-ink-soft">
          {l.shop.name}
          {l.distanceKm !== null ? ` · ${l.distanceKm < 1 ? `${Math.round(l.distanceKm * 1000)} m` : `${l.distanceKm.toFixed(1)} km`}` : ""}
        </p>
        <p className="mt-1 text-[0.95rem] truncate">{l.contents.map((c) => `${c.count} ${c.name.toLowerCase()}`).join(", ")}</p>
        <p className="mt-2 text-sm font-bold">
          <span className={l.remaining <= 1 ? "text-alert" : ""}>{l.remaining} left</span>
          <span className="text-ink-soft font-normal"> · {timeLeftLabel(l.pickupEnd)} · worth {money(l.valueCents)}</span>
        </p>
      </div>
    </Link>
  );
}
