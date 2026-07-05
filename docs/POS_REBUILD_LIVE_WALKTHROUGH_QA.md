# FAVO POS Rebuild — Live Walkthrough QA

**Purpose:** manual, on-device sign-off script to run once the POS UX Rebuild (AT-132) has been built, before it's considered done. This exists because several of the risks in this rebuild are "technically works but nobody notices it" bugs (see AT-130's history) — a passing test suite doesn't catch those. Run this on the actual iPad the café will use, not just a browser window.

**Do this walkthrough after Wave 2 + Wave 3 have shipped** (see `POS_REBUILD_PHASE3_STRATEGY.md`), before Wave 4's launch-readiness tickets (AT-100/86/87/88) are executed.

---

## 1. Menu & customisation

**Setup:** fresh POS session, logged in as a barista.

1. Open the item grid. Confirm exactly 5 items are shown, in a fixed position: Americano, Cappuccino, Mocha, Chai Latte, Hot Chocolate. **Fail if:** any old item (Espresso, Flat White, Latte, Cortado, Cold Brew, Iced Latte, Rooibos Tea, English Breakfast Tea, Butter Croissant, Blueberry Muffin, Cheese & Tomato Toastie) still appears anywhere, or if there's any category tab / filter sidebar / search box visible.
2. Reload the POS. Confirm the 5 items are in the exact same position as before reload. **Fail if:** anything has moved — this is the whole point of dropping the dynamic shelf.
3. Tap Cappuccino. Confirm a customisation option lets you choose Macadamia Milk as a free alternative to the default dairy milk (R0 price difference either way). **Fail if:** it's priced, or if it's missing entirely.
4. On the same order line, add 3 extra shots. Confirm the price increases by 3 × R10 = R30, not a flat R10 regardless of quantity. **Fail if:** it's still a toggle (max 1 shot) or priced at R12/shot.
5. Repeat steps 3–4 for Mocha, Chai Latte, and Hot Chocolate.
6. Add an Americano with no customisation. Confirm it doesn't force a milk choice (unless you've since decided Americano should offer one — check `POS_REBUILD_DECISIONS.md` for the current assumption).

## 2. Inventory deduction (the part that's easy to get silently wrong)

**Setup:** note the current open-container state in `OpenContainersCard` for dairy milk and macadamia milk before starting (e.g. "dairy: carton open, 7 cups left; macadamia: sealed, 0 open").

1. Place and complete an order for one Cappuccino with **dairy milk** (default, no customisation). Transition it to `in_progress`.
2. Check `OpenContainersCard` again: dairy milk should have decremented by 1 cup. Macadamia should be unchanged. **Fail if:** macadamia decremented instead, or nothing decremented at all (this was the exact pre-existing bug found in Phase 3 — confirm it's actually fixed).
3. Place and complete a second Cappuccino, this time with **Macadamia Milk** selected. Transition it to `in_progress`.
4. Check `OpenContainersCard` again: macadamia milk should now show an open container (or a sealed one just opened) with 1 cup consumed. Dairy should be unchanged from step 2. **Fail if:** dairy decremented instead, or macadamia never opens.
5. Place an order with 2 extra shots on an Americano. After transitioning to `in_progress`, confirm the espresso-shot/bean stock decremented by an amount consistent with 1 base shot + 2 extra (3 total), not just the base recipe amount. **Fail if:** extra shots have no effect on bean stock.

## 3. Loyalty balance & redemption

**Setup:** a test customer with ≥200 loyalty points, attached to a new order totalling at least R40.

1. Attach the customer to the order. Confirm their balance is shown as **"Loyalty balance: R[X].00 (N pts)"** — currency first, points in parentheses. **Fail if:** the word "wallet" appears anywhere, or if only a raw point count is shown with no currency value.
2. Without scrolling, hunting, or opening a secondary menu, confirm you can see a way to redeem points from the main order screen — this is the discoverability check the whole rebuild exists to fix. **Fail if:** you have to go looking for it, or it only appears on a separate payment screen after several taps.
3. Tap to redeem. Confirm it defaults to the maximum redeemable amount, capped at the order total (not capable of exceeding it). **Fail if:** it allows redeeming more value than the order total, or defaults to redeeming nothing.
4. Confirm the order total recalculates **immediately** on screen the moment redemption is applied — before you tap anything else. **Fail if:** the total only updates after moving to a different screen.
5. Complete payment for the remainder. Confirm the actual amount charged (check the Yoco charge / receipt) matches the recalculated total exactly, not the pre-redemption total. This is the AT-115 dependency — if this is wrong, the customer is being overcharged.

## 4. Wallet absence (confirm the removal actually shipped)

1. Search the entire POS UI, the customer PWA, and the admin customer view for the word "wallet," "top up," or "top-up." **Fail if:** it appears anywhere, in any label, button, or empty state.
2. Attempt to find any way to add money to a customer's account outside of paying for an order. **Fail if:** any such flow still exists.
3. Run the grep check from `docs/POS_REBUILD_DECISIONS.md`:
   ```
   grep -rIn -i "wallet" --include="*.ts" --include="*.tsx" src/ db/ | grep -v -iE "test|migration|POS_REBUILD"
   ```
   **Fail if:** this returns anything.

## 5. The Favo

**Setup:** a test customer with no Favo set yet.

1. From the customer's loyalty page (not the POS), set their Favo to a specific item + customisation (e.g. "Mocha, macadamia milk, 1 extra shot").
2. On the POS, attach that customer to a new order. Confirm "Reorder their Favo" appears as a one-tap action inside the normal order-building step — not a separate screen, not requiring extra navigation.
3. Tap it. Confirm the order line added exactly matches what was set on the loyalty page (same item, same milk choice, same shot count).
4. Now, from the POS (as a barista), edit that same customer's Favo to something different.
5. Go back to the customer's loyalty page and confirm it shows the barista's update, not the original one — this proves both entry points are reading/writing the same underlying record rather than two disconnected copies.

## 6. Touch targets (spot check — AT-138 covers the full audit)

1. With the POS on the actual iPad, rapid-tap through a full order (5 items, several customisations, redemption, payment) at normal café speed. **Fail if:** any tap registers the wrong control, or two controls' tap zones visibly overlap.
2. Specifically stress-test the extra-shot quantity stepper and the redemption control — these are new/rebuilt in this cycle and haven't been through real-world tapping yet.

---

## Sign-off

Record the outcome of each section (Pass / Fail + notes) before Wave 4's launch-readiness tickets proceed. Any Fail here should block those tickets, not run in parallel with them — they assume a working rebuild, not one still being debugged.
