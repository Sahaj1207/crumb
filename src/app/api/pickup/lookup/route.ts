import { route, requireShop, body } from "@/lib/api";
import { findByPickupCode, getListing } from "@/lib/core";

export const POST = route(async (req: Request) => {
  requireShop(req);
  const { shopId, code } = await body<{ shopId: string; code: string }>(req);
  const r = await findByPickupCode(shopId, code);
  const listing = await getListing(r.listingId);
  return Response.json({ reservation: { ...r, bagCheck: r.bagCheck ? { ...r.bagCheck, photo: undefined } : null }, listing: { ...listing, photo: undefined } });
});
