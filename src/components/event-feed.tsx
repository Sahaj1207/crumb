"use client";
import { prettyTime } from "@/lib/time";

export type FeedEvent = { id: number; actor: string; type: string; message: string; createdAt: string };

const ACTOR: Record<string, { label: string; cls: string }> = {
  shop: { label: "Shop", cls: "bg-kraft-soft text-ink" },
  buyer: { label: "Buyer", cls: "bg-flour text-ink border border-line" },
  agent: { label: "AI agent", cls: "bg-hold-soft text-hold" },
  ai: { label: "AI", cls: "bg-sticker text-sticker-ink" },
  paypal: { label: "PayPal", cls: "bg-ink text-flour" },
  system: { label: "Crumb", cls: "bg-flour text-ink-soft border border-line" },
};

/** The audit roll: who did what with whose money, in order. */
export function EventFeed({ events, max = 40 }: { events: FeedEvent[]; max?: number }) {
  if (!events.length) return <p className="mt-2 text-ink-soft">Nothing has happened yet tonight.</p>;
  return (
    <ol className="receipt mt-3 rounded-t-lg px-4 pt-3 text-[0.85rem] max-h-[36rem] overflow-y-auto" aria-live="polite">
      {events.slice(0, max).map((e) => {
        const a = ACTOR[e.actor] ?? ACTOR.system;
        return (
          <li key={e.id} className="py-2 border-b border-dashed border-line last:border-0 grid grid-cols-[4.2rem_1fr] gap-2">
            <span className="text-ink-soft tabular-nums">{prettyTime(e.createdAt)}</span>
            <span>
              <span className={`inline-block rounded px-1.5 mr-1.5 font-semibold font-sans text-[0.75rem] ${a.cls}`}>{a.label}</span>
              {e.message}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
