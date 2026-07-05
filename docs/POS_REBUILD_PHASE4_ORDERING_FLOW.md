# FAVO POS Rebuild — Phase 4: Ordering Flow Design

**Status:** Agreed (2026-07-05) · **Phase 4 of 6** — this is the Phase 5 wireframe brief.

## Screen structure — three fixed zones, always visible

| Zone | Contents |
|---|---|
| **A — Customer** | Search/attach customer · Loyalty balance ("R24.00 (240 pts)") · "Reorder their Favo" (if set) |
| **B — Order builder** | Fixed 5-item grid, same position always · customisation sheet on tap |
| **C — Running order** | Line items, live total · redemption control (if eligible) · Charge button |

Zone C is never a drawer or modal — always on screen (Phase 1's checkout-visibility research). Zone A replaces the old category sidebar's screen space; with no categories left, it becomes the customer/loyalty anchor instead.

## Step by step

**0. Opening-time prompt (once per day).** First barista login of the day with no opening time recorded yet triggers: "What time did you open today?" Submitting fires a push notification to every logged-in web-app user. **Dismissible** — "Remind me later" lets the barista serve a waiting customer immediately; the prompt keeps reappearing until actually submitted that day. Does not gate any subsequent login.

**1. Barista login.** Unchanged (existing PIN login).

**2. Land on the order screen.** All three zones visible immediately. Zone B shows the 5-item grid, nothing selected. Zone C is empty, R0.00. Zone A is an empty customer search.

**3. Attach a customer (optional).** Search and select, or skip for a walk-in/anonymous order. If attached: Zone A shows name, "Loyalty balance: R[x].00 (N pts)," and — if a Favo is set — a "Reorder their Favo" button that adds the full saved order (item + customisations) straight to Zone C, skipping step 4. No customer attached → no loyalty balance, no Favo, no redemption later.

**4. Build the order.** Tap an item in Zone B (Americano, Cappuccino, Mocha, Chai Latte, Hot Chocolate — fixed position). A customisation sheet opens: milk choice (default Normal, free Macadamia alternative) for Cappuccino/Mocha/Chai Latte/Hot Chocolate; an extra-shot stepper (R10 each, no upper limit) for espresso-based drinks. **Americano stays strictly black — no milk-choice customisation.** Confirming adds the line to Zone C, which updates live. Zone C stays visible and editable throughout — no navigating away to fix a mistake.

**5. Apply loyalty.** If a customer is attached with ≥100 points and order total ≥ R20, a redemption control appears directly in Zone C: Subtotal → Loyalty redeemed (–R[x]) → New total. Defaults to max eligible, hard-capped at order total, editable down, recalculates instantly. This is the fix for the original "redemption is invisible" problem — it lives where the barista is already looking.

**6. Payment.** "Charge R[total]" — existing Yoco hosted-fields flow, charging the post-redemption total. No wallet/stored-balance option anywhere. Barista can back out to keep editing the order without losing anything built so far.

**7. Completion.** Payment confirms; order enters the existing queue/production flow unchanged (stock deduction now correctly reads milk/shot customisations per AT-145). **Zone A auto-clears** back to empty after payment — safest default, avoids accidentally attaching the next customer's order to the previous person. Keeping the same customer attached for a follow-up order (groups, repeat orders) is one tap away.

## Decisions locked this phase

1. Opening-time prompt: dismissible/snoozable, not a hard block.
2. Americano: no milk-choice customisation, stays black.
3. Post-payment: customer auto-clears by default.

## Next

Phase 5 — wireframe this flow in Claude design, plus a handover doc tying every decision back to the Phase 1 citations and this flow.
