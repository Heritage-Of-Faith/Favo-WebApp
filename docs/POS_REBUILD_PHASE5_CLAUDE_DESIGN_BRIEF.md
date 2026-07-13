# FAVO POS Rebuild — Phase 5 Wireframe Build Brief (for Claude design)

**Purpose of this file:** a complete, standalone spec for building the Phase 5 wireframe properly. The earlier HTML wireframe built in this session (the Artifact-tool version) is incomplete — it only covered 2 of the screens this project actually needs, and had functional gaps. Treat this document as the authoritative brief; it does not assume you've seen that earlier version or this chat.

**How to use this doc:** build every screen in the checklist below. Each has an exact spec — layout, states, copy, data, and interaction behavior. Where a number or price appears, use it exactly; nothing here is a placeholder. At the end is an acceptance checklist — every box should be checkable against what gets built.

---

## 0. What FAVO is, in one paragraph

FAVO is a café's POS + loyalty system, used on an iPad by baristas taking orders at the counter. This is a full rebuild of the ordering screen and related flows, replacing a cluttered, category-filtered layout with a fixed, minimal design built for a 5-item menu. It also removes a "wallet" feature entirely (see §6) and adds a new saved-order feature called "the Favo."

## 1. Screen inventory — build ALL of these

| # | Screen | Status in earlier wireframe |
|---|---|---|
| 1 | POS order screen (3 zones + top bar) | Built, but incomplete states |
| 2 | Opening-time prompt (barista, on POS) | Built, single state only |
| 3 | Admin "today's sessions" hours planner | **Not built at all — new, needs full spec below** |
| 4 | Daily order-history screen (barista, on POS) | Built |
| 5 | Favo setup — customer-facing (loyalty page) | **Not built at all** |
| 6 | Favo setup — barista-facing (on POS, inside customer profile) | **Not built at all** |
| 7 | Payment / charge confirmation state | Not built |

Build all seven. Screens 1, 2, 4 existed before but should be rebuilt clean against this spec rather than patched — treat this as the source of truth, not the old file.

---

## 2. Screen 1 — POS order screen

### 2.1 Overall structure
A single iPad-landscape screen (assume ~1194×834pt, iPad landscape), with a persistent top bar and three content zones below it.

**Top bar** (full width, ~48pt tall):
- Left: "FAVO · POS" wordmark
- Right, in this order: active-bean-lot tile (read-only: "☕ Ethiopia Yirgacheffe · Day 3"), one pill per tracked container — one for milk, one for beans — each showing which lot/carton is open (or "None open") + sealed count + an Open or Close button (Open is disabled when sealed count = 0), the barista's name, a "History" button (opens Screen 4), a small settings/menu affordance (opens Screen 3, admin-only — see note in §5).
- These top-bar elements are carried over unchanged from the current live product — do not redesign their internal behavior, only their visual treatment.

**Three zones, left to right:**
- **Zone A — Customer** (~22% width)
- **Zone B — Order builder** (~46% width)
- **Zone C — Running order** (~32% width)

Zone C must never collapse into a drawer, tab, or modal — it is always visible, at all times, in every state of this screen.

### 2.2 Zone A — Customer (build all 3 states)

**State A1 — empty (no customer attached):**
- A single search input, placeholder text "Search name, email, or phone…"
- No results shown until 2+ characters typed

**State A2 — search results showing:**
- Below the input, a list of matching customers (mock 3–5 results), each showing name + points, e.g. "Louis Botha · 240 pts"
- Tapping a result moves to state A3

**State A3 — customer attached, no Favo set:**
- Customer name, bold
- "Loyalty balance: R20.00 (100 pts)" — **exact format: currency first, points in parentheses, word "Loyalty balance" not "wallet" or "points balance."** Use "R20.00 (100 pts)" as your example figure if you need one on screen — do not use "R24.00 (240 pts)," which is a documented arithmetic error from earlier in this project (100 pts = R20 is the real rate, so 240 pts = R48).
- A text-style "Detach customer" action
- No Favo button (this customer has none set)

**State A4 — customer attached, WITH a Favo set:**
- Same as A3, plus a prominent button: "↻ Reorder their Favo"
- Tapping it should visibly add that customer's saved order to Zone C (see §2.4)

### 2.3 Zone B — Order builder (build the grid AND all 5 popover variants)

**Base grid:** exactly 5 tiles, fixed position, never reordered, never filtered, no categories, no search box in this zone. Each tile shows item name + price:

| Item | Price |
|---|---|
| Americano | R30.00 |
| Cappuccino | R38.00 |
| Mocha | R45.00 |
| Chai Latte | R42.00 |
| Hot Chocolate | R40.00 |

**Popover on tap** — anchored near the tapped tile (not a full-screen sheet/modal covering the whole zone). Build one popover variant per item, since they differ:

- **Americano popover:** ONLY an extra-shot stepper. No milk toggle of any kind. Stepper: "Extra shots (R10 ea)" with − / count / + controls, starts at 0, no upper limit.
- **Cappuccino popover:** a "Macadamia Milk (free)" toggle (off by default — this represents normal dairy milk, and there is no separate control to explicitly select normal milk, it's simply the absence of the toggle) PLUS the extra-shot stepper.
- **Mocha popover:** same as Cappuccino — macadamia toggle + shot stepper.
- **Chai Latte popover:** ONLY the macadamia toggle. No shot stepper (chai has no espresso).
- **Hot Chocolate popover:** ONLY the macadamia toggle. No shot stepper.

Every popover ends with an "Add to order" action. Tapping outside the popover should also commit whatever state it's in (this is a lightweight popover, not a form requiring explicit save — see §6 for why).

### 2.4 Zone C — Running order (build all 4 states)

**State C1 — empty:** "No items yet," Subtotal R0.00, Total R0.00, Charge button disabled/greyed.

**State C2 — items added, no customer attached:** a list of line items (name + any modifiers shown as a sub-line, e.g. "Macadamia milk, +1 shot") + line price each, running Subtotal, Total = Subtotal, Charge button enabled and labeled "Charge R[total]."

**State C3 — items added, customer attached, but redemption not eligible** (e.g. customer has <100 points, or subtotal < R20): same as C2, no redemption control shown at all.

**State C4 — items added, customer attached, redemption eligible:** everything in C2, plus a redemption block: "Redeem loyalty points," showing "N × R20 units" with a − / + stepper. N starts at 0 (nothing redeemed by default) and is capped at `min(floor(customer's points / 100), floor(subtotal in cents / 2000))`. As N increases above 0, add a "Loyalty redeemed: –R[N×20].00" line between Subtotal and Total, and Total recalculates live with every tap of + or −.

### 2.5 Opening-time button
The "Set opening time" affordance in the top bar opens Screen 2 (modal). It should be reachable at any point without disrupting whatever else is happening in Zones A/B/C (i.e., it should not clear the cart or detach the customer).

---

## 3. Screen 2 — Opening-time prompt (modal, over Screen 1)

**Purpose:** every barista login triggers this. Build both states:

**State B1 — first time today (nothing set yet):**
- Modal title: "What time are you opening today?"
- Body text: "Submitting notifies every logged-in customer."
- A time input, empty or defaulted to the current time
- Two actions: "Remind me later" (dismisses, no submission) and "Confirm" (submits, sends notification since this is the first submission today)

**State B2 — already set today, re-confirming:**
- Same modal, but the time input is pre-filled with the already-set value
- Body text should make clear this won't re-notify: e.g. "Already set for today — confirming won't notify customers again. Change the time if you're re-opening after a closure."
- "Confirm" here does NOT trigger a new notification (same value = no notification). If the barista *changes* the time before confirming, that DOES notify (this is a "new session," see Screen 3) — visually, consider showing a small inline note like "Changing this will notify customers" that appears only once the input value differs from what was pre-filled.

This modal never fully blocks the screen behind it from being dismissed — "Remind me later" must always be available.

---

## 4. Screen 3 — Admin: "Today's sessions" hours planner (NEW — build from scratch)

This does not exist yet in any form and was not built in the earlier wireframe pass. It lives in the **admin dashboard**, not the POS, though it's reachable/referenced from the POS's opening-time flow conceptually.

**Context:** the café sometimes closes and reopens more than once in a day (e.g. a midday break). The existing admin hours screen only supports one set of hours per day (a recurring weekly default). This screen adds a same-day override.

**Build this as a simple list-editor:**
- Page/section title: "Today's Hours" (or similar — this sits within the existing admin operating-hours area, don't invent a whole new nav item if the admin app already has an hours section)
- A list of "sessions" for the current date, each row showing: a label ("First opening," "Second opening," ...), a start time, and an optional end time
- Each session row sourced from one of two places: (a) auto-added when a barista submits the opening-time prompt on the POS (Screen 2) — these rows should visually indicate they came from the POS, e.g. a small "via POS" tag; (b) manually added by admin in advance, e.g. pre-planning a holiday's split hours
- An "Add session" button that lets admin add a new row manually (start time + optional end time)
- Each row should be editable/deletable by admin
- **Customer notification — admin chooses per edit (decision, Nikao 2026-07-13):** unlike the barista opening-time prompt (which auto-pushes on first submit / genuine change), an admin add/edit/delete here does **not** push automatically. Each add/edit action shows a **"Notify customers" toggle** (default OFF) so the admin decides, per change, whether that session change sends a push. Rationale: admin edits are often quiet corrections (fixing a typo'd time, pre-planning a future holiday) that shouldn't spam customers — but a genuine same-day reopening the admin enters should still be announceable on demand. When the toggle is ON, the push reuses the same `sendHoursPostedPush` payload as the barista flow (`src/server/actions/hours.ts`).
- Below the session list, a smaller, secondary note referencing the recurring weekly default schedule (existing feature, unchanged) — something like "Falls back to your usual Tuesday hours (7:00–17:00) if no sessions are set for today."

**Build 2 states:** (1) a normal day with just one auto-added session from the POS, (2) a split day with two sessions (one from POS, one added manually by admin in advance) to demonstrate the multi-session case clearly.

---

## 5. Screen 4 — Daily order-history (barista, on POS)

Reachable via the "History" button in Screen 1's top bar. Build as its own full screen (not a popover/modal) with a "← Back to POS" way to return.

- For each day (build 2: "Today" and "Yesterday" with a date), show a total count ("20 items made") and a per-item breakdown as a simple horizontal bar or list — item name + count, for all 5 menu items, including items with 0 count that day (don't hide zeros, showing the full 5-item list every time keeps it scannable).
- This is intentionally simple — no charts, no revenue figures, no filtering. Just counts.

---

## 6. Screens 5 & 6 — The Favo (two setup surfaces, one underlying record)

**Important shared rule:** both of these screens must represent the SAME saved-order data — one item + its customisation (milk choice, shot count). Do not design them as if they could hold different or additional data from each other; the whole point is that a customer's Favo is one single record, editable from two places.

### Screen 5 — Favo setup, customer-facing (on the customer's loyalty page, in the customer PWA)
- Section heading: "Your Favo" (plays on the app name)
- If none set: a simple prompt, "Set your usual order," with a way to pick one of the 5 menu items and its applicable customisation (reuse the same popover-style controls as Screen 1 §2.3 — same milk toggle / shot stepper logic per item), then "Save."
- If already set: show the current Favo plainly (e.g. "Mocha, macadamia milk, +1 shot") with an "Edit" action that reopens the same picker.
- Build both states.

### Screen 6 — Favo setup, barista-facing (on the POS, inside the customer's profile in Zone A)
- This is intentionally a secondary, tucked-away surface — NOT a button on the main Zone A card by default. Represent this as: a small "Manage Favo" link/icon inside the customer card (Screen 1, state A3/A4), which opens the same picker UI as Screen 5 when tapped.
- The picker itself should look and behave identically to Screen 5's — same fields, same component — since it's editing the same record. Only the entry point (tucked into the POS customer card vs. a section on the loyalty page) differs.
- Build the "tucked-away entry point" state clearly enough that it's obviously not a primary, always-visible action — it should read as secondary/lower-emphasis than the "Reorder their Favo" button from state A4.

---

## 7. Screen 7 — Payment / charge confirmation

- Build the moment right after tapping "Charge R[total]" in Zone C: a brief confirmation state (e.g. "Payment successful" with the final charged amount) before the screen resets.
- After confirmation, Zone A should return to its empty state (State A1) — the customer auto-clears by default — while Zones B and C reset to empty (State C1). Show this reset explicitly as an end state, don't leave it implied.

---

## 8. Things that must NOT appear anywhere (verify against this explicitly)

- The word **"wallet"** in any label, button, or copy, anywhere in any screen.
- Any "top up" / "load money" / stored-balance flow of any kind.
- Any category tabs, filter sidebar, or search box inside Zone B (item search doesn't exist for a 5-item menu).
- A clickable "normal milk" option — normal milk is never a selectable control, only its alternative (macadamia) is.
- Any menu item other than the 5 listed in §2.3 (do not carry over Espresso, Flat White, Latte, Cortado, Cold Brew, Iced Latte, Rooibos Tea, English Breakfast Tea, Butter Croissant, Blueberry Muffin, or Cheese & Tomato Toastie — all dropped).
- The incorrect example figure "R24.00 (240 pts)" — always use accurate math (100 pts = R20.00) if you need an example number.

---

## 9. Acceptance checklist

Use this to verify completeness before calling this wireframe done:

- [ ] Screen 1 built with top bar (bean lot tile + both container pills interactive) and all 4 Zone A states (A1–A4)
- [ ] Screen 1 Zone B: grid + all 5 distinct popover variants (Americano's shot-only, the 3 milk+shot items, the 2 milk-only items)
- [ ] Screen 1 Zone C: all 4 states (C1–C4), redemption stepper math correct and capped correctly
- [ ] Screen 2: both states (first submission vs. re-confirm-without-notify)
- [ ] Screen 3: built from scratch, both states (single session, multi-session split day)
- [ ] Screen 4: today + yesterday, all 5 items shown including zero-counts
- [ ] Screen 5: both states (unset, set-with-edit)
- [ ] Screen 6: tucked-away entry point clearly distinguished from primary actions
- [ ] Screen 7: confirmation + reset state shown explicitly
- [ ] Every item in §8's "must not appear" list confirmed absent

---

## 10. Where the fuller backstory lives (optional reading, not required to build this)

If whoever is building this wants the full research/decision history: `docs/POS_REBUILD_PHASE1_RESEARCH.md` through `PHASE4_ORDERING_FLOW.md`, and `docs/POS_REBUILD_DECISIONS.md`, in this same repo/PR (#210). This brief (§0–§9 above) should be sufficient on its own, but those documents explain *why* each decision was made, with cited sources, if that context is useful.
