// End-to-end smoke test against a running Crumb server.
// Usage:  node scripts/smoke-test.mjs [baseUrl]   (run with PAYPAL_MODE=mock for a fully offline run)
const BASE = process.argv[2] ?? "http://localhost:3000";
const PIN = process.env.SHOP_PIN ?? "2468";
const SHOP = "shop_golden_crust";
// 1x1 JPEG as a stand-in photo (the mock AI ignores pixels; real Gemini needs a real photo)
const PHOTO =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};
async function api(path, { method = "GET", body, shop = false, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(shop ? { "x-shop-pin": PIN } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

const cfg = await api("/api/config");
ok(cfg.status === 200, `config: paypal=${cfg.json.paypalMode} ai=${cfg.json.aiMode}`);

const noPin = await api("/api/shop/analyze", { method: "POST", body: { shopId: SHOP, photo: PHOTO } });
ok(noPin.status === 401, "shop endpoints refuse requests without the PIN");

const analyzed = await api("/api/shop/analyze", { method: "POST", shop: true, body: { shopId: SHOP, photo: PHOTO } });
ok(analyzed.status === 200 && analyzed.json.proposal.bags.length > 0, `AI proposed ${analyzed.json.proposal?.bags?.length} bag type(s)`);
const proposal = analyzed.json.proposal;
const floorOk = proposal.bags.every((b) => b.priceCents >= Math.ceil(b.valueCents * 0.3));
ok(floorOk, "every proposed price respects the shop's price floor");

const pickupUntil = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit", hour12: false })
  .format(new Date(Date.now() + 90 * 60_000));
const published = await api("/api/listings", {
  method: "POST",
  shop: true,
  body: { shopId: SHOP, photo: PHOTO, pickupUntil, bags: proposal.bags, items: proposal.items, aiNotes: proposal.notes },
});
ok(published.status === 200, `published ${published.json.listings?.length} listing(s); standing orders: ${JSON.stringify(published.json.agentResults?.map((a) => `${a.buyerName}:${a.reserved ? "reserved" : a.reason}`))}`);
const listing = published.json.listings?.[0];

// Buyer reserves through the app (PayPal approval is simulated in mock mode)
const start = await api("/api/reservations", { method: "POST", body: { listingId: listing.id, buyerName: "Priya" } });
ok(start.status === 200 && start.json.orderId, `reservation started, PayPal order ${start.json.orderId}`);
const approve = await api(`/api/reservations/${start.json.reservationId}/approve`, { method: "POST", body: { orderId: start.json.orderId } });
ok(approve.json.reservation?.status === "held", `hold placed, pickup code ${approve.json.reservation?.pickupCode}`);

const lookup = await api("/api/pickup/lookup", { method: "POST", shop: true, body: { shopId: SHOP, code: approve.json.reservation.pickupCode } });
ok(lookup.json.reservation?.id === start.json.reservationId, "shop finds the reservation by pickup code");

const check = await api(`/api/reservations/${start.json.reservationId}/bagcheck`, { method: "POST", shop: true, body: { photo: PHOTO } });
ok(check.status === 200, `bag check: ${check.json.bagCheck?.summary} → propose ${check.json.proposedCents}¢ of ${listing.priceCents}¢`);

const hand = await api(`/api/reservations/${start.json.reservationId}/handover`, { method: "POST", shop: true, body: { amountCents: check.json.proposedCents } });
ok(hand.json.reservation?.status === "captured" && hand.json.reservation.capturedCents === check.json.proposedCents, `captured ${hand.json.reservation?.capturedCents}¢ (partial: ${hand.json.reservation?.capturedCents < listing.priceCents})`);

const again = await api(`/api/reservations/${start.json.reservationId}/handover`, { method: "POST", shop: true, body: { amountCents: 100 } });
ok(again.status === 409, "cannot capture the same hold twice");

// Agent via MCP
const mandates = await api("/api/mandates");
const maya = mandates.json.mandates.find((m) => m.buyerName === "Maya");
const mayaFull = await api(`/api/mandates/${maya.id}`);
const token = mayaFull.json.mandate.token;
const rpc = async (method, params, id) =>
  api("/api/mcp", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json, text/event-stream" },
    body: { jsonrpc: "2.0", id, method, params },
  });
const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } }, 1);
ok(init.status === 200 && init.json.result?.serverInfo?.name === "crumb-surplus-food", "MCP initialize");
const list = await rpc("tools/list", {}, 2);
ok(list.json.result?.tools?.length === 6, `MCP tools: ${list.json.result?.tools?.map((t) => t.name).join(", ")}`);
const find = await rpc("tools/call", { name: "find_surplus_food", arguments: {} }, 3);
const found = JSON.parse(find.json.result?.content?.[0]?.text ?? "{}");
ok(Array.isArray(found.results), `agent sees ${found.results?.length} live bag(s)`);
const pricey = await rpc("tools/call", { name: "check_rules", arguments: { listing_id: listing.id } }, 4);
ok(!!pricey.json.result, `rules check: ${JSON.parse(pricey.json.result.content[0].text).checks?.join(" | ")}`);
const bad = await api("/api/mcp", { method: "POST", headers: { Authorization: "Bearer nope" }, body: { jsonrpc: "2.0", id: 9, method: "tools/list" } });
ok(bad.status === 401, "MCP rejects unknown agent tokens");

// Shop cancels: every hold is voided instantly
const cancel = await api(`/api/listings/${listing.id}/cancel`, { method: "POST", shop: true, body: { reason: "ran out" } });
ok(cancel.status === 200, `shop cancelled listing, ${cancel.json.voided} hold(s) voided`);

const ucp = await api("/.well-known/ucp");
ok(ucp.status === 200 && ucp.json.ucp?.version, "UCP business profile served at /.well-known/ucp");

const feed = await api(`/api/feed?shopId=${SHOP}`);
ok(feed.json.events?.length > 0, `audit trail has ${feed.json.events?.length} events; stats ${JSON.stringify(feed.json.stats)}`);

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
