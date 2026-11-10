import { route, requireShop, body } from "@/lib/api";
import { listFromPhoto, isAiUnavailable } from "@/lib/ai";
import { getShop, logEvent, CrumbError } from "@/lib/core";

export const maxDuration = 60;

export const POST = route(async (req: Request) => {
  requireShop(req);
  const { shopId, photo, note } = await body<{ shopId: string; photo: string; note?: string }>(req);
  if (!photo?.startsWith("data:image/")) throw new CrumbError("Send the counter photo as an image data URL");
  if (photo.length > 6_000_000) throw new CrumbError("Photo too large — please resize to under ~4 MB");
  const shop = await getShop(shopId);
  const started = Date.now();
  let proposal;
  try {
    proposal = await listFromPhoto(photo, shop, note);
  } catch (e) {
    if (isAiUnavailable(e))
      throw new CrumbError("The AI is busy right now. Try again in a minute, or use one of the sample photos (they're instant).", 503, "ai_unavailable");
    throw e;
  }
  await logEvent({
    actor: "ai",
    type: "listing.proposed",
    message: `AI read the counter photo in ${((Date.now() - started) / 1000).toFixed(1)}s: ${proposal.items.length} items → ${proposal.bags.length} rescue bag type(s)`,
    shopId,
    data: { items: proposal.items.length, bags: proposal.bags.length },
  });
  return Response.json({ proposal, ms: Date.now() - started });
});
