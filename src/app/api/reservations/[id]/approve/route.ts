import { route, body } from "@/lib/api";
import { confirmAppReservation } from "@/lib/core";

/** PayPal onApprove: authorize the order = place the hold. */
export const POST = route(async (req: Request, ctx: RouteContext<"/api/reservations/[id]/approve">) => {
  const { id } = await ctx.params;
  const { orderId } = await body<{ orderId: string }>(req);
  const r = await confirmAppReservation(id, orderId);
  return Response.json({ reservation: { id: r.id, status: r.status, pickupCode: r.pickupCode } });
});
