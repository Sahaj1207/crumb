import "server-only";
import { nanoid } from "nanoid";

/**
 * Thin PayPal REST client for the pieces Crumb needs:
 *  - Orders v2 with intent AUTHORIZE (a hold, not a charge)
 *  - Payments v2: capture (full or partial) and void of an authorization
 *  - Vault v3: save a buyer's PayPal so their AI agent can place holds within a mandate
 *  - Webhook signature verification
 *
 * PAYPAL_MODE=mock swaps in an in-memory fake with the same shapes, so the
 * whole flow can be demoed offline. The default is the real PayPal sandbox.
 */

export const PAYPAL_MODE = (process.env.PAYPAL_MODE ?? "sandbox") as "sandbox" | "mock";
const BASE = "https://api-m.sandbox.paypal.com";

export class PayPalError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown,
    public debugId?: string,
  ) {
    super(message);
  }
}

const usd = (cents: number) => ({ currency_code: "USD", value: (cents / 100).toFixed(2) });

// ---------------------------------------------------------------- auth
let cachedToken: { token: string; expiresAt: number } | undefined;

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) {
    throw new PayPalError(
      "PayPal is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET, or PAYPAL_MODE=mock.",
      500,
    );
  }
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok) throw new PayPalError("PayPal auth failed", res.status, json);
  cachedToken = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cachedToken.token;
}

async function call<T = Record<string, unknown>>(
  path: string,
  init: { method?: string; body?: unknown; requestId?: string } = {},
  retried = false,
): Promise<T> {
  try {
    return await callOnce<T>(path, init);
  } catch (e) {
    // Permissions changed in the dashboard (e.g. Vault switched on) only reach freshly issued tokens.
    if (!retried && e instanceof PayPalError && (e.status === 401 || e.status === 403)) {
      cachedToken = undefined;
      return call<T>(path, init, true);
    }
    throw e;
  }
}

async function callOnce<T>(path: string, init: { method?: string; body?: unknown; requestId?: string }): Promise<T> {
  const token = await accessToken();
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.requestId ? { "PayPal-Request-Id": init.requestId } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const detail = json?.details?.[0];
    const msg = detail ? `${detail.issue}: ${detail.description}` : json?.message ?? res.statusText;
    throw new PayPalError(`PayPal ${path} failed — ${msg}`, res.status, json, json?.debug_id);
  }
  return json as T;
}

// ---------------------------------------------------------------- types
export type HoldOrder = { orderId: string; status: string };
export type Authorization = { authorizationId: string; status: string; expiresAt?: string };
export type CaptureResult = { captureId: string; status: string; amountCents: number };

type OrderInput = {
  reservationId: string;
  amountCents: number;
  description: string;
  shopName: string;
  /** saved PayPal (vault) — when present the hold is placed without the buyer being present */
  vaultId?: string;
};

function orderBody(o: OrderInput) {
  return {
    intent: "AUTHORIZE",
    purchase_units: [
      {
        reference_id: o.reservationId,
        custom_id: o.reservationId,
        description: o.description.slice(0, 127),
        soft_descriptor: "CRUMB",
        amount: { ...usd(o.amountCents), breakdown: { item_total: usd(o.amountCents) } },
        items: [
          {
            name: o.description.slice(0, 127),
            quantity: "1",
            unit_amount: usd(o.amountCents),
            category: "PHYSICAL_GOODS",
          },
        ],
      },
    ],
    payment_source: o.vaultId
      ? { paypal: { vault_id: o.vaultId } }
      : {
          paypal: {
            experience_context: {
              brand_name: `Crumb · ${o.shopName}`.slice(0, 127),
              shipping_preference: "NO_SHIPPING",
              user_action: "CONTINUE",
            },
          },
        },
  };
}

type PayPalOrder = {
  id: string;
  status: string;
  purchase_units?: {
    payments?: { authorizations?: { id: string; status: string; expiration_time?: string }[] };
  }[];
};

function firstAuth(order: PayPalOrder): Authorization | undefined {
  const a = order.purchase_units?.[0]?.payments?.authorizations?.[0];
  return a ? { authorizationId: a.id, status: a.status, expiresAt: a.expiration_time } : undefined;
}

// ---------------------------------------------------------------- real client
const real = {
  async createHoldOrder(o: OrderInput): Promise<HoldOrder & { authorization?: Authorization }> {
    const order = await call<PayPalOrder>("/v2/checkout/orders", {
      body: orderBody(o),
      requestId: `order-${o.reservationId}`,
    });
    // A vaulted (saved) PayPal order with intent AUTHORIZE comes back already authorized.
    return { orderId: order.id, status: order.status, authorization: firstAuth(order) };
  },

  async authorizeOrder(orderId: string): Promise<Authorization> {
    const order = await call<PayPalOrder>(`/v2/checkout/orders/${orderId}/authorize`, {
      body: {},
      requestId: `auth-${orderId}`,
    });
    const auth = firstAuth(order);
    if (!auth) throw new PayPalError("PayPal returned no authorization", 502, order);
    return auth;
  },

  async getOrder(orderId: string) {
    return call<PayPalOrder>(`/v2/checkout/orders/${orderId}`, { method: "GET" });
  },

  /** Capture part or all of a hold. final_capture releases whatever is not captured. */
  async captureAuthorization(
    authorizationId: string,
    amountCents: number,
    note: string,
    invoiceId: string,
  ): Promise<CaptureResult> {
    const res = await call<{ id: string; status: string; amount?: { value: string } }>(
      `/v2/payments/authorizations/${authorizationId}/capture`,
      {
        body: {
          amount: usd(amountCents),
          final_capture: true,
          invoice_id: invoiceId,
          note_to_payer: note.slice(0, 255),
        },
        requestId: `cap-${authorizationId}`,
      },
    );
    return {
      captureId: res.id,
      status: res.status,
      amountCents: Math.round(Number(res.amount?.value ?? amountCents / 100) * 100),
    };
  },

  async voidAuthorization(authorizationId: string): Promise<{ status: string }> {
    const res = await call<{ status?: string }>(`/v2/payments/authorizations/${authorizationId}/void`, {
      body: {},
      requestId: `void-${authorizationId}`,
    });
    return { status: res.status ?? "VOIDED" };
  },

  async createVaultSetupToken(returnUrl: string, cancelUrl: string): Promise<{ setupTokenId: string; approveUrl?: string }> {
    const res = await call<{ id: string; links?: { rel: string; href: string }[] }>("/v3/vault/setup-tokens", {
      body: {
        payment_source: {
          paypal: {
            description: "Crumb: let your AI assistant reserve surplus food within your limits",
            usage_type: "MERCHANT",
            experience_context: {
              brand_name: "Crumb",
              shipping_preference: "NO_SHIPPING",
              return_url: returnUrl,
              cancel_url: cancelUrl,
            },
          },
        },
      },
      requestId: `setup-${nanoid(10)}`,
    });
    return { setupTokenId: res.id, approveUrl: res.links?.find((l) => l.rel === "approve")?.href };
  },

  async createPaymentToken(setupTokenId: string): Promise<{ vaultId: string; customerId?: string }> {
    const res = await call<{ id: string; customer?: { id: string } }>("/v3/vault/payment-tokens", {
      body: { payment_source: { token: { id: setupTokenId, type: "SETUP_TOKEN" } } },
      requestId: `ptok-${setupTokenId}`,
    });
    return { vaultId: res.id, customerId: res.customer?.id };
  },

  async verifyWebhook(headers: Headers, body: unknown): Promise<boolean> {
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    if (!webhookId) return false;
    const res = await call<{ verification_status: string }>("/v1/notifications/verify-webhook-signature", {
      body: {
        auth_algo: headers.get("paypal-auth-algo"),
        cert_url: headers.get("paypal-cert-url"),
        transmission_id: headers.get("paypal-transmission-id"),
        transmission_sig: headers.get("paypal-transmission-sig"),
        transmission_time: headers.get("paypal-transmission-time"),
        webhook_id: webhookId,
        webhook_event: body,
      },
    });
    return res.verification_status === "SUCCESS";
  },
};

// ---------------------------------------------------------------- mock client
type MockAuth = { id: string; amountCents: number; status: string };
const mockStore = globalThis as unknown as { __crumbMock?: { orders: Map<string, { auth?: MockAuth; amountCents: number }> } };
mockStore.__crumbMock ??= { orders: new Map() };
const mo = mockStore.__crumbMock.orders;

const mock: typeof real = {
  async createHoldOrder(o) {
    const orderId = `MOCK-ORDER-${nanoid(8).toUpperCase()}`;
    if (o.vaultId) {
      const auth: MockAuth = { id: `MOCK-AUTH-${nanoid(8).toUpperCase()}`, amountCents: o.amountCents, status: "CREATED" };
      mo.set(orderId, { auth, amountCents: o.amountCents });
      return { orderId, status: "COMPLETED", authorization: { authorizationId: auth.id, status: auth.status } };
    }
    mo.set(orderId, { amountCents: o.amountCents });
    return { orderId, status: "CREATED" };
  },
  async authorizeOrder(orderId) {
    const o = mo.get(orderId);
    if (!o) throw new PayPalError("Unknown mock order", 404);
    o.auth ??= { id: `MOCK-AUTH-${nanoid(8).toUpperCase()}`, amountCents: o.amountCents, status: "CREATED" };
    return { authorizationId: o.auth.id, status: o.auth.status };
  },
  async getOrder(orderId) {
    return { id: orderId, status: mo.has(orderId) ? "APPROVED" : "UNKNOWN" };
  },
  async captureAuthorization(authorizationId, amountCents) {
    return { captureId: `MOCK-CAP-${nanoid(8).toUpperCase()}`, status: "COMPLETED", amountCents };
  },
  async voidAuthorization() {
    return { status: "VOIDED" };
  },
  async createVaultSetupToken() {
    return { setupTokenId: `MOCK-SETUP-${nanoid(8).toUpperCase()}` };
  },
  async createPaymentToken() {
    return { vaultId: `MOCK-VAULT-${nanoid(8).toUpperCase()}`, customerId: `MOCK-CUST-${nanoid(6)}` };
  },
  async verifyWebhook() {
    return true;
  },
};

export const paypal = PAYPAL_MODE === "mock" ? mock : real;
