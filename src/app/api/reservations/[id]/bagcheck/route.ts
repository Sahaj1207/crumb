import { route, requireShop, body } from "@/lib/api";
import { runBagCheck, CrumbError } from "@/lib/core";

export const maxDuration = 60;

/** Pickup: AI compares the handover photo with the listing and proposes how much to charge. */
export const POST = route(async (req: Request, ctx: RouteContext<"/api/reservations/[id]/bagcheck">) => {
  requireShop(req);
  const { id } = await ctx.params;
  const { photo } = await body<{ photo: string }>(req);
  if (!photo?.startsWith("data:image/")) throw new CrumbError("Send the bag photo as an image data URL");
  return Response.json(await runBagCheck(id, photo));
});
