# Devpost submission text — Crumb

Paste each section into the matching Devpost field. Replace anything in <angle brackets>.

**Project name:** Crumb

**Tagline (short):** Tonight's surplus food — snap to list, snap to pay. PayPal only charges for what's actually in your bag.

**Links**
- Live demo: https://crumb-lyart.vercel.app (shop staff PIN: 2468)
- Code: https://github.com/Sahaj1207/crumb (MIT)
- Video: https://youtu.be/1eq4joiran8

---

## Inspiration
Food service throws away about 290 million tonnes of food a year (UNEP Food Waste Index 2024). Small bakeries and cafés know their leftovers are good, but at 8 pm nobody has time to list them item by item. Surplus-food apps exist, yet their most common complaints are about trust and money: the shop cancels, the bag is half empty, and the buyer has to chase a refund.

At the same time PayPal is building Agent Ready and Store Sync so AI assistants can buy from merchants. We asked: what about inventory that didn't exist an hour ago — tonight's croissants?

## What it does
- **Snap to list:** the owner photographs the counter. Gemini vision counts items, flags allergens, groups them into rescue bags and suggests prices. The shop's price floor is enforced in code, and nothing goes live until the owner presses Publish.
- **Hold, don't charge:** reserving creates a PayPal Orders v2 order with `intent: AUTHORIZE`. The money is held, not taken.
- **Snap to pay:** at pickup, staff photograph the open bag. AI compares it with the listing; Crumb proposes a partial capture for exactly what's there, a person confirms, and PayPal releases the rest automatically (`final_capture: true`).
- **Shop ran out?** One tap voids every hold. Buyers were never charged, so there is nothing to refund.
- **AI assistants can buy:** buyers set a mandate (per-bag cap, weekly budget, distance, diet in plain words) and save PayPal once with PayPal Vault v3. Their assistant — through our MCP server or the built-in agent — reserves with a hold on the saved PayPal. Standing orders grab matching bags the moment they're listed, and refusals come with reasons ("Not vegan — contains dairy and egg").
- **Explainable money:** a public ledger shows every hold, charge, release, AI suggestion and agent decision, alongside signature-verified PayPal webhooks.

## How we built it
- **PayPal:** Orders v2 (create with `AUTHORIZE`, authorize), Payments v2 (partial capture with `final_capture`, void), Vault v3 (setup tokens → payment tokens; orders with `payment_source.paypal.vault_id` for agent holds), JS SDK v6 (`PayPalOneTimePaymentButton`, `PayPalSavePaymentButton`), Webhooks with `verify-webhook-signature`, and `PayPal-Request-Id` idempotency on every write.
- **AI:** Gemini (vision + JSON-schema output) for photo → listing and the handover bag check; Gemini function calling for the built-in buyer agent; plain-language diet matching for standing orders. A model fallback chain and a result cache keep the demo fast and inside free-tier quotas.
- **Agentic commerce:** an MCP server (Streamable HTTP) with tools `find_surplus_food`, `check_rules`, `reserve_bag`, `my_reservations`, `cancel_reservation`, authenticated per buyer mandate; and a UCP business profile at `/.well-known/ucp` advertising it.
- **Stack:** Next.js 16, TypeScript, Tailwind, Drizzle + Postgres (Supabase), deployed on Vercel.

## Guardrails (AI proposes, code decides, people confirm)
- Prices are clamped to the shop's floor in code.
- The bag check only counts items; the capture amount is computed in code from the listing, and staff confirm it before PayPal is called.
- Agents can't spend outside their owner's mandate: budget, per-order cap, distance, pickup time and saved PayPal are all checked in code before the AI is even asked about diet. When unsure, the answer is "does not fit".

## Challenges we ran into
- Making a hold the default without confusing people: PayPal's popup says "Complete Purchase" even for an authorization, so we explain it in the UI.
- PayPal Vault permissions only reached newly issued access tokens after enabling them, so the client now refreshes its token on 401/403.
- Free-tier Gemini models were overloaded or retired during the build; we added a fallback chain with per-attempt timeouts plus caching.
- Sandbox accounts default to the developer's country; for USD holds we used US sandbox business and personal accounts.

## Accomplishments we're proud of
- The whole money story — hold, partial capture, automatic release, void — runs on real PayPal sandbox transactions and is visible on one receipt.
- An AI agent placing a real PayPal hold on a saved PayPal, on its own, strictly inside rules a person set.
- Every agent refusal is explained.

## What we learned
Authorizations are an underused PayPal primitive: "hold now, capture what was delivered" removes refunds from the surplus-food experience entirely. And for agentic commerce, the trust layer (mandates, explanations, ledger) matters as much as the agent.

## What's next
- PayPal Agent Ready (UCP with Orders v2) so Gemini and Google AI Mode can buy tonight's bags directly.
- Real shop onboarding with Log in with PayPal, and PayPal's micropayments pricing for sub-$10 bags (on our $2.99 test capture the standard fee was $0.59).
- Automatic hand-off of unsold food to community fridges.

## Built with
paypal-orders-v2, paypal-payments-v2, paypal-vault-v3, paypal-js-sdk-v6, paypal-webhooks, gemini, mcp, ucp, next.js, typescript, tailwind, postgres, supabase, drizzle, vercel

## Tools used (required field: which AI tools and how)
- **Google Gemini API** (`gemini-3.6-flash` with fallbacks): vision for photo → listing and bag checks, JSON-schema structured output, function calling for the buyer agent, diet matching for standing orders.
- **Model Context Protocol** (official TypeScript SDK): exposes Crumb's buyer tools to any MCP client such as Claude.
- **Claude Code**: used as a coding assistant during development.

## Testing instructions for judges
1. Open https://crumb-lyart.vercel.app → **For shops** → PIN `2468` → *List what's left* → pick a **sample photo** → *Turn this photo into listings* → *Publish*.
2. Open a bag from **Tonight** → enter a name → PayPal → log in with the sandbox customer: `sb-c43r4l53836201@personal.example.com` / `JD{q4y8&` → approve. You get a ticket with a pickup code.
3. **For shops** → *Hand over a bag* → enter the code → *Use a sample photo (2 croissants)* → confirm the partial charge.
4. **AI agents** → Maya → *Save PayPal* (same sandbox customer) → ask the agent to find dinner. Or connect your own MCP client with the snippet on that page.
5. **Ledger** shows every money movement and why.

Sandbox only — no real money moves.
