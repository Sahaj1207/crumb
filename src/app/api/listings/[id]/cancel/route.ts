import { route, requireShop, body } from "@/lib/api";
import { cancelListing } from "@/lib/core";

export const POST = route(async (req: Request, ctx: RouteContext<"/api/listings/[id]/cancel">) => {
  requireShop(req);
  const { id } = await ctx.params;
  const { reason } = await body<{ reason?: string }>(req).catch(() => ({ reason: undefined }));
  return Response.json(await cancelListing(id, reason));
});
