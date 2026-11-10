import { route, requireShop, body } from "@/lib/api";
import { completeHandover } from "@/lib/core";

/** A person confirms the amount: capture (full or partial) or void when the bag is empty. */
export const POST = route(async (req: Request, ctx: RouteContext<"/api/reservations/[id]/handover">) => {
  requireShop(req);
  const { id } = await ctx.params;
  const { amountCents } = await body<{ amountCents: number }>(req);
  const r = await completeHandover(id, amountCents);
  return Response.json({ reservation: { ...r, bagCheck: undefined } });
});
