import { eq } from "drizzle-orm";
import { route, body } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { paypal } from "@/lib/paypal";
import { logEvent, CrumbError } from "@/lib/core";

/** Step 2: exchange the approved setup token for a reusable payment token (vault id). */
export const POST = route(async (req: Request, ctx: RouteContext<"/api/mandates/[id]/vault/confirm">) => {
  const { id } = await ctx.params;
  const { vaultSetupToken } = await body<{ vaultSetupToken: string }>(req);
  if (!vaultSetupToken) throw new CrumbError("vaultSetupToken required");
  const db = await getDb();
  const [m] = await db.select().from(schema.mandates).where(eq(schema.mandates.id, id));
  if (!m) throw new CrumbError("Mandate not found", 404);
  const { vaultId, customerId } = await paypal.createPaymentToken(vaultSetupToken);
  await db.update(schema.mandates).set({ vaultId, paypalCustomerId: customerId ?? null }).where(eq(schema.mandates.id, id));
  await logEvent({
    actor: "paypal",
    type: "vault.saved",
    message: `${m.buyerName} saved PayPal for ${m.agentName}. The agent can now place holds — only inside the mandate's limits.`,
    mandateId: id,
  });
  return Response.json({ ok: true });
});
