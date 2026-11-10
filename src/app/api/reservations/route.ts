import { route, body } from "@/lib/api";
import { startAppReservation } from "@/lib/core";

/** Buyer taps "Reserve": we take one bag off the shelf and create a PayPal AUTHORIZE order. */
export const POST = route(async (req: Request) => {
  const { listingId, buyerName } = await body<{ listingId: string; buyerName?: string }>(req);
  return Response.json(await startAppReservation(listingId, buyerName ?? "Guest"));
});
