# FAVO POS Rebuild — Phase 2: Jira Audit

**Status:** Awaiting final sign-off before Phase 3 (2026-07-05) · **Phase 2 of 6**

Read-only audit — nothing in Jira (project **AT**, "AI Team", cloudId `c5930bf9-65e6-4e72-b211-233db8f3f085`, hofmi.atlassian.net) has been edited yet. This document is the proposal; once approved, the actual Jira transitions/edits/new-ticket creation happen before Phase 3.

## Key findings

**Redemption isn't missing.** The code has a working "Redeem loyalty points" button on the payment screen (`LoyaltyRedeemDialog.tsx`, imported/rendered in `POSWorkspace.tsx`), backed by a complete `redeemLoyalty()` server action — multi-unit, capped at order total, live recalculation. This already matches most of the Phase 1 redemption recommendation. It's gated behind conditions (customer selected, ≥100 pts, order total ≥ R20, payment-screen only), and a very recent ticket (AT-130) already found/fixed real visibility bugs in it. Most likely explanation for it reading as "missing": buried in the cluttered, overlap-prone current layout — the same interactivity problem Phase 1 targeted. **The fix is "rebuild it prominently in the new layout + QA by live walkthrough," not "build from scratch."**

**Stored-value wallet removed entirely (decision, 2026-07-05).** Two separate systems both got called "wallet": loyalty points (earn/redeem, unaffected) and a genuinely separate prepaid stored-value account (top-up via card charge, then spend on future purchases). Confirmed: delete the stored-value system completely — no top-up, no spend-from-balance, no wallet balance shown anywhere (POS, customer PWA, admin). No real customer has a balance in it today, so this is a clean deletion, not a refund/migration. The word "wallet" is retired everywhere; the only money-value display going forward is the loyalty points balance, labeled **"Loyalty balance."**

**Menu: 14 items/4 categories today, confirmed trimming to 5.** Locks in dropping the category sidebar and the dynamic favorites shelf from Phase 1 — but the trim itself (deciding which 5 items, updating seed/menu data) is real, separate work with its own ticket; which 5 is a business decision, not part of this audit.

## Ticket classification

### Loyalty engine — AT-107 epic and children

| Key | Summary | Status | Call | Why |
|---|---|---|---|---|
| AT-107 | Epic: Loyalty System Update | Review | Keep | Umbrella epic for the redemption-cap rewrite; correct as scoped, independent of the POS UI rebuild. |
| AT-109 | LOY-1: Multi-unit redemption backend | Done | Keep | Server-side clamp logic is exactly the foundation the new redemption UI needs. |
| AT-110 | LOY-2: POS redemption stepper | Done | Change | Logic is right; UI was built as a dialog-based stepper for the old layout. Re-scope as a single-tap-to-max control embedded in the new fixed cart region. |
| AT-111/112 | LOY-10a/b: Pack redemption (backend + POS) | Done | Keep | Orthogonal to the wallet/redemption UX change. |
| AT-113 | LOY-3: Restore points + packs on cancel | Done | Keep | Backend correctness, unaffected. |
| AT-114 | W1+W2: Wallet spend + ledger | Done | **Remove** | Spend-from-balance only exists because the stored-value wallet existed. No real balances to migrate — deleted alongside the wallet. |
| AT-115 | BUG-Y1: Yoco charge after redemption | Review (not Done) | Change | Verify/close before the new redemption UI ships — its live-recalculation depends on this being correct. |
| AT-116/119 | BUG-Y2/Y3: Webhook races | Done | Keep | AT-119 looks like a duplicate of AT-116 — dedupe as housekeeping. |
| AT-121 | BUG-O2: Offline payment sync / stuck-charge resolve | Done | Keep | Already wired into admin per PR #209. |
| AT-122 | CASH-REMOVE: Remove cash tender | Done | Keep | No conflict with new direction. |
| AT-123–128 | LOY-4/5/6/9/7/8: admin adjustment, reconciliation, earn rules, spec cleanup, liability report, points history | Done | Keep | Backend/admin/reporting work, unaffected by the POS UI direction. |
| AT-130 | POS discount visibility + LoyaltyCard fix | Done | Keep | Already fixing exactly this kind of wiring/visibility bug; sanity-check its copy against the new "Loyalty balance" format. |

### POS layout & wallet — pre-dates this rebuild

| Key | Summary | Status | Call | Why |
|---|---|---|---|---|
| AT-12 | [M3] Order builder — category-grouped grid | Done | Superseded | Built for a multi-category, arbitrary-size catalog. With the trim to 5 items, this layout spec is obsolete; `computeTotal()` logic is reusable, the grid/category structure isn't. |
| AT-72 | [M16] POS wallet top-up flow | Done | **Remove** | Delete outright — `WalletTopUpDialog.tsx`, the "Top up" button, and `topUpWallet()` all go. No real balances exist, so no refund/migration needed first. |
| AT-73 | [M17] POS coffee pack purchase flow | Done | Keep | Unaffected. |
| AT-74 | [M18] POS loyalty redemption flow (original) | Done | Superseded | All-or-nothing, zero-the-order design — the exact exploit AT-107 was created to fix. Replaced by AT-109/AT-110. |
| AT-59/60 | [G18/G19] Original wallet + loyalty server actions | Done | Superseded | Replaced by the LOY-1/3/6 and W1+W2 rewrites (and now by the wallet removal). |
| AT-69 | [N17] Customer PWA wallet+packs view (read-only) | Done | Change | Drop the wallet section entirely; keep packs; rename away from "wallet" to "Loyalty balance." |
| AT-78/79/80 | Admin customer/wallet/loyalty + sync-conflict views | Done | Change | AT-79 shows a wallet column/section — drop it. AT-78/80 unaffected. |

### Launch readiness & unrelated feature

| Key | Summary | Status | Call | Why |
|---|---|---|---|---|
| AT-100 | Epic: Phase 4 — QA + Deploy | To Do | Change | Still open, real work — written against the old UI. Re-point after the rebuild ships rather than executing now. |
| AT-86/87/88 | iPad pre-flight, prod smoke, barista training pack | To Do | Change | Never executed; acceptance criteria will need rewriting once the new layout ships. |
| AT-26/63/67/76 | Operating-hours display feature (static weekly schedule, "open now" badge) | Done | Keep | Confirmed NOT the same as the new "barista sets today's opening time → push notification" feature. Separate, already-shipped, display-only — leave alone. |

**Totals:** 37 tickets reviewed — 21 keep, 10 change/rescope, 4 superseded, 2 removed outright.

## Missing tickets (need to be created)

1. **Menu trim: 14 items → 5 signature items.** Content/data ticket; everything downstream depends on this landing first.
2. **Epic: POS UX/layout rebuild.** iPad split-view structure (persistent nav + content pane + fixed, non-collapsible order/cart region), replacing the category-sidebar + 3-column grid. Absorbs the layout portion of AT-12 and the UI portion of AT-110.
3. **Touch-target & interactivity audit.** 44×44pt floor with 8–12pt spacing across every POS control; automated overlapping-hit-area check.
4. **Loyalty balance display (money-first, no "wallet" wording).** "Loyalty balance: R20.00 (100 pts)" on POS, customer PWA, and admin — the only money-value surface once the wallet is gone.
5. **Redemption UI rebuild + discoverability QA.** Single-tap-to-max redemption in the new fixed cart region, live total recalculation, plus a fresh live-walkthrough QA pass (don't assume the existing dialog just needs a re-skin). Re-verify AT-115 as a dependency.
6. **"The Favo" — saved usual order.** Customer-side set-up on the loyalty page, barista-side set/edit in POS (secondary, tucked away), one-tap reorder at checkout, plus a schema ticket for the saved-order template.
7. **Opening-time prompt + push notification.** Barista sets the café's opening time each morning; submitting triggers a push notification to every logged-in web-app user. Confirmed distinct from AT-26/63/67/76.
8. **Dedupe AT-116/AT-119.** Both "BUG-Y2/Y3," both Done — housekeeping.
9. **Remove the stored-value wallet, end to end.** Delete `WalletTopUpDialog.tsx`, the POS "Top up" button, `topUpWallet()`, `walletSpend()`, the wallet ledger (AT-114), the webhook wallet-credit path, and the wallet sections in AT-69/AT-79. Drop `wallet_zar` and the wallet ledger table via migration — confirmed no real balances exist.

## Next step

Once approved, execute the Jira transitions/edits/creations above, then proceed to Phase 3 (strategy: sequencing, dependencies, risk, reuse vs. rebuild).
