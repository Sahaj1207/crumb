import { route, requireShop, body } from "@/lib/api";
import { runBagCheck, CrumbError } from "@/lib/core";
import { isAiUnavailable } from "@/lib/ai";

export const maxDuration = 60;

/** Pickup: AI compares the handover photo with the listing and proposes how much to charge. */
export const POST = route(async (req: Request, ctx: RouteContext<"/api/reservations/[id]/bagcheck">) => {
  requireShop(req);
  const { id } = await ctx.params;
  const { photo } = await body<{ photo: string }>(req);
  if (!photo?.startsWith("data:image/")) throw new CrumbError("Send the bag photo as an image data URL");
  try {
    return Response.json(await runBagCheck(id, photo));
  } catch (e) {
    if (isAiUnavailable(e)) throw new CrumbError("The AI bag check is busy right now. Count the bag yourself and set the amount below.", 503, "ai_unavailable");
    throw e;
  }
});
