"use client";
import { useParams } from "next/navigation";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { usePoll } from "@/lib/client";
import { prettyTime } from "@/lib/time";
import { MoneyReceipt, StatusPill } from "@/components/bits";

type Data = {
  reservation: {
    id: string;
    status: string;
    buyerName: string;
    channel: string;
    agentName: string | null;
    amountCents: number;
    capturedCents: number;
    pickupCode: string | null;
    bagCheck: { summary: string; missing: { name: string; count: number }[] } | null;
  };
  listing: { title: string; pickupEnd: string; contents: { name: string; count: number }[] };
  shop: { name: string; address: string };
};

export default function Ticket() {
  const { id } = useParams<{ id: string }>();
  const { data, error } = usePoll<Data>(`/api/reservations/${id}`, 3000);
  if (error && !data) return <p className="p-10 text-center text-alert font-bold">{error}</p>;
  if (!data) return <p className="p-10 text-center text-ink-soft">Loading your ticket…</p>;
  const { reservation: r, listing, shop } = data;
  const done = ["captured", "voided", "expired"].includes(r.status);

  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <Link href="/" className="text-ink-soft font-bold hover:text-ink">← Tonight</Link>
      <div className="mt-4 flex items-center justify-between">
        <StatusPill status={r.status} />
        {r.channel === "agent" && <span className="text-sm text-ink-soft">Reserved by {r.agentName}</span>}
      </div>
      <h1 className="mt-3 text-3xl font-extrabold">
        {r.status === "held" ? `Show this at ${shop.name}` : r.status === "captured" ? "Enjoy your food" : r.status === "pending_approval" ? "Finish in PayPal" : "This reservation is closed"}
      </h1>
      <p className="text-ink-soft">
        {listing.title} for {r.buyerName}. Collect by {prettyTime(listing.pickupEnd)} at {shop.address}.
      </p>

      {r.status === "held" && r.pickupCode && (
        <div className="mt-6 rounded-2xl bg-paper border-2 border-ink p-6 text-center">
          <p className="text-sm font-bold text-ink-soft">Pickup code</p>
          <p className="font-display font-extrabold text-6xl tracking-[0.12em] tabular-nums">{r.pickupCode}</p>
          <QRCodeSVG value={r.pickupCode} size={132} className="mx-auto mt-4" bgColor="#ffffff" fgColor="#16201c" />
          <p className="mt-4 text-[0.95rem] text-ink-soft">
            Staff will open your bag and take a photo. You&apos;re charged only for what&apos;s inside, and the rest of the hold goes back to your PayPal.
          </p>
        </div>
      )}

      <div className="mt-6">
        <MoneyReceipt
          status={r.status}
          amountCents={r.amountCents}
          capturedCents={r.capturedCents}
          title={listing.title}
          shopName={shop.name}
          missing={r.bagCheck?.missing}
        />
      </div>
      {r.bagCheck && done && <p className="mt-3 text-ink-soft">Bag check: {r.bagCheck.summary}</p>}
    </div>
  );
}
