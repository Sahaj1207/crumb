"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useConfig } from "@/lib/client";
import { DEMO_PIN, dismissGuide, restartGuide, setGuideOpen, startGuide, useGuide, type GuideState, type GuideStep } from "@/lib/guide";

const BUYER_EMAIL = process.env.NEXT_PUBLIC_DEMO_BUYER_EMAIL;
const BUYER_PASSWORD = process.env.NEXT_PUBLIC_DEMO_BUYER_PASSWORD;

type Step = { n: GuideStep; role: string; title: string; why: string; cta: string; href: (g: GuideState) => string };

const STEPS: Step[] = [
  {
    n: 1,
    role: "Be the shop",
    title: "List tonight's leftovers",
    why: "Tap a sample photo. AI turns it into priced bags with allergens, and you publish. Watch customers' AI assistants react straight away.",
    cta: "Open the shop counter",
    href: () => `/shop?tab=list&pin=${DEMO_PIN}`,
  },
  {
    n: 2,
    role: "Be the customer",
    title: "Reserve a bag with PayPal",
    why: "Open any bag on Tonight. PayPal holds the price, it doesn't charge it. You'll get a pickup code.",
    cta: "See tonight's bags",
    href: () => "/",
  },
  {
    n: 3,
    role: "Back to the shop",
    title: "Hand over the bag",
    why: "Photograph the open bag (a sample is ready). You're charged only for what's inside; the rest of the hold goes straight back.",
    cta: "Open pickup",
    href: (g) => `/shop?tab=pickup&pin=${DEMO_PIN}${g.pickupCode ? `&code=${g.pickupCode}` : ""}`,
  },
  {
    n: 4,
    role: "Meet an AI shopper",
    title: "Ask Maya's assistant for dinner",
    why: "It searches, checks Maya's rules and reserves with her saved PayPal. It can never spend outside the limits she set.",
    cta: "Talk to the agent",
    href: () => "/agent?m=man_maya",
  },
];

/** Floating checklist shown on every page once the tour has started. */
export function GuidePanel() {
  const g = useGuide();
  const cfg = useConfig();
  const pathname = usePathname();
  if (!g.started || g.dismissed) return null;
  const current = STEPS.find((s) => !g.done.includes(s.n));
  const doneCount = g.done.length;

  if (!g.open) {
    return (
      <button
        onClick={() => setGuideOpen(true)}
        className="fixed z-30 bottom-4 right-4 rounded-full bg-ink text-flour px-4 py-2.5 font-bold shadow-[0_6px_20px_rgba(22,32,28,0.25)]"
        aria-label={`Open the tour, ${doneCount} of 4 steps done`}
      >
        Tour {doneCount}/4
      </button>
    );
  }

  return (
    <aside
      aria-label="Crumb tour"
      className="fixed z-30 inset-x-3 bottom-3 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[22rem] max-h-[52dvh] sm:max-h-[70dvh] overflow-y-auto rounded-2xl bg-paper border-2 border-ink shadow-[0_10px_30px_rgba(22,32,28,0.22)]"
    >
      <div className="sticky top-0 bg-paper flex items-center gap-2 px-4 pt-3 pb-2 border-b border-line">
        <p className="font-display font-bold text-lg grow">{current ? "Try Crumb in 4 steps" : "You've seen it all"}</p>
        <span className="text-sm font-bold text-ink-soft tabular-nums">{doneCount}/4</span>
        <button onClick={() => setGuideOpen(false)} className="rounded-lg px-2 py-1 text-ink-soft hover:bg-flour hover:text-ink" aria-label="Minimise the tour">
          ▾
        </button>
        <button onClick={dismissGuide} className="rounded-lg px-2 py-1 text-ink-soft hover:bg-flour hover:text-ink" aria-label="Close the tour">
          ✕
        </button>
      </div>
      <ol className="px-4 py-3 space-y-3">
        {STEPS.map((s) => {
          const done = g.done.includes(s.n);
          const isCurrent = current?.n === s.n;
          return (
            <li key={s.n} className="grid grid-cols-[1.75rem_1fr] gap-2">
              <span
                aria-hidden
                className={`mt-0.5 grid place-items-center w-6 h-6 rounded-full text-[0.8rem] font-bold ${
                  done ? "bg-charged text-paper" : isCurrent ? "bg-sticker text-sticker-ink" : "border-2 border-line text-ink-soft"
                }`}
              >
                {done ? "✓" : s.n}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-ink-soft">{s.role}</p>
                <p className={`font-bold leading-snug ${done ? "text-ink-soft line-through decoration-1" : ""}`}>{s.title}</p>
                {isCurrent && (
                  <>
                    <p className="mt-1 text-[0.92rem] text-ink-soft">{s.why}</p>
                    {s.n === 1 && <p className="mt-1 text-sm">Staff PIN {DEMO_PIN} is filled in for you.</p>}
                    {s.n === 2 && cfg?.paypalMode === "sandbox" && BUYER_EMAIL && (
                      <p className="mt-1 text-sm rounded-lg bg-flour px-2 py-1.5 break-all">
                        PayPal sandbox login: <strong>{BUYER_EMAIL}</strong>
                        {BUYER_PASSWORD ? (
                          <>
                            {" "}
                            / <strong>{BUYER_PASSWORD}</strong>
                          </>
                        ) : null}
                      </p>
                    )}
                    {s.n === 3 && g.pickupCode && <p className="mt-1 text-sm">Your pickup code {g.pickupCode} is filled in.</p>}
                    {!(pathname === "/" && s.n === 2) && (
                      <Link href={s.href(g)} className="mt-2 inline-flex rounded-xl bg-ink text-flour px-3 py-2 text-sm font-bold hover:bg-ink/90">
                        {s.cta}
                      </Link>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {!current && (
        <div className="px-4 pb-4">
          <p className="text-[0.95rem]">
            Every hold, charge and release you just made, with the reason it happened, is in the Ledger.
          </p>
          <div className="mt-2 flex gap-2">
            <Link href="/impact" className="inline-flex rounded-xl bg-ink text-flour px-3 py-2 text-sm font-bold">
              Open the Ledger
            </Link>
            <button onClick={dismissGuide} className="rounded-xl border-2 border-line px-3 py-2 text-sm font-bold hover:border-ink">
              Close tour
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

/** Home-page invitation for first-time visitors. */
export function GuideWelcome() {
  const g = useGuide();
  if (g.started || g.dismissed) return null;
  return (
    <section className="kraft rounded-2xl p-5 mb-8 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
      <div>
        <p className="font-display font-bold text-xl">New here? Try the whole thing in about 3 minutes.</p>
        <p className="mt-1 text-[0.98rem] max-w-[62ch]">
          Crumb is a working demo. You&apos;ll play the shop, the customer and an AI shopper, with real PayPal sandbox payments. No real money moves.
        </p>
      </div>
      <div className="flex gap-2 flex-wrap">
        <button onClick={startGuide} className="rounded-xl bg-ink text-flour px-4 py-3 font-bold hover:bg-ink/90">
          Start the 4-step tour
        </button>
        <button onClick={dismissGuide} className="rounded-xl bg-paper px-4 py-3 font-bold border-2 border-line hover:border-ink">
          I&apos;ll explore myself
        </button>
      </div>
    </section>
  );
}

export function GuideRestartLink() {
  return (
    <button onClick={restartGuide} className="underline">
      Restart the tour
    </button>
  );
}
