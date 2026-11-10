# Crumb — demo video script (target 2:45, hard limit 3:00)

**Format:** screen recording of https://crumb-lyart.vercel.app with your voice-over. No music, or royalty-free only (no copyrighted music: Devpost rule). Record at 1080p. Use two browser windows side by side where noted: **Shop** (left) and **Customer / AI agent** (right).

**Before recording (5 min prep)**
1. On `/agent`, save PayPal (sandbox customer) for **Maya** and **Sam**. Leave **Dev** unsaved so one agent visibly declines. Set Dev's "I can collect from" to `00:00` if you want Dev to match instead.
2. Make sure no old bags are on sale (Shop → Tonight's board → "We ran out" on leftovers).
3. Shop PIN is 2468. Keep the sandbox customer login ready.
4. Do one dry run so Gemini answers are cached (sample photos are then instant).

---

## 0:00 – 0:20 · The problem (talk over the Tonight page)
> "Every evening, small bakeries and cafés bin good food. Food service alone wastes about 290 million tonnes a year. Apps exist, but listing leftovers at 8 pm takes time owners don't have, and buyers complain about empty bags and refunds they have to chase. Crumb fixes both, with PayPal and AI."

## 0:20 – 0:55 · Snap to list (Shop window)
- For shops → Golden Crust Bakery → **Pastry basket** sample → *Turn this photo into listings*.
> "The owner takes one photo. Gemini counts the croissants, pain au chocolat and loaves, flags allergens — it even warns about possible nut traces — and suggests a rescue bag at about 40 percent of value. The price can never go below the owner's floor; that's enforced in code, not by the AI."
- Change the price or quantity once (shows the human is in control) → **Publish**.

## 0:55 – 1:25 · AI agents buy it in seconds (the wow moment)
- The "On sale" panel shows the agents' decisions.
> "Within a second, customers' own AI assistants react. Maya told her assistant: vegetarian, up to six dollars a bag, twenty-five a week. It reserved one — that's a real PayPal hold on her saved PayPal, placed through PayPal's Vault. Sam's assistant skipped it: 'Not vegan — contains dairy and egg.' Every rule is checked in code; the AI only judges the diet."
- Optional 5 s: Pho & Bao Kitchen → **Dim sum** sample → publish → Dev's agent matches, Sam's declines.

## 1:25 – 1:55 · A person reserves (Customer window)
- Tonight → open the bag → name → PayPal → sandbox login → approve.
> "People can reserve too. PayPal's window says 'Complete Purchase', but it's an authorization: the money is held, not taken. Here's the ticket: held, not charged, with a pickup code."

## 1:55 – 2:30 · Snap to pay (Shop window)
- Hand over a bag → enter the code → **Use a sample photo (2 croissants)**.
> "At the counter, staff photograph the open bag. One croissant is missing. Gemini spots it, and Crumb proposes charging only for what's there. A person confirms."
- Click **Charge $X and release $Y**. Show the receipt: Held / Charged / Released.
> "That's a partial capture on PayPal's Payments API with final capture: the rest of the hold is released automatically. If the shop runs out, one tap voids every hold — the customer was never charged, so there's nothing to refund."

## 2:30 – 2:50 · Proof and close (Ledger page)
- Open **Ledger**: events from Shop, AI, Agent and PayPal webhooks ("signature verified").
> "Every hold, charge, release, and every refusal by an agent is in a public ledger, confirmed by PayPal webhooks. Crumb is also an MCP server with a UCP profile, so any AI assistant can buy tonight's leftovers safely. Snap to list, snap to pay — you only pay for food that's actually in your hand."

---

### Shot checklist
- [ ] Problem stat on screen (UNEP Food Waste Index 2024)
- [ ] AI listing with allergens and price floor
- [ ] Agent reserves (hold) + agent declines with a reason
- [ ] Human PayPal approval → ticket "Held, not charged"
- [ ] Bag check → partial capture receipt
- [ ] "We ran out" → holds voided (optional, 5 s)
- [ ] Ledger with PayPal webhook lines
- [ ] Ends before 3:00
