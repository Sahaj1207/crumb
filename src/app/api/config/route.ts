import { route } from "@/lib/api";
import { AI_MODE } from "@/lib/ai";
import { PAYPAL_MODE } from "@/lib/paypal";

export const GET = route(async () =>
  Response.json({
    paypalMode: PAYPAL_MODE,
    aiMode: AI_MODE,
    paypalClientId: process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || process.env.PAYPAL_CLIENT_ID || null,
  }),
);
