"use client";
import { usePoll, money } from "@/lib/client";
import { EventFeed, type FeedEvent } from "@/components/event-feed";

type Feed = {
  events: FeedEvent[];
  stats: {
    rescuedBags: number;
    rescuedKg: number;
    co2eKg: number;
    revenueCents: number;
    savedByBagCheckCents: number;
    voidedHolds: number;
    agentBags: number;
    buyerSavingsCents: number;
  };
};

export default function Ledger() {
  const { data } = usePoll<Feed>("/api/feed", 4000);
  const s = data?.stats;
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-4xl font-extrabold">The ledger</h1>
      <p className="mt-2 max-w-[65ch] text-lg text-ink-soft">
        Every hold, charge and release across all shops, with the reason it happened. These numbers are counted from real PayPal sandbox transactions in this
        demo, not estimates (except CO₂e).
      </p>

      {s && (
        <dl className="mt-8 grid gap-3 grid-cols-2 md:grid-cols-4">
          <Big label="Bags rescued" value={String(s.rescuedBags)} />
          <Big label="Food kept out of the bin" value={`${s.rescuedKg} kg`} />
          <Big label="Paid to local shops" value={money(s.revenueCents)} />
          <Big label="Saved by customers vs full price" value={money(s.buyerSavingsCents)} />
          <Small label="Not charged because the bag check found items missing" value={money(s.savedByBagCheckCents)} />
          <Small label="Holds released with nothing to refund" value={String(s.voidedHolds)} />
          <Small label="Bags reserved by AI assistants" value={String(s.agentBags)} />
          <Small label="CO₂e avoided (≈2.5 kg per kg of food, FAO estimate)" value={`${s.co2eKg.toFixed(1)} kg`} />
        </dl>
      )}

      <h2 className="mt-10 text-2xl font-bold">Live audit trail</h2>
      <p className="text-ink-soft">Shop actions, AI suggestions, agent decisions (including refusals) and PayPal events.</p>
      <EventFeed events={data?.events ?? []} max={80} />
    </div>
  );
}

function Big({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-paper border border-line p-4">
      <dt className="text-sm text-ink-soft">{label}</dt>
      <dd className="font-display font-extrabold text-4xl tabular-nums mt-1">{value}</dd>
    </div>
  );
}
function Small({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl p-4 kraft">
      <dt className="text-sm">{label}</dt>
      <dd className="font-display font-bold text-2xl tabular-nums mt-1">{value}</dd>
    </div>
  );
}
