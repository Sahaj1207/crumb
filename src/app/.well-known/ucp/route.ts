/**
 * UCP business profile (https://ucp.dev, protocol 2026-04-08).
 * Advertises Crumb's agent-facing MCP endpoint so AI shopping platforms can discover it.
 *
 * Honest scope note: Crumb is not a certified UCP checkout implementation and is not
 * enrolled in Google AI Mode / Gemini (that requires PayPal Agent Ready + Google onboarding).
 * The profile follows the published shape so the same inventory can plug into Agent Ready later.
 */
import { connection } from "next/server";
export async function GET(req: Request) {
  await connection();
  const origin = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") || new URL(req.url).origin;
  const host = new URL(origin).hostname;
  const ns = host.split(".").reverse().join(".");
  return Response.json(
    {
      ucp: {
        version: "2026-04-08",
        services: {
          "dev.ucp.shopping": [
            {
              version: "2026-04-08",
              spec: "https://ucp.dev/2026-04-08/specification/overview",
              transport: "mcp",
              endpoint: `${origin}/api/mcp`,
            },
          ],
        },
        capabilities: {
          [`${ns}.shopping.surplus_pickup`]: [
            {
              version: "2026-04-08",
              spec: `${origin}/docs/agents`,
              schema: `${origin}/docs/surplus_pickup.schema.json`,
              config: {
                inventory: "perishable, same-day, created from a photo minutes before sale",
                fulfillment: "in-store pickup within a time window, pickup code",
                payment: "PayPal Orders v2 intent=AUTHORIZE on a saved PayPal (Vault v3); captured at handover for what is actually in the bag (partial capture), voided if the shop cancels",
                agent_auth: "Bearer token bound to a buyer mandate (per-order cap, weekly budget, radius, diet)",
              },
            },
          ],
        },
        payment_handlers: {
          "com.paypal.orders_v2": [
            {
              id: "paypal_hold_then_capture",
              version: "2026-04-08",
              spec: "https://developer.paypal.com/docs/checkout/standard/customize/authorization/",
              config: { intent: "AUTHORIZE", vault: "v3 payment tokens", currency: "USD" },
            },
          ],
        },
      },
    },
    { headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } },
  );
}
