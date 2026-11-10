"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { api, money, useConfig, usePoll } from "@/lib/client";
import { Button, Notice, ModeBadge } from "@/components/bits";
import { PayPalSaveButton } from "@/components/paypal-hold-button";

type MandateRow = {
  id: string;
  buyerName: string;
  agentName: string;
  preferences: string;
  maxPerOrderCents: number;
  maxPerWeekCents: number;
  radiusKm: number;
  earliestPickup: string;
  standingOrder: boolean;
  active: boolean;
  paypalSaved: boolean;
};
type MandateFull = MandateRow & { token: string };

export default function AgentsPage() {
  return (
    <Suspense fallback={<p className="p-10 text-center text-ink-soft">Loading…</p>}>
      <Agents />
    </Suspense>
  );
}

function Agents() {
  const params = useSearchParams();
  const router = useRouter();
  const cfg = useConfig();
  const { data, reload } = usePoll<{ mandates: MandateRow[] }>("/api/mandates", 8000);
  const selected = params.get("m") ?? data?.mandates[0]?.id ?? null;
  const [full, setFull] = useState<MandateFull | null>(null);

  useEffect(() => {
    if (!selected) return;
    api<{ mandate: MandateFull }>(`/api/mandates/${selected}`).then((r) => setFull(r.mandate)).catch(() => setFull(null));
  }, [selected, data]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-4xl font-extrabold">Let your AI assistant rescue dinner</h1>
      <p className="mt-2 max-w-[65ch] text-lg text-ink-soft">
        Set the rules once: budget, distance, diet. Save your PayPal for your assistant. When a nearby shop lists something that fits, your assistant reserves it
        with a PayPal hold. It can never spend outside your rules; Crumb checks them in code before any money moves.
      </p>
      <div className="mt-2">
        <ModeBadge paypal={cfg?.paypalMode} ai={cfg?.aiMode} />
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[16rem_1fr]">
        <nav aria-label="People">
          <p className="text-sm font-bold text-ink-soft mb-2">People in the demo</p>
          <ul className="space-y-2">
            {data?.mandates.map((m) => (
              <li key={m.id}>
                <button
                  onClick={() => router.replace(`/agent?m=${m.id}`)}
                  className={`w-full text-left rounded-xl px-3 py-2.5 border-2 ${selected === m.id ? "border-ink bg-paper" : "border-transparent hover:bg-paper"}`}
                >
                  <span className="font-bold">{m.buyerName}</span>
                  <span className="block text-sm text-ink-soft">
                    {m.paypalSaved ? "PayPal saved" : "PayPal not saved yet"}, up to {money(m.maxPerOrderCents)} a bag
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {full && cfg && (
          <div className="space-y-8 min-w-0">
            <RulesEditor key={full.id} m={full} onSaved={reload} />
            <SavePayPal key={`pp-${full.id}`} m={full} mode={cfg.paypalMode} clientId={cfg.paypalClientId} onSaved={reload} />
            <ChatWithAgent key={`chat-${full.id}`} m={full} />
            <Connect m={full} />
          </div>
        )}
      </div>
    </div>
  );
}

function RulesEditor({ m, onSaved }: { m: MandateFull; onSaved: () => void }) {
  const [f, setF] = useState(m);
  const [msg, setMsg] = useState<string | null>(null);
  const field = "mt-1 block w-full rounded-xl border-2 border-line bg-paper px-3 py-2 font-normal";
  return (
    <section>
      <h2 className="text-2xl font-bold">{m.buyerName}&apos;s rules for {m.agentName}</h2>
      <form
        className="mt-3 grid gap-4 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setMsg(null);
          await api("/api/mandates", { body: { ...f, id: m.id } });
          setMsg("Rules saved. They apply to the next reservation.");
          onSaved();
        }}
      >
        <label className="text-sm font-bold sm:col-span-2">
          Food preferences and allergies (plain words)
          <input className={field} value={f.preferences} onChange={(e) => setF({ ...f, preferences: e.target.value })} />
        </label>
        <label className="text-sm font-bold">
          Most per bag ($)
          <input type="number" step="0.5" min="1" className={field} value={f.maxPerOrderCents / 100} onChange={(e) => setF({ ...f, maxPerOrderCents: Math.round(Number(e.target.value) * 100) })} />
        </label>
        <label className="text-sm font-bold">
          Weekly budget ($)
          <input type="number" step="1" min="1" className={field} value={f.maxPerWeekCents / 100} onChange={(e) => setF({ ...f, maxPerWeekCents: Math.round(Number(e.target.value) * 100) })} />
        </label>
        <label className="text-sm font-bold">
          How far I&apos;ll walk (km)
          <input type="number" step="0.1" min="0.2" className={field} value={f.radiusKm} onChange={(e) => setF({ ...f, radiusKm: Number(e.target.value) })} />
        </label>
        <label className="text-sm font-bold">
          I can collect from
          <input type="time" className={field} value={f.earliestPickup} onChange={(e) => setF({ ...f, earliestPickup: e.target.value })} />
        </label>
        <label className="sm:col-span-2 flex items-center gap-3 font-bold">
          <input type="checkbox" className="w-5 h-5" checked={f.standingOrder} onChange={(e) => setF({ ...f, standingOrder: e.target.checked })} />
          Standing order: reserve automatically the moment something that fits is listed
        </label>
        <div className="sm:col-span-2 flex items-center gap-4">
          <Button type="submit">Save rules</Button>
          {msg && <span className="text-charged font-bold">{msg}</span>}
        </div>
      </form>
    </section>
  );
}

function SavePayPal({ m, mode, clientId, onSaved }: { m: MandateFull; mode: "sandbox" | "mock"; clientId: string | null; onSaved: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  return (
    <section className="rounded-2xl bg-paper border border-line p-5">
      <h2 className="text-xl font-bold">Save PayPal for your assistant</h2>
      <p className="text-ink-soft mt-1">
        Uses PayPal&apos;s vault, so your assistant can place holds while you&apos;re busy. It never sees your login, and every hold stays inside the rules above.
      </p>
      {m.paypalSaved || ok ? (
        <p className="mt-3 font-bold text-charged">PayPal is saved for {m.agentName}.</p>
      ) : (
        <div className="mt-4 max-w-sm">
          <PayPalSaveButton
            mode={mode}
            clientId={clientId}
            createVaultToken={() => api<{ vaultSetupToken: string }>(`/api/mandates/${m.id}/vault/setup`, { method: "POST" })}
            onSaved={async (vaultSetupToken) => {
              await api(`/api/mandates/${m.id}/vault/confirm`, { body: { vaultSetupToken } });
              setOk(true);
              onSaved();
            }}
            onError={(e) => setErr((e as Error)?.message ?? "PayPal could not save the payment method")}
          />
          <p className="mt-2 text-sm text-ink-soft">This only saves PayPal. Nothing is charged now, whatever the button says.</p>
        </div>
      )}
      {err && <div className="mt-3"><Notice tone="error">{err}</Notice></div>}
    </section>
  );
}

type Step = { tool: string; args: Record<string, unknown>; result: unknown };
type Line = { role: "user" | "assistant"; text: string; steps?: Step[] };

function ChatWithAgent({ m }: { m: MandateFull }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("Find me something for dinner tonight and reserve it if it fits my rules.");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [lines]);

  async function send() {
    const next: Line[] = [...lines, { role: "user", text: input }];
    setLines(next);
    setInput("");
    setBusy(true);
    try {
      const r = await api<{ reply: string; steps: Step[] }>("/api/agent/chat", {
        body: { token: m.token, messages: next.map(({ role, text }) => ({ role, text })) },
      });
      setLines([...next, { role: "assistant", text: r.reply, steps: r.steps }]);
    } catch (e) {
      setLines([...next, { role: "assistant", text: `Error: ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="text-xl font-bold">Ask {m.agentName}</h2>
      <p className="text-ink-soft">A built-in assistant using the same tools any MCP client gets. You can see each tool call it makes.</p>
      <div className="mt-3 rounded-2xl bg-paper border border-line p-4 space-y-3 max-h-[28rem] overflow-y-auto">
        {lines.length === 0 && <p className="text-ink-soft">Try the suggested message below.</p>}
        {lines.map((l, i) => (
          <div key={i} className={l.role === "user" ? "text-right" : ""}>
            <p className={`inline-block max-w-[85%] rounded-2xl px-4 py-2 text-left whitespace-pre-wrap ${l.role === "user" ? "bg-ink text-flour" : "bg-flour"}`}>
              {l.text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1")}
            </p>
            {l.steps && l.steps.length > 0 && (
              <details className="mt-1 text-sm">
                <summary className="cursor-pointer text-ink-soft">{l.steps.length} tool call{l.steps.length === 1 ? "" : "s"}</summary>
                <ol className="mt-1 space-y-1 font-receipt text-[0.8rem]">
                  {l.steps.map((s, j) => (
                    <li key={j} className="rounded-lg bg-flour p-2 overflow-x-auto">
                      <span className="font-semibold">{s.tool}</span>({JSON.stringify(s.args)})
                      <pre className="whitespace-pre-wrap text-ink-soft">{JSON.stringify(s.result, null, 1).slice(0, 900)}</pre>
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim() && !busy) send();
        }}
      >
        <input
          aria-label={`Message ${m.agentName}`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="grow rounded-xl border-2 border-line bg-paper px-3 py-2.5"
        />
        <Button type="submit" disabled={busy || !input.trim()}>
          {busy ? "Working…" : "Send"}
        </Button>
      </form>
    </section>
  );
}

function Connect({ m }: { m: MandateFull }) {
  const [show, setShow] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const token = show ? m.token : "agt_••••••••••••";
  const cli = `claude mcp add --transport http crumb ${origin}/api/mcp --header "Authorization: Bearer ${token}"`;
  const json = JSON.stringify({ mcpServers: { crumb: { type: "http", url: `${origin}/api/mcp`, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);
  return (
    <section id="connect" className="rounded-2xl bg-paper border border-line p-5">
      <h2 className="text-xl font-bold">Connect any AI assistant (MCP)</h2>
      <p className="text-ink-soft mt-1">
        Crumb is an MCP server. The token below lets an assistant act for {m.buyerName} only, inside {m.buyerName}&apos;s rules. Shops publish a UCP profile at{" "}
        <a className="underline" href="/.well-known/ucp">/.well-known/ucp</a> pointing to it.
      </p>
      <Button variant="secondary" className="mt-3 text-sm py-2" onClick={() => setShow((s) => !s)}>
        {show ? "Hide token" : "Show token"}
      </Button>
      <p className="mt-4 text-sm font-bold">Claude Code</p>
      <pre className="mt-1 rounded-xl bg-ink text-flour p-3 text-[0.8rem] overflow-x-auto font-receipt">{cli}</pre>
      <p className="mt-4 text-sm font-bold">Any MCP client that supports HTTP servers</p>
      <pre className="mt-1 rounded-xl bg-ink text-flour p-3 text-[0.8rem] overflow-x-auto font-receipt">{json}</pre>
      <p className="mt-3 text-sm text-ink-soft">Tools: my_rules, find_surplus_food, check_rules, reserve_bag, my_reservations, cancel_reservation.</p>
    </section>
  );
}
