import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { ensureSeed } from "@/lib/seed";
import { mandateByToken, CrumbError } from "@/lib/core";
import * as tools from "@/lib/agent-tools";
import type { Mandate } from "@/lib/db/schema";

export const maxDuration = 60;

/**
 * Crumb MCP server (stateless Streamable HTTP).
 * Connect any MCP client with:  URL  <base>/api/mcp   header  Authorization: Bearer <agent token>
 * The token belongs to one mandate; the agent can only spend inside that mandate's limits.
 */
function buildServer(m: Mandate) {
  const server = new McpServer(
    { name: "crumb-surplus-food", version: "1.0.0" },
    {
      instructions: `You are shopping for ${m.buyerName}. Crumb sells same-day surplus food from local shops at a discount.
Payments are PayPal HOLDS on ${m.buyerName}'s saved PayPal: nothing is charged until the food is handed over, and only for what is in the bag.
Always run check_rules before reserve_bag and tell ${m.buyerName} the pickup code and time after reserving.`,
    },
  );
  const wrap = (fn: () => Promise<unknown>) => async () => {
    try {
      const out = await fn();
      return { content: [{ type: "text" as const, text: JSON.stringify(out, null, 2) }] };
    } catch (e) {
      return { isError: true, content: [{ type: "text" as const, text: (e as Error).message }] };
    }
  };

  server.registerTool(
    "my_rules",
    { title: "My spending rules", description: `Show the limits ${m.buyerName} set for you (budget, distance, diet).`, annotations: { readOnlyHint: true } },
    wrap(() => tools.mandateSummary(m)),
  );
  server.registerTool(
    "find_surplus_food",
    {
      title: "Find surplus food nearby",
      description: "Search live surplus-food bags near the owner, closest first.",
      inputSchema: {
        query: z.string().optional().describe("e.g. 'bread', 'vegetarian', 'dinner'"),
        max_price_usd: z.number().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => wrap(() => tools.findSurplusFood(m, args))(),
  );
  server.registerTool(
    "check_rules",
    {
      title: "Check a bag against my rules",
      description: "Dry run: would reserving this bag pass every rule (budget, distance, time, diet)?",
      inputSchema: { listing_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async (args) => wrap(() => tools.checkMandate(m, args))(),
  );
  server.registerTool(
    "reserve_bag",
    {
      title: "Reserve a bag (PayPal hold)",
      description: "Reserve one bag. Places a PayPal authorization hold on the owner's saved PayPal — not a charge. Refused if any rule fails.",
      inputSchema: { listing_id: z.string() },
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async (args) => wrap(() => tools.reserveBag(m, args))(),
  );
  server.registerTool(
    "my_reservations",
    { title: "My reservations", description: "Recent reservations with status, pickup codes and what was charged.", annotations: { readOnlyHint: true } },
    wrap(() => tools.myReservations(m)),
  );
  server.registerTool(
    "cancel_reservation",
    {
      title: "Cancel a reservation",
      description: "Cancel before pickup. Voids the PayPal hold so nothing is charged.",
      inputSchema: { reservation_id: z.string() },
    },
    async (args) => wrap(() => tools.cancelReservation(m, args))(),
  );
  return server;
}

async function handle(req: Request) {
  try {
    await ensureSeed();
    const m = await mandateByToken(req.headers.get("authorization") ?? new URL(req.url).searchParams.get("token"));
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const server = buildServer(m);
    await server.connect(transport);
    return await transport.handleRequest(req);
  } catch (e) {
    const status = e instanceof CrumbError ? e.status : 500;
    return Response.json({ jsonrpc: "2.0", error: { code: -32001, message: (e as Error).message }, id: null }, { status });
  }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
