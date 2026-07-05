# FAVO POS Rebuild — Phase 3: Strategy

**Status:** Signed off (2026-07-05) · **Phase 3 of 6**

How to run the 14 tickets created in Phase 2/3 (epics AT-132, AT-133, AT-134, plus standalone AT-135, AT-145) end to end: sequencing, dependencies, risk, and what to reuse vs. rebuild.

## Sequencing — four waves

### Wave 1 — Clear the deck
Low visual risk, unblocks everything downstream. Can start immediately.
- **AT-136** Menu trim 14→5 — **final list confirmed:** Americano, Cappuccino, Mocha, Chai Latte, Hot Chocolate (the last two are new items, not in current seed)
- **AT-145** Customisation system: macadamia milk, quantity-based extra shots, fix deduction gap
- **AT-141** Remove stored-value wallet
- **AT-115** Verify BUG-Y1 resolved
- **AT-135** Dedupe AT-116/119

The menu trim is now fully resolved — no more decision dependency blocking Wave 2. AT-145 belongs in Wave 1 alongside it: both are backend/data work with no layout dependency, and AT-137's fixed grid needs the final item set (including the 2 new items and their recipes) before it can be built. Wallet removal has no dependents, so it runs in parallel. AT-115 is a silent correctness prerequisite: the new redemption UI's live-recalculation depends on the Yoco charge actually being fixed.

### Wave 2 — The core visual overhaul
Depends on Wave 1's menu trim. Highest-risk, highest-visibility work.
- **AT-137** Split-view + fixed cart layout
- **AT-138** Touch-target audit
- **AT-139** Loyalty balance display

AT-137 and AT-138 should be built together, not sequentially — a layout rebuild that doesn't simultaneously enforce 44×44pt/spacing rules just recreates the overlap problem in a new shape. AT-139 is a self-contained component that plugs into the new fixed cart region.

### Wave 3 — Redemption + Favo
Depends on Wave 2's layout existing to embed into.
- **AT-140** Redemption UI rebuild + QA
- **AT-142** Favo schema/backend
- **AT-143** Favo customer setup
- **AT-144** Favo barista + reorder

AT-140 needs AT-137's fixed cart region first. Favo's backend (AT-142) has no layout dependency and can start as early as Wave 1 if capacity allows; its two clients (AT-143, AT-144) build against that shared contract once it lands, with AT-144 waiting on AT-137 since it's tucked into the new customer-profile surface.

### Wave 4 — Independent track + re-verification
Runs alongside everything else, closes out the rebuild.
- **AT-134** Opening-time + push notification
- **AT-100** Phase 4 QA epic
- **AT-86/87/88** iPad pre-flight, prod smoke, training

AT-134 touches none of the POS layout or loyalty code — buildable at any point in parallel. AT-100 and children explicitly wait until Wave 2 ships — running them against the current UI means redoing the walkthroughs a second time.

## Risk register — status as of 2026-07-05

| Severity | Risk | Status | Mitigation |
|---|---|---|---|
| ~~High~~ | Live POS swap in a daily-use café | **N/A** | POS is not yet in production — confirmed 2026-07-05. No live-swap/downtime risk exists. Drop the staged-rollout requirement; still worth a real-iPad pre-flight (AT-86) before first launch, but not for the reason originally listed. |
| High | Wallet decision needs to survive across sessions/accounts, not just live in this chat | **Mitigated** | Decision is now written into three places that don't depend on chat memory: `docs/POS_REBUILD_DECISIONS.md` (canonical ledger), a pointer at the top of `CLAUDE.md` (loaded by any future session in this repo), and a Definition-of-Done grep check on AT-141 itself (`grep -rIn -i "wallet" ...` must return zero results before that ticket is Done). Residual: still re-run the "no real balances" check immediately before the schema migration, since that fact can go stale even though the decision itself won't. |
| Medium | Redemption "fix" recreates the same invisibility bug AT-130 already found once | **Mitigated** | See `docs/POS_REBUILD_LIVE_WALKTHROUGH_QA.md` — a concrete, step-by-step manual test script to run once AT-140 is built, specifically designed to catch "technically works but nobody notices it" bugs rather than just checking the code path exists. |
| Medium | Favo's two entry points (AT-143, AT-144) drift out of sync | **Mitigated (structurally, not just by sequencing)** | Upgraded from "build backend first" to an architecture mandate: AT-142 must ship a single shared server action + shared schema that BOTH AT-143 and AT-144 call directly. Neither client can drift from the other because there is only one code path to drift from. Posted as a binding comment on AT-142/AT-133. |
| Low | Menu trim (business decision) stalls and blocks Wave 2 | **Resolved** | Final list confirmed 2026-07-05: Americano, Cappuccino, Mocha, Chai Latte, Hot Chocolate. Surfaced a bigger-than-expected scope: 2 of the 5 are new items, and "every order must support customisation" (macadamia milk free alternative, quantity-based extra shots at R10) exposed a pre-existing bug where stock deduction ignores customisation choices entirely. Tracked as new ticket AT-145 (Wave 1). |

## Favo drift prevention

Sequencing alone ("build the backend first") reduces drift risk but doesn't eliminate it — two teams can still build against a shared table with different assumptions about what's optional, what's required, or what a "saved order" even means. The actual fix is structural: **AT-142 ships one server action (e.g. `setFavo()`/`getFavo()`) and one schema, and both AT-143 (customer-side) and AT-144 (POS-side) call that same function against that same schema — neither client implements its own version of the save logic.** This makes drift impossible by construction rather than just unlikely by scheduling. Posted as a binding comment on AT-142 and AT-133.

## Customisation & inventory-tracking integration

The milk/cup-packet "open/close container" tracking (`OpenContainersCard.tsx`, the active-lot system in `db/seed/lots.ts`) is confirmed still relevant and does **not** need to be rebuilt — it's a fully working physical-inventory model. The integration point is narrower than it first looked: stock deduction (`deductForOrder()`) currently ignores what customisation was chosen on an order line entirely, so today, picking Oat Milk vs. dairy has zero effect on what's actually deducted. That's a pre-existing bug, exposed rather than caused by adding macadamia milk. Fixing it (AT-145) is what lets the existing container system correctly track a second milk type — no changes needed to the container mechanism itself, only to what data reaches it.

AT-145 also surfaced that "extra shots, as many as you want" is a genuine feature gap, not a data-seed task: the current customisation model only supports binary toggles, so quantity-based add-ons (with quantity-multiplied pricing and quantity-based deduction) need real schema/UI work, not just a new row in the customisations table.

## Reuse vs. rebuild

| Component | Call | Note |
|---|---|---|
| `redeemLoyalty()` server action | Reuse | Multi-unit, capped, live-recalculating — already matches the target design |
| Pack redemption (AT-111/112) | Reuse | Fully orthogonal |
| Cancel/reversal logic (AT-113) | Reuse | Backend correctness, untouched |
| Admin/reporting (AT-123–128) | Reuse | No POS-layout dependency |
| `computeTotal()` from AT-12 | Reuse | Pure function, survives even though its grid doesn't |
| Operating-hours display (AT-26/63/67/76) | Reuse | Confirmed separate from the opening-time/notification epic |
| Category sidebar + 3-column grid | Rebuild | Replaced by the fixed 5-item split-view grid (AT-137) |
| Redemption stepper UI (AT-110's dialog) | Rebuild | Logic kept, UI re-embedded (AT-140) |
| Stored-value wallet (UI + backend + schema) | **Deleted**, not rebuilt | AT-141 |
| Loyalty balance display | New | Wraps existing points data, no new backend (AT-139) |
| The Favo | New | Schema through UI (AT-142/143/144) |
| Opening-time + push notification | New | No prior art in the codebase (AT-134) |
| Container/lot inventory tracking (`OpenContainersCard.tsx`, `db/seed/lots.ts`) | Reuse | Fully working, no changes needed — see integration note above |
| `deductForOrder()` | Rebuild (fix) | Must start reading `orderItems.modifications`; currently ignores customisation choices entirely (AT-145) |
| Customisation model (binary toggle) | Rebuild (extend) | Needs quantity support for "unlimited extra shots" (AT-145) |

## Phases 4–6 scheduling

- **Phase 4 (ordering flow design):** walk the flow using the now-locked scope — fixed 5-item grid, Favo one-tap reorder once a customer is attached, loyalty balance + redemption in the fixed cart region, and where the opening-time prompt sits (likely a one-time daily gate before the POS becomes usable, separate from order-taking).
- **Phase 5 (wireframe & handover):** turn Phase 4's flow into a wireframe; tie every decision back to the Phase 1 citations and this sequencing.
- **Phase 6 (build & integrate):** execute Waves 1–4 above. Re-run the wallet-balance safety check immediately before Wave 1's migration; hold Wave 4's launch-readiness tickets until Wave 2 has shipped.
