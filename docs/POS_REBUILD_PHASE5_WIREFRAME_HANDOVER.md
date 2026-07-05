# FAVO POS Rebuild — Phase 5: Wireframe & Handover

**Status:** Draft, awaiting sign-off · **Phase 5 of 6**

Interactive wireframe: see the Phase 5 artifact from the 2026-07-05 session (low-fidelity, greyscale, deliberately unbranded — structure and interaction only, not visual design). This document is what Phase 6 build should read before writing any code.

## What this covers

The full ordering flow agreed in Phase 4 (`docs/POS_REBUILD_PHASE4_ORDERING_FLOW.md`), wireframed as two screens:

1. **POS order screen** — the three-zone layout (Customer, Order builder, Running order), with working mock interactions for: customer search, item selection + customisation popover, the loyalty redemption stepper, and the daily opening-time prompt.
2. **Daily history screen** (new, AT-146) — per-item counts for today and yesterday, reachable from the POS via a menu.

Deliberately NOT covered here: visual design (colors, type, branding — that's a separate pass after this wireframe is approved, informed by the existing FAVO brand but not blocking Phase 6's structural build), the admin dashboard's multi-session hours planner (POS-side only in this wireframe; the admin UI is a separate, smaller screen not wireframed here since it's a straightforward list-editor, not a novel interaction pattern), and the customer PWA's Favo setup screen (also straightforward, not wireframed).

## Design decisions and rationale

Every decision below traces back to a specific Phase 1–4 finding — this section exists so Phase 6 doesn't have to re-derive "why," just implement "what."

| Decision | Rationale | Source |
|---|---|---|
| Three fixed zones, cart never collapses | Baymard's checkout research: page/flow design is "frequently the sole cause" of abandonment; a hidden cart recreates that risk | Phase 1 §A, §C |
| Fixed 5-item grid, no categories, no dynamic reordering | At 5 items, a filter/category system solves a problem that doesn't exist yet, and a popularity-sorted shelf fights the muscle memory a small fixed set gives for free | Phase 1 §E amendment, Nikao's explicit reasoning |
| Zone A replaces the category sidebar's space | Apple HIG: iPad favors a persistent primary pane; with no categories left, repurposing that space as the customer/loyalty anchor keeps the split-view structure without wasting it | Phase 1 §A |
| 44×44pt+ touch targets, spacing audit | WCAG 2.5.8, Apple HIG — direct fix for the "broken/overlapping interactivity" complaint | Phase 1 §B |
| Customisation popover, not a full sheet | Apple HIG explicitly distinguishes sheets (modal, "important tasks," "brief and occasional") from popovers ("small amount of functionality," recommended for iPad); milk/shots are now down to one toggle + one stepper — popover territory | Phase 4 step 4 |
| Normal milk is not a selectable option | Reduces the customisation set to the minimum functionality a popover should hold, and matches the actual mental model (there's one default, one alternative) | Nikao's explicit direction |
| Redemption is a stepper of R20 units, defaults to 0 | Already-built backend behavior (`redeemLoyalty`, AT-109/110); "choose whether to use points at all" is satisfied by defaulting to 0 rather than auto-applying max | Phase 4 step 5, Nikao's clarification |
| "Loyalty balance," never "wallet" | The stored-value wallet was removed entirely; retaining the word anywhere would contradict that decision | `docs/POS_REBUILD_DECISIONS.md` |
| Opening-time prompt every login, dismissible, multi-session aware | Real café behavior (open/close more than once a day) the admin dashboard couldn't represent; barista side stays a single field per login by design | Phase 4 step 0 |
| Auto-clear customer after payment | Baymard/NN·g pattern of resetting to a safe default rather than risking a mis-attached order; one tap to override for groups | Phase 4 step 7 |

## Component & interaction specs

### Zone A — Customer
- Empty state: single search input, placeholder "Search name, email, or phone…"; results appear live, ≥2 characters. Matches `ILIKE` on name/email, and phone (partial match recommended — see AT-137 comment).
- Attached state: name, "Loyalty balance: R[x].00 (N pts)" (currency first, always — see arithmetic note below), a "Reorder their Favo" button (only rendered if the customer has a Favo set), and a "Detach customer" text action.
- No customer attached → no loyalty balance, no Favo button, no redemption control later in Zone C.

### Zone B — Order builder
- Fixed grid, 5 tiles, same position on every load — Americano, Cappuccino, Mocha, Chai Latte, Hot Chocolate. No scrolling, no category tabs, no search.
- Tapping a tile opens a popover anchored to that tile (not a full-screen sheet):
  - Milk-based items (Cappuccino, Mocha, Chai Latte, Hot Chocolate): a single "Macadamia Milk (free)" toggle. Off by default (= normal dairy, free). No control exists for "select normal milk" — there's nothing to tap for the default.
  - Espresso-based items (Americano, Cappuccino, Mocha): an extra-shot stepper, R10/shot, no upper bound, starts at 0.
  - Americano: shot stepper only, no milk toggle.
  - Dismiss on tap-outside or on "Add to order" — either commits the current toggle/stepper state to Zone C.

### Zone C — Running order
- Line items show name + any modifications (e.g. "Macadamia milk, +1 shot") + line price.
- Redemption control appears only when: a customer is attached AND their points ≥ 100 AND subtotal ≥ R20. Renders as "N × R20 units" with a −/+ stepper, `N` capped at `min(floor(points/100), floor(subtotal/2000))`, starting at 0.
- Totals: Subtotal → (Loyalty redeemed, only shown if > 0) → Total. Recalculates instantly on every cart or redemption change — no separate "recalculate" step, ever.
- Charge button is disabled with an empty cart; label always reflects the live total.

### Opening-time prompt
- Modal, appears on every login. Pre-fills the existing value if already set today; "Confirm" doesn't re-send the notification. Changing the value, or the first submission of the day, does. "Remind me later" dismisses without submitting — reappears next login (or can be manually reopened, wireframed as a top-bar button for convenience, though the real trigger is login, not a button tap).
- Does not block any part of the ordering flow underneath it — it's dismissible, never a hard gate.

### Daily history screen
- Reachable via a menu icon from the main POS screen, not a primary always-visible surface.
- Per day: total item count + a per-item breakdown (name + count). Today and at least the prior day; further history is a "nice to have," not required for v1 (AT-146 keeps this simple by design).

## What Phase 6 build needs to know

- **Sequencing:** follow the four waves in `docs/POS_REBUILD_PHASE3_STRATEGY.md`. This wireframe only becomes buildable after Wave 1 (menu trim, AT-136; customisation/deduction fix, AT-145) lands — the fixed grid and popover both assume the final 5-item menu and working macadamia/shot logic already exist.
- **Non-negotiable:** the stored-value wallet must not resurface in any form. See `docs/POS_REBUILD_DECISIONS.md` and the grep-check Definition of Done on AT-141.
- **Arithmetic correction (2026-07-05):** earlier phase docs illustrated the loyalty balance with "R24.00 (240 pts)," which is wrong — the confirmed rate is 100 pts = R20 (R0.20/point), so 240 pts = R48.00. All docs have been corrected to use "R20.00 (100 pts)" as the canonical example. Don't reintroduce the R24 figure anywhere.
- **Favo drift prevention:** if AT-142/143/144 land after this wireframe, remember the binding architecture mandate — one shared server action + schema for both the customer and barista entry points (see AT-142's Jira comment).
- **The Favo, admin hours planner, and customer PWA loyalty-page changes are not wireframed here** — they're simpler, more conventional UI (a form, a list editor) that doesn't need the same structural scrutiny as the core POS screen. Build them against the specs in `docs/POS_REBUILD_DECISIONS.md` and the relevant Jira tickets directly.
- **Live walkthrough QA** (`docs/POS_REBUILD_LIVE_WALKTHROUGH_QA.md`) should be run once this wireframe's build lands, before Wave 4's launch-readiness tickets proceed.

## Next

Once this wireframe and handover are approved, Phase 6 — build and integrate, following the sequencing in Phase 3.
