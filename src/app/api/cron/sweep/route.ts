import { route } from "@/lib/api";
import { sweepExpired } from "@/lib/core";

/** Closing-time sweep: no-shows and stale approvals. Also runs lazily on every listing/feed read. */
export const GET = route(async () => {
  await sweepExpired();
  return Response.json({ ok: true, at: new Date().toISOString() });
});
