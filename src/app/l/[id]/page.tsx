"use client";
import { useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, money, useConfig, usePoll, useStored, timeLeftLabel } from "@/lib/client";
import { prettyTime } from "@/lib/time";
import { Sticker, StatusPill, BagGlyph, Notice } from "@/components/bits";
import { PayPalHoldButton } from "@/components/paypal-hold-button";
import { markGuide } from "@/lib/guide";

type Data = {
  listing: {
    id: string;
    title: string;
    description: string;
    contents: { name: string; count: number; allergens: string[] }[];
    tags: string[];
    valueCents: number;
    priceCents: number;
    remaining: number;
    quantity: number;
    pickupEnd: string;
    photo: string | null;
    status: string;
    aiNotes: string;
  };
  shop: { id: string; name: string; address: string; noShowFeePct: number };
};

export default function ListingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const cfg = useConfig();
  const { data, error } = usePoll<Data>(`/api/listings/${id}`, 5000);
  const [name, setName] = useStored("crumb.buyerName", "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const resRef = useRef("");

  if (error && !data) return <Centered>Couldn&apos;t load this bag: {error}</Centered>;
  if (!data) return <Centered>Loading…</Centered>;
  const { listing: l, shop } = data;
  const allergens = [...new Set(l.contents.flatMap((c) => c.allergens))];
  const canReserve = l.status === "live" && l.remaining > 0;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/" className="text-ink-soft font-bold hover:text-ink">← Tonight</Link>
      <div className="mt-4 grid gap-8 sm:grid-cols-[1fr_1.1fr]">
        <div className="relative">
          {l.photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={l.photo} alt={`What was left at ${shop.name}`} className="w-full aspect-[16/10] sm:aspect-square object-cover rounded-2xl" />
          ) : (
            <div className="kraft w-full aspect-[16/10] sm:aspect-square rounded-2xl grid place-items-center">
              <BagGlyph className="w-32 h-32" />
            </div>
          )}
          <span className="absolute -bottom-4 -right-2">
            <Sticker priceCents={l.priceCents} valueCents={l.valueCents} size={104} animate />
          </span>
        </div>

        <div>
          <StatusPill status={l.status} />
          <h1 className="mt-3 text-4xl font-extrabold">{l.title}</h1>
          <p className="mt-1 text-lg">
            <strong>{shop.name}</strong>, {shop.address}
          </p>
          {l.description && <p className="mt-3 text-ink-soft">{l.description}</p>}

          <h2 className="mt-6 text-lg font-bold">In each bag</h2>
          <ul className="mt-1 divide-y divide-line border-y border-line">
            {l.contents.map((c) => (
              <li key={c.name} className="py-2 flex justify-between gap-4">
                <span>
                  {c.count} × {c.name}
                </span>
                <span className="text-sm text-ink-soft">{c.allergens.join(", ")}</span>
              </li>
            ))}
          </ul>
          {allergens.length > 0 && <p className="mt-2 text-sm text-ink-soft">Allergens flagged by AI and confirmed by the shop: {allergens.join(", ")}.</p>}

          <dl className="mt-5 grid grid-cols-2 gap-3 text-[0.95rem]">
            <div className="rounded-xl bg-paper border border-line p-3">
              <dt className="text-ink-soft text-sm">Collect by</dt>
              <dd className="font-bold">{prettyTime(l.pickupEnd)}</dd>
              <dd className="text-sm text-ink-soft">{timeLeftLabel(l.pickupEnd)}</dd>
            </div>
            <div className="rounded-xl bg-paper border border-line p-3">
              <dt className="text-ink-soft text-sm">Price</dt>
              <dd className="font-bold">
                {money(l.priceCents)} <span className="font-normal text-ink-soft line-through">{money(l.valueCents)}</span>
              </dd>
              <dd className="text-sm text-ink-soft">{l.remaining} of {l.quantity} left</dd>
            </div>
          </dl>

          <div className="mt-6 rounded-2xl bg-paper border-2 border-ink p-5">
            {canReserve ? (
              <>
                <p className="font-bold text-lg">Reserve with a PayPal hold</p>
                <p className="text-ink-soft mt-1 text-[0.95rem]">
                  {money(l.priceCents)} is held, not charged. At the counter you pay only for what&apos;s in your bag. If the shop runs out, the hold is released and
                  there&apos;s nothing to refund.
                  {shop.noShowFeePct > 0 ? ` If you don't collect, this shop keeps a ${shop.noShowFeePct}% no-show fee.` : " Not collecting costs nothing here."}
                </p>
                <label className="block mt-4 text-sm font-bold" htmlFor="name">
                  First name for the pickup
                </label>
                <input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-xl border-2 border-line bg-flour px-3 py-2.5 focus:border-ink outline-none"
                  placeholder="Priya"
                  autoComplete="given-name"
                />
                <div className="mt-4 min-h-12">
                  {cfg && (
                    <PayPalHoldButton
                      mode={cfg.paypalMode}
                      clientId={cfg.paypalClientId}
                      disabled={busy || !name.trim()}
                      createOrder={async () => {
                        setErr(null);
                        const r = await api<{ reservationId: string; orderId: string }>("/api/reservations", {
                          body: { listingId: l.id, buyerName: name },
                        });
                        resRef.current = r.reservationId;
                        sessionStorage.setItem(`crumb.order.${r.orderId}`, r.reservationId);
                        return { orderId: r.orderId };
                      }}
                      onApproved={async (orderId) => {
                        setBusy(true);
                        const reservationId = resRef.current || sessionStorage.getItem(`crumb.order.${orderId}`)!;
                        const ok = await api<{ reservation: { pickupCode: string } }>(`/api/reservations/${reservationId}/approve`, { body: { orderId } });
                        markGuide(2, { reservationId, pickupCode: ok.reservation.pickupCode });
                        router.push(`/r/${reservationId}`);
                      }}
                      onCancel={() => {
                        if (resRef.current) api(`/api/reservations/${resRef.current}/abandon`, { method: "POST" }).catch(() => {});
                      }}
                      onError={(e) => {
                        setBusy(false);
                        setErr((e as Error)?.message ?? "PayPal could not complete the hold");
                      }}
                    />
                  )}
                </div>
                {!name.trim() ? (
                  <p className="mt-2 text-sm text-ink-soft">Add your first name so staff know the bag is yours.</p>
                ) : (
                  cfg?.paypalMode === "sandbox" && (
                    <p className="mt-2 text-sm text-ink-soft">PayPal&apos;s window may say &ldquo;Complete Purchase&rdquo;. It only places the hold; nothing is charged until pickup.</p>
                  )
                )}
              </>
            ) : (
              <p className="font-bold">This bag isn&apos;t available any more. <Link className="underline" href="/">See what else is left</Link>.</p>
            )}
            {err && <div className="mt-3"><Notice tone="error">{err}</Notice></div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-3xl px-4 py-16 text-center text-ink-soft">{children}</div>;
}
