# FAVO POS Rebuild — Locked Decisions

**This is the single source of truth for decisions made during the POS rebuild (2026-07-05 onward).** If you're picking up this work in a new session, on a different account, or after a context reset — read this file first. It exists specifically so these decisions survive outside of any one chat session. Full rationale for each is in the phase docs (`POS_REBUILD_PHASE1_RESEARCH.md`, `PHASE2_JIRA_AUDIT.md`, `PHASE3_STRATEGY.md`) and in Jira epic [AT-132](https://hofmi.atlassian.net/browse/AT-132), [AT-133](https://hofmi.atlassian.net/browse/AT-133), [AT-134](https://hofmi.atlassian.net/browse/AT-134).

## 🚫 The stored-value wallet is REMOVED. Do not rebuild it in any form.

Confirmed by Nikao, 2026-07-05, emphatically ("I DO NOT WANT IT ANYWHERE"). This means:

- No top-up flow, anywhere (POS, customer PWA, admin).
- No "spend from balance" payment method.
- No wallet balance shown anywhere, in any label.
- The word **"wallet" does not appear** in any new UI copy, ticket, or code comment for this feature area. The only money-value display is the **loyalty points balance**, shown as currency-first: `"Loyalty balance: R24.00 (240 pts)"`.
- Confirmed 2026-07-05: no real customer had a wallet balance at that time, so removal is a clean deletion — **but re-run that check immediately before deleting `wallet_zar`/the wallet ledger table**, since time may have passed.

**If you see a PR, ticket, or design that reintroduces a top-up or stored-balance concept, it contradicts this decision — flag it, don't build it.**

**Enforcement check** (run before AT-141 is marked Done):
```bash
grep -rIn -i "wallet" --include="*.ts" --include="*.tsx" src/ db/ | grep -v -iE "test|migration|POS_REBUILD"
```
This should return **zero results** outside of git history / migration files by the time AT-141 ships. If it returns anything, that code wasn't cleaned up.

**Tracking:** Jira [AT-141](https://hofmi.atlassian.net/browse/AT-141) "Remove the stored-value wallet, end to end," part of epic AT-132.

## The 5-item menu (final, 2026-07-05)

- Americano
- Cappuccino
- Mocha
- Chai Latte *(new item — does not exist in current seed data, needs adding)*
- Hot Chocolate *(new item — does not exist in current seed data, needs adding)*

Everything else in the current 14-item seed (Espresso, Flat White, Latte, Cortado, Cold Brew, Iced Latte, Rooibos Tea, English Breakfast Tea, Butter Croissant, Blueberry Muffin, Cheese & Tomato Toastie) is dropped from the live menu. Tracking: Jira [AT-136](https://hofmi.atlassian.net/browse/AT-136).

## Every order must support customisation

- **Milk choice:** default is normal (dairy) milk; **macadamia milk is a free alternative** (R0, not a paid upcharge like Oat/Almond).
- **Extra shots:** customer can add as many extra espresso shots as they want, at **R10 each** (existing seed data has this priced at R12 — that's now wrong, update to R10).

**Investigated 2026-07-05 — here's what's actually there vs. missing:**
- The customisation system (`menuCustomisations` table + OrderBuilder toggle UI) already works and already supports Oat Milk, Almond Milk, Extra Shot, Decaf on the 7 espresso-based drinks.
- Macadamia milk already exists as an inventory item (`inv_item_macadamia_milk`) but has no customisation row or recipe linkage yet — needs adding.
- **Extra Shot is currently a binary toggle (include/exclude), not a quantity.** "As many shots as you want" requires a real feature addition: a quantity stepper in the UI, price = R10 × quantity, and schema/logic that can multiply a customisation instead of just toggling it.
- **Critical pre-existing bug, exposed by this work:** stock deduction (`deductForOrder()`) completely ignores what customisation was actually chosen on an order — it only ever deducts the base recipe's ingredients, regardless of whether Oat/Almond/Macadamia milk was picked. This has apparently been silently wrong since it was built. Must be fixed as part of this work, not treated as separate cleanup — the whole point of adding macadamia milk is for the right stock to decrement.
- Recipe variants are needed for the 2 new items (Chai Latte, Hot Chocolate — neither exists in the seed at all yet) and for macadamia-milk versions of the milk-based items in the final 5 (Cappuccino, Mocha, Chai Latte, Hot Chocolate). Americano is assumed black/no milk-choice — flag if that's wrong.

Tracking: Jira [AT-145](https://hofmi.atlassian.net/browse/AT-145) "Customisation system: macadamia milk + quantity-based extra shots + fix deduction gap," part of epic AT-132.

## Milk & cup-packet inventory tracking — confirmed relevant, integrates via AT-145

Confirmed this maps to `OpenContainersCard.tsx` and the active-lot inventory system (`db/seed/lots.ts`) — it tracks physical container state (which milk carton/bean bag is open, how many sealed ones remain), and it's fully operational as-is. It doesn't need to be rebuilt or replaced. The only integration work required is AT-145's deduction fix: once deduction actually reads `orderItems.modifications`, the existing container system will correctly open/close macadamia-milk cartons the same way it already does for dairy — no changes needed to the container-tracking mechanism itself.

## The Favo — architecture to prevent the two entry points drifting

Customer-side setup (loyalty page) and barista-side setup (POS) must **call the same server action and validate against the same schema** — not two independently-built implementations that happen to write to the same table. See `PHASE3_STRATEGY.md` "Favo drift prevention" for the specifics. Tracking: Jira [AT-133](https://hofmi.atlassian.net/browse/AT-133), backend contract in [AT-142](https://hofmi.atlassian.net/browse/AT-142).
