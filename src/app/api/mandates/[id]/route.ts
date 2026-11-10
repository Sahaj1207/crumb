import { eq } from "drizzle-orm";
import { route } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { CrumbError } from "@/lib/core";

/**
 * Owner view of one mandate, including the agent token to paste into an MCP client.
 * Demo simplification: anyone with the mandate id can see its token. A real deployment
 * would put this behind the owner's login (PayPal "Log in with PayPal" would fit).
 */
export const GET = route(async (_req: Request, ctx: RouteContext<"/api/mandates/[id]">) => {
  const { id } = await ctx.params;
  const db = await getDb();
  const [m] = await db.select().from(schema.mandates).where(eq(schema.mandates.id, id));
  if (!m) throw new CrumbError("Mandate not found", 404);
  const { vaultId, paypalCustomerId: _c, ...rest } = m;
  return Response.json({ mandate: { ...rest, paypalSaved: !!vaultId } });
});
