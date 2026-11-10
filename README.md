# Crumb — tonight's surplus food, paid only on handover

**Local food shops photograph what didn't sell at closing time; AI turns the photo into listings in seconds. People — and their AI assistants — reserve with a PayPal hold that is only charged for what's actually in the bag.**

Built for the **PayPal AI Hackathon 2026** (Devpost). PayPal sandbox only — no real money moves.

- Live demo: **https://crumb-lyart.vercel.app**
- Demo video (under 3 min): `<add YouTube link>`
- Staff PIN for the shop screens: **2468**

---

## The problem

- Food service throws away about **290 million tonnes of food a year** (UNEP Food Waste Index 2024).
- Small bakeries and cafés don't have time to list leftovers item by item at 8 pm, so most of it is binned.
- Surplus-food apps exist, but the most common complaints are about money and trust: **shops cancel or bags come up short, and buyers chase refunds** for food they never got.
- Meanwhile PayPal is building **Agent Ready / Store Sync** so AI assistants can buy from merchants — but tonight's leftover croissants are not in anybody's catalog an hour before closing.

## What Crumb does

| | |
|---|---|
| **Snap to list** | The owner photographs the counter. Gemini vision counts items, flags allergens, groups them into "rescue bags", and suggests a price — clamped in code to the shop's price floor. Nothing goes live until the owner presses Publish. |
| **Hold, don't charge** | Reserving creates a PayPal **Orders v2 order with `intent: AUTHORIZE`**. The buyer's money is held, not taken. |
| **Snap to pay** | At pickup, staff photograph the open bag. AI compares it with the listing and proposes a **partial capture** for exactly what's there; the rest of the hold is released automatically (`final_capture: true`). A person confirms the amount. |
| **Shop ran out?** | One tap **voids** every hold on that listing. Buyers were never charged, so there is nothing to refund. |
| **AI assistants can buy** | Buyers set a mandate (per-bag cap, weekly budget, walking distance, diet in plain words) and save PayPal once via **PayPal Vault v3**. Their assistant — via our **MCP server** or the built-in agent — reserves bags with a hold on the saved PayPal, and **standing orders** grab matching bags the second they are listed. |
| **Explainable money** | Every hold, charge, release and every agent *refusal* ("Not vegan — contains dairy and egg", "Weekly budget: $24.45 used + $5.49 vs $25.00") lands in a public audit trail. |

## How PayPal is used

| PayPal capability | Where | Why |
|---|---|---|
| Orders v2 `POST /v2/checkout/orders` (`intent: AUTHORIZE`) | `src/lib/paypal.ts` `createHoldOrder` | A reservation is a hold, not a payment |
| Orders v2 `POST /v2/checkout/orders/{id}/authorize` | `authorizeOrder` | Places the hold after buyer approval |
| Payments v2 `POST /v2/payments/authorizations/{id}/capture` with a smaller `amount` and `final_capture: true` | `captureAuthorization` | Charge only for what's in the bag; release the rest |
| Payments v2 `POST /v2/payments/authorizations/{id}/void` | `voidAuthorization` | Shop cancels / empty bag / buyer cancels / no-show (if the shop charges no fee) |
| Vault v3 `POST /v3/vault/setup-tokens` + `POST /v3/vault/payment-tokens` | `createVaultSetupToken`, `createPaymentToken` | Buyer saves PayPal for their AI agent |
| Orders v2 with `payment_source.paypal.vault_id` | `createHoldOrder({ vaultId })` | Agent-initiated hold without the buyer present, only inside the mandate |
| JS SDK v6 (`@paypal/react-paypal-js/sdk-v6`): `PayPalOneTimePaymentButton`, `PayPalSavePaymentButton` | `src/components/paypal-hold-button.tsx` | Buyer approval and vaulting UI |
| Webhooks + `POST /v1/notifications/verify-webhook-signature` | `src/app/api/paypal/webhook` | Independent record of what PayPal says happened |
| `PayPal-Request-Id` idempotency keys | every write | Safe retries; a hold can't be captured twice |

## How AI is used (and where it is *not* trusted)

| AI task | Model | Guardrail in code |
|---|---|---|
| Counter photo → items, allergens, bags, prices | Gemini (vision, JSON schema output) | Price clamped to the shop's floor; quantities bounded; owner reviews and edits before publishing |
| Handover photo → what's actually in the bag | Gemini (vision) | The AI only counts; the capture amount is computed in code from the listing's values; staff confirm with a slider before PayPal is called |
| "Does this bag fit *vegetarian, no nuts*?" | Gemini | Only runs after all hard rules (budget, distance, time, saved PayPal) pass in code; unsure ⇒ "does not fit" |
| Built-in buyer agent | Gemini function calling | Same tools as the MCP server; every spend goes through `evaluateMandate()` in `src/lib/core.ts` |

Without a `GEMINI_API_KEY`, a deterministic mock AI is used so the whole app still runs.

## Agentic commerce: MCP + UCP

- **MCP server:** `POST /api/mcp` (stateless Streamable HTTP). Authenticate with `Authorization: Bearer <agent token>` — the token is bound to one buyer's mandate. Tools: `my_rules`, `find_surplus_food`, `check_rules`, `reserve_bag`, `my_reservations`, `cancel_reservation`.
  ```bash
  claude mcp add --transport http crumb https://<your-host>/api/mcp --header "Authorization: Bearer <token from /agent>"
  ```
- **UCP business profile:** `GET /.well-known/ucp` follows the published [UCP 2026-04-08](https://ucp.dev/2026-04-08/specification/overview/) profile shape and advertises the MCP endpoint and the PayPal hold-then-capture payment handler.
- **Honest scope:** Crumb is not enrolled in Google AI Mode / Gemini shopping or ChatGPT checkout — that needs PayPal Agent Ready plus platform onboarding. The demo uses Claude (via MCP) and the built-in agent as buyers. The UCP profile is there so the same live inventory could plug into Agent Ready.

## Try it (judges)

1. Open the live demo. **Tonight** lists bags near PayPal HQ, San Jose (demo world, fictional shops).
2. **For shops** → PIN `2468` → *List what's left*: upload any photo of food, or tap a **sample photo** (free Unsplash images, see `public/samples/CREDITS.md`) → *Turn this photo into listings* → *Publish*. Watch the AI assistants' standing orders react, including the ones that refuse and why.
3. Open a bag from **Tonight** → *Reserve* with the PayPal sandbox buyer below. PayPal's window says "Complete Purchase", but it only places the hold. Your ticket shows a 6-digit pickup code and the hold.
4. **For shops** → *Hand over a bag* → enter the code → photograph the open bag, or use the **sample bag photo (2 croissants)** → confirm the partial charge.
5. **AI agents** → pick Maya → *Save PayPal* (sandbox buyer) → ask the agent to find dinner. Or connect your own MCP client with the snippet on that page.
6. **Ledger** shows every money movement with its reason.

**PayPal sandbox buyer for testing:** `sb-c43r4l53836201@personal.example.com` / `JD{q4y8&` (sandbox only, no real funds).

## Run it locally

Requirements: Node.js 22+.

```bash
git clone <this repo> && cd crumb
npm install
cp .env.example .env.local      # then fill in values (see below)
npm run dev                     # http://localhost:3000
```

- **Fully offline:** set `PAYPAL_MODE=mock` and leave `GEMINI_API_KEY` empty. PayPal and AI are simulated with clearly labelled buttons.
- **PayPal sandbox:** create an app at developer.paypal.com → Apps & Credentials → Sandbox. Set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID`, `PAYPAL_MODE=sandbox`. For agent purchases enable **Save payment methods** (Vault) in the sandbox app's features.
- **AI:** set `GEMINI_API_KEY` (free tier key from aistudio.google.com). `GEMINI_MODEL` defaults to `gemini-3.6-flash`, falling back to `gemini-3.5-flash` and `gemini-3.1-flash-lite` if a model is busy.
- **Database:** leave `DATABASE_URL` empty to use an embedded Postgres (PGlite) in `~/.crumb/pglite`. For deployment use a hosted Postgres URL (Supabase / Neon). Tables are created automatically.
- **Smoke test:** with the server running in mock mode, `node scripts/smoke-test.mjs` exercises the whole flow (19 checks).

## Architecture

```
Next.js 16 (App Router) ── src/app/*          pages: Tonight, listing, ticket, shop console, agents, ledger
                         └ src/app/api/*      JSON API, MCP server, PayPal webhook
src/lib/core.ts      reservations, holds, captures, voids, mandate checks, standing orders, audit log
src/lib/paypal.ts    PayPal REST client (Orders v2, Payments v2, Vault v3, webhooks) + offline mock
src/lib/ai.ts        Gemini vision/JSON calls + deterministic mock
src/lib/agent-tools  buyer-agent tools shared by MCP and the built-in agent
Postgres (Drizzle)   shops, listings, reservations, mandates, events
```

## Limitations (on purpose, for a sandbox demo)

- Shop screens use a shared demo PIN, and an agent token can be viewed by anyone who knows a mandate's id. A real deployment would put both behind proper login (e.g. Log in with PayPal).
- PayPal authorizations have a 3-day honor period; surplus food is collected the same evening, so re-authorization is not needed.
- CO₂e uses a rough ~2.5 kg CO₂e per kg of food wasted (FAO order of magnitude) and is labelled as an estimate.
- Small-ticket fees: on a $2.99 sandbox capture PayPal's standard fee was $0.59; a production version would use PayPal's micropayments pricing for sub-$10 bags.
- AI answers are cached by photo + prompt, so repeating the same sample photo is instant and doesn't use Gemini quota.

## License

MIT — see [LICENSE](LICENSE).
