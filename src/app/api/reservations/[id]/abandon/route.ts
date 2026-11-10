import { route } from "@/lib/api";
import { abandonAppReservation } from "@/lib/core";

export const POST = route(async (_req: Request, ctx: RouteContext<"/api/reservations/[id]/abandon">) => {
  const { id } = await ctx.params;
  await abandonAppReservation(id);
  return Response.json({ ok: true });
});
