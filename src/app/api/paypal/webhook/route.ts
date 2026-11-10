import { route } from "@/lib/api";
import { paypal, PAYPAL_MODE } from "@/lib/paypal";
import { logEvent } from "@/lib/core";

/**
 * PayPal webhooks: an independent record of what PayPal says happened, next to what Crumb did.
 * Subscribe the sandbox app to PAYMENT.AUTHORIZATION.CREATED, PAYMENT.AUTHORIZATION.VOIDED,
 * PAYMENT.CAPTURE.COMPLETED and VAULT.PAYMENT-TOKEN.CREATED.
 */
export const POST = route(async (req: Request) => {
  const raw = await req.text();
  const event = JSON.parse(raw || "{}");
  const verified = PAYPAL_MODE === "mock" ? true : await paypal.verifyWebhook(req.headers, event).catch(() => false);
  const resource = event.resource ?? {};
  const reservationId: string | undefined = resource.custom_id || resource.invoice_id || undefined;
  const amount = resource.amount?.value ? ` $${resource.amount.value}` : "";
  await logEvent({
    actor: "paypal",
    type: `webhook.${String(event.event_type ?? "unknown").toLowerCase()}`,
    message: `PayPal webhook ${event.event_type}${amount}${verified ? " (signature verified)" : " (unverified — set PAYPAL_WEBHOOK_ID)"}`,
    reservationId: reservationId?.startsWith("res_") ? reservationId : null,
    data: { id: event.id, resourceId: resource.id, status: resource.status, verified },
  });
  return Response.json({ ok: true });
});
