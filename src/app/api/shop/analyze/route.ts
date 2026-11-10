import { route, requireShop, body } from "@/lib/api";
import { listFromPhoto } from "@/lib/ai";
import { getShop, logEvent, CrumbError } from "@/lib/core";

export const maxDuration = 60;

export const POST = route(async (req: Request) => {
  requireShop(req);
  const { shopId, photo, note } = await body<{ shopId: string; photo: string; note?: string }>(req);
  if (!photo?.startsWith("data:image/")) throw new CrumbError("Send the counter photo as an image data URL");
  if (photo.length > 6_000_000) throw new CrumbError("Photo too large — please resize to under ~4 MB");
  const shop = await getShop(shopId);
  const started = Date.now();
  const proposal = await listFromPhoto(photo, shop, note);
  await logEvent({
    actor: "ai",
    type: "listing.proposed",
    message: `AI read the counter photo in ${((Date.now() - started) / 1000).toFixed(1)}s: ${proposal.items.length} items → ${proposal.bags.length} rescue bag type(s)`,
    shopId,
    data: { items: proposal.items.length, bags: proposal.bags.length },
  });
  return Response.json({ proposal, ms: Date.now() - started });
});
