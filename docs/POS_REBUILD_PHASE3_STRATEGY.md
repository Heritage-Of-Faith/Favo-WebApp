# FAVO POS Rebuild — Phase 3: Strategy

**Status:** Awaiting sign-off before Phase 4 (2026-07-05) · **Phase 3 of 6**

How to run the 13 tickets created in Phase 2 (epics AT-132, AT-133, AT-134, plus standalone AT-135) end to end: sequencing, dependencies, risk, and what to reuse vs. rebuild.

## Sequencing — four waves

### Wave 1 — Clear the deck
Low visual risk, unblocks everything downstream. Can start immediately.
- **AT-136** Menu trim 14→5
- **AT-141** Remove stored-value wallet
- **AT-115** Verify BUG-Y1 resolved
- **AT-135** Dedupe AT-116/119

The menu trim is a business decision, not engineering — resolve it first so it doesn't bottleneck AT-137 (the fixed grid can't be built until the 5 items are chosen). Wallet removal has no dependents, so it runs in parallel. AT-115 is a silent correctness prerequisite: the new redemption UI's live-recalculation depends on the Yoco charge actually being fixed.

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

## Risk register

| Severity | Risk | Mitigation |
|---|---|---|
| High | Live POS swap in a daily-use café — this is the interface a barista touches every order, no tolerance for downtime | Stage behind a flag/parallel route, rehearse on real iPad hardware before cutover (AT-86, re-timed to Wave 4), pick an off-peak cutover window with a fast rollback path |
| High | Wallet deletion assumption ("no real balances") goes stale if Wave 1 is delayed | Re-run the balance check immediately before running AT-141's schema migration, not just once at planning time |
| Medium | Redemption "fix" recreates the same invisibility bug AT-130 already found once | Hold the line on AT-140's live-walkthrough QA pass — don't let it get cut for time |
| Medium | Favo's two entry points (AT-143, AT-144) drift out of sync if built in parallel against an unfinished contract | AT-142 ships and is reviewed before either client starts |
| Low | Menu trim (business decision) stalls and blocks Wave 2 | Resolve in the first few days — zero engineering dependency, only a decision dependency |

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

## Phases 4–6 scheduling

- **Phase 4 (ordering flow design):** walk the flow using the now-locked scope — fixed 5-item grid, Favo one-tap reorder once a customer is attached, loyalty balance + redemption in the fixed cart region, and where the opening-time prompt sits (likely a one-time daily gate before the POS becomes usable, separate from order-taking).
- **Phase 5 (wireframe & handover):** turn Phase 4's flow into a wireframe; tie every decision back to the Phase 1 citations and this sequencing.
- **Phase 6 (build & integrate):** execute Waves 1–4 above. Re-run the wallet-balance safety check immediately before Wave 1's migration; hold Wave 4's launch-readiness tickets until Wave 2 has shipped.
