import { route } from "@/lib/api";
import { getListing, getShop, sweepExpired } from "@/lib/core";

export const GET = route(async (_req: Request, ctx: RouteContext<"/api/listings/[id]">) => {
  await sweepExpired();
  const { id } = await ctx.params;
  const listing = await getListing(id);
  const shop = await getShop(listing.shopId);
  return Response.json({ listing, shop });
});
