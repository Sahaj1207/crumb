import { GoogleGenAI, type Content, type FunctionDeclaration } from "@google/genai";
import { route, body } from "@/lib/api";
import { mandateByToken, logEvent } from "@/lib/core";
import { AI_MODE, withFallback } from "@/lib/ai";
import * as tools from "@/lib/agent-tools";
import type { Mandate } from "@/lib/db/schema";

export const maxDuration = 60;

/**
 * In-browser buyer agent, so judges can try agentic commerce without installing an MCP client.
 * Same tools as the MCP server (src/lib/agent-tools.ts), same mandate limits enforced in code.
 */
const DECLS: FunctionDeclaration[] = [
  { name: "my_rules", description: "Show the owner's spending rules.", parametersJsonSchema: { type: "object", properties: {} } },
  {
    name: "find_surplus_food",
    description: "Search live surplus-food bags near the owner, closest first.",
    parametersJsonSchema: { type: "object", properties: { query: { type: "string" }, max_price_usd: { type: "number" } } },
  },
  {
    name: "check_rules",
    description: "Dry run: would reserving this bag pass every rule?",
    parametersJsonSchema: { type: "object", properties: { listing_id: { type: "string" } }, required: ["listing_id"] },
  },
  {
    name: "reserve_bag",
    description: "Reserve one bag with a PayPal hold on the owner's saved PayPal. Refused if any rule fails.",
    parametersJsonSchema: { type: "object", properties: { listing_id: { type: "string" } }, required: ["listing_id"] },
  },
  { name: "my_reservations", description: "Recent reservations with status and pickup codes.", parametersJsonSchema: { type: "object", properties: {} } },
  {
    name: "cancel_reservation",
    description: "Cancel before pickup; voids the PayPal hold.",
    parametersJsonSchema: { type: "object", properties: { reservation_id: { type: "string" } }, required: ["reservation_id"] },
  },
];

async function runTool(m: Mandate, name: string, args: Record<string, unknown>) {
  switch (name) {
    case "my_rules":
      return tools.mandateSummary(m);
    case "find_surplus_food":
      return tools.findSurplusFood(m, args as { query?: string; max_price_usd?: number });
    case "check_rules":
      return tools.checkMandate(m, args as { listing_id: string });
    case "reserve_bag":
      return tools.reserveBag(m, args as { listing_id: string });
    case "my_reservations":
      return tools.myReservations(m);
    case "cancel_reservation":
      return tools.cancelReservation(m, args as { reservation_id: string });
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

type Msg = { role: "user" | "assistant"; text: string };
type Step = { tool: string; args: Record<string, unknown>; result: unknown };

export const POST = route(async (req: Request) => {
  const { token, messages } = await body<{ token: string; messages: Msg[] }>(req);
  const m = await mandateByToken(token);
  const steps: Step[] = [];
  const call = async (name: string, args: Record<string, unknown>) => {
    let result: unknown;
    try {
      result = await runTool(m, name, args);
    } catch (e) {
      result = { error: (e as Error).message };
    }
    steps.push({ tool: name, args, result });
    return result;
  };

  if (AI_MODE === "mock") {
    // Deterministic stand-in: find → check → reserve the first bag that passes every rule.
    const found = (await call("find_surplus_food", {})) as Awaited<ReturnType<typeof tools.findSurplusFood>>;
    for (const r of found.results.filter((x) => x.within_your_radius)) {
      const chk = (await call("check_rules", { listing_id: r.listing_id })) as Awaited<ReturnType<typeof tools.checkMandate>>;
      if (chk.allowed) {
        const res = (await call("reserve_bag", { listing_id: r.listing_id })) as { reserved: boolean; pickup_code?: string; pickup_until?: string };
        if (res.reserved)
          return Response.json({
            reply: `Done — I reserved "${r.title}" at ${r.shop} for ${r.price}. It's a hold on your PayPal, not a charge. Pickup code ${res.pickup_code}, collect by ${res.pickup_until}.`,
            steps,
          });
      }
    }
    return Response.json({ reply: "Nothing nearby fits your rules right now, so I didn't reserve anything.", steps });
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const contents: Content[] = messages.slice(-12).map((x) => ({ role: x.role === "assistant" ? "model" : "user", parts: [{ text: x.text }] }));
  const system = `You are ${m.agentName}, shopping for ${m.buyerName} on Crumb (same-day surplus food from local shops near PayPal HQ, San Jose).
Rules: call check_rules before reserve_bag; never claim a reservation unless reserve_bag returned reserved=true.
Payments are PayPal holds on ${m.buyerName}'s saved PayPal: nothing is charged until handover, and only for what is in the bag. Mention this briefly when you reserve.
After reserving, tell them the pickup code and time. Be brief and friendly. Prices in USD.
Reply in plain text only: no markdown, no asterisks, no emoji. Short lines are fine.`;

  for (let turn = 0; turn < 6; turn++) {
    const res = await withFallback((model) =>
      ai.models.generateContent({
        model,
        contents,
        config: { systemInstruction: system, tools: [{ functionDeclarations: DECLS }], temperature: 0.3 },
      }),
    );
    const calls = res.functionCalls ?? [];
    if (!calls.length) {
      if (steps.some((s) => s.tool === "reserve_bag")) {
        await logEvent({ actor: "agent", type: "agent.chat", message: `${m.agentName} answered ${m.buyerName} after ${steps.length} tool call(s)`, mandateId: m.id });
      }
      return Response.json({ reply: res.text ?? "", steps });
    }
    contents.push(res.candidates?.[0]?.content ?? { role: "model", parts: calls.map((c) => ({ functionCall: c })) });
    const parts = [];
    for (const c of calls) {
      const out = await call(c.name!, (c.args ?? {}) as Record<string, unknown>);
      parts.push({ functionResponse: { name: c.name!, response: { output: out } } });
    }
    contents.push({ role: "user", parts });
  }
  return Response.json({ reply: "I ran out of steps — please try a simpler request.", steps });
});
