import { route, baseUrl } from "@/lib/api";
import { paypal } from "@/lib/paypal";

/** Step 1 of "save PayPal for my agent": a PayPal Vault v3 setup token the buyer approves. */
export const POST = route(async (req: Request, ctx: RouteContext<"/api/mandates/[id]/vault/setup">) => {
  const { id } = await ctx.params;
  const base = baseUrl(req);
  const { setupTokenId } = await paypal.createVaultSetupToken(`${base}/agent?m=${id}&saved=1`, `${base}/agent?m=${id}&cancelled=1`);
  return Response.json({ vaultSetupToken: setupTokenId });
});
