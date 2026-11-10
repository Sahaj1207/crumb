import { route } from "@/lib/api";
import { getListing, getReservation, getShop } from "@/lib/core";

/** Buyer's ticket: status, pickup code (only once held), what happened to their money. */
export const GET = route(async (_req: Request, ctx: RouteContext<"/api/reservations/[id]">) => {
  const { id } = await ctx.params;
  const r = await getReservation(id);
  const listing = await getListing(r.listingId);
  const shop = await getShop(r.shopId);
  return Response.json({
    reservation: {
      ...r,
      pickupCode: r.status === "pending_approval" || r.status === "failed" ? null : r.pickupCode,
      bagCheck: r.bagCheck ? { ...r.bagCheck, photo: undefined } : null,
    },
    listing: { ...listing, photo: undefined },
    shop,
  });
});
