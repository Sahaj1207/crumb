"use client";
import { money } from "@/lib/client";

export function Sticker({ priceCents, valueCents, size = 76, animate = false }: { priceCents: number; valueCents?: number; size?: number; animate?: boolean }) {
  const off = valueCents ? Math.round((1 - priceCents / valueCents) * 100) : null;
  return (
    <span
      className={`sticker ${animate ? "sticker-drop" : ""}`}
      style={{ width: size, height: size, fontSize: size * 0.27, lineHeight: 1 }}
      aria-label={`${money(priceCents)}${off ? `, ${off}% off` : ""}`}
    >
      <span>
        {money(priceCents)}
        {off ? <span className="block font-sans font-bold" style={{ fontSize: size * 0.15, marginTop: 3 }}>{off}% off</span> : null}
      </span>
    </span>
  );
}

const STATUS: Record<string, { label: string; cls: string }> = {
  pending_approval: { label: "Waiting for PayPal", cls: "bg-paper text-ink-soft border border-line" },
  held: { label: "Held, not charged", cls: "bg-hold-soft text-hold" },
  captured: { label: "Collected", cls: "bg-charged-soft text-charged" },
  voided: { label: "Hold released", cls: "bg-flour text-released border border-line" },
  expired: { label: "Not collected", cls: "bg-flour text-released border border-line" },
  failed: { label: "Not completed", cls: "bg-alert-soft text-alert" },
  live: { label: "On sale", cls: "bg-charged-soft text-charged" },
  sold_out: { label: "All reserved", cls: "bg-hold-soft text-hold" },
  cancelled: { label: "Cancelled by shop", cls: "bg-alert-soft text-alert" },
  closed: { label: "Closed", cls: "bg-flour text-released border border-line" },
};

export function StatusPill({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, cls: "bg-paper border border-line" };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-bold ${s.cls}`}>{s.label}</span>;
}

/** The money story of one reservation, as a till receipt. */
export function MoneyReceipt({
  status,
  amountCents,
  capturedCents,
  title,
  shopName,
  missing,
}: {
  status: string;
  amountCents: number;
  capturedCents: number;
  title: string;
  shopName: string;
  missing?: { name: string; count: number }[];
}) {
  const released = status === "captured" || status === "expired" ? amountCents - capturedCents : status === "voided" ? amountCents : 0;
  const rows: { label: string; value: string; cls?: string }[] = [];
  if (status !== "pending_approval" && status !== "failed") rows.push({ label: "Held on PayPal", value: money(amountCents), cls: "text-hold" });
  if (capturedCents > 0) rows.push({ label: status === "expired" ? "No-show fee" : "Charged at handover", value: money(capturedCents), cls: "text-charged" });
  if (released > 0) rows.push({ label: "Released to you", value: money(released), cls: "text-released" });
  return (
    <div className="receipt rounded-t-lg px-5 pt-4 text-[0.9rem] shadow-[0_1px_0_var(--color-line)]">
      <p className="text-center font-semibold">{shopName}</p>
      <p className="text-center text-ink-soft">{title}</p>
      <div className="my-3 border-t border-dashed border-line" />
      {rows.length === 0 && <p className="text-ink-soft">Nothing held yet.</p>}
      {rows.map((r) => (
        <div key={r.label} className="flex justify-between gap-4">
          <span>{r.label}</span>
          <span className={`font-semibold ${r.cls ?? ""}`}>{r.value}</span>
        </div>
      ))}
      {missing && missing.length > 0 && (
        <p className="mt-2 text-alert">Not in bag: {missing.map((m) => `${m.count} × ${m.name}`).join(", ")}</p>
      )}
      <div className="my-3 border-t border-dashed border-line" />
      <div className="flex justify-between font-semibold">
        <span>You paid</span>
        <span>{money(capturedCents)}</span>
      </div>
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "ok"; children: React.ReactNode }) {
  const cls = tone === "error" ? "bg-alert-soft text-alert" : tone === "ok" ? "bg-charged-soft text-charged" : "bg-hold-soft text-hold";
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-lg px-4 py-3 font-bold ${cls}`}>
      {children}
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const v =
    variant === "primary"
      ? "bg-ink text-flour hover:bg-ink/90"
      : variant === "danger"
        ? "bg-paper text-alert border-2 border-alert/40 hover:border-alert"
        : "bg-paper text-ink border-2 border-line hover:border-ink";
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${v} ${className}`}
    >
      {children}
    </button>
  );
}

export function ModeBadge({ paypal, ai }: { paypal?: string; ai?: string }) {
  if (!paypal) return null;
  return (
    <p className="text-sm text-ink-soft">
      {paypal === "mock" ? "Offline demo mode: PayPal is simulated." : "PayPal sandbox: test accounts only, no real money."}{" "}
      {ai === "mock" ? "AI is simulated (no Gemini key)." : ""}
    </p>
  );
}

export function BagGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <path d="M12 18h40l-3.2 38.4a3 3 0 0 1-3 2.6H18.2a3 3 0 0 1-3-2.6z" fill="#b98b5a" />
      <path d="M12 18h40l-.6 6H12.6z" fill="#a37748" />
      <path d="M22 18v-4a10 10 0 0 1 20 0v4" fill="none" stroke="#16201c" strokeWidth="3" />
    </svg>
  );
}
