# FAVO POS Rebuild — Phase 4: Ordering Flow Design

**Status:** AGREED (2026-07-05) · **Phase 4 of 6** — this is the Phase 5 wireframe brief.

## Screen structure — three fixed zones, always visible

| Zone | Contents |
|---|---|
| **A — Customer** | Search/attach customer (name, email, or phone) · Loyalty balance ("R20.00 (100 pts)") · "Reorder their Favo" (if set) |
| **B — Order builder** | Fixed 5-item grid, same position always · customisation popover on tap |
| **C — Running order** | Line items, live total · redemption stepper (if eligible) · Charge button |

Zone C is never a drawer or modal — always on screen (Phase 1's checkout-visibility research). Zone A replaces the old category sidebar's screen space.

## Step by step

**0. Opening-time prompt — every login, supports multiple sessions per day.** Every time a barista logs in, they're prompted to set/confirm today's opening time. If already set and unchanged, the prompt pre-fills it with a quick "Confirm" and **does not** re-send the notification. A push notification fires only on the **first submission of the day** or an **actual change/new entry** — including a genuine reopening later that day (see below), which correctly counts as a new event worth notifying about. Still **dismissible** ("Remind me later") — never blocks order-taking.

**Multiple opening sessions per day.** Confirmed: the café sometimes closes and reopens more than once in a day (e.g. a midday break), which the admin dashboard currently has no way to represent — it only supports one set of hours per day.
- **Admin side:** the operating-hours screen gets a "today's sessions" section where admin can plan ahead — First opening, Second opening, and so on, each as a start (and optionally an expected end) time. This is a same-day override on top of the existing recurring weekly schedule (AT-26 family), which stays as the default for a normal, single-session day.
- **Barista side stays simple, as requested:** the barista never manages a list or picks "which session." They just get the one-field prompt — "What time are you opening?" — every login. Submitting it appends a new session-start entry for today. If the café is reopening after being closed, the barista simply enters the new time; it's recorded as a new session (distinct from the earlier one that day) and triggers a fresh notification, same as the very first opening would. **The barista never records a closing time** — that stays admin-only (either planned in advance, or simply left open-ended for a normal single-session day). This is the one assumption in this design: flag it if closing time needs barista-side tracking too, but nothing in the brief suggested that.

**1. Barista login.** Unchanged (existing PIN login).

**2. Land on the order screen.** All three zones visible immediately. Zone B shows the 5-item grid, nothing selected. Zone C is empty, R0.00. Zone A is an empty customer search.

**3. Attach a customer (optional).** Searchable by **name, email, or phone** (current `searchCustomer` action only matches name + exact phone — needs extending to include email, and ideally partial phone matching too). Skippable for a walk-in/anonymous order. If attached: Zone A shows name, "Loyalty balance: R[x].00 (N pts)," and — if a Favo is set — a "Reorder their Favo" button that adds the full saved order straight to Zone C.

**4. Build the order.** Tap an item in Zone B. A **popover** (not a full sheet — see below) appears anchored to the tapped tile:
- **Milk-based items (Cappuccino, Mocha, Chai Latte, Hot Chocolate):** normal dairy milk is the default and isn't a clickable option at all — there's nothing to tap for it. The only visible control is a single **"Macadamia Milk (free)"** toggle for the customer who wants the alternative. This is deliberately not a two-button "choose your milk" choice; it's one optional opt-in.
- **Espresso-based items (Americano, Cappuccino, Mocha):** an extra-shot stepper, R10 per shot, no upper limit.
- **Americano stays strictly black** — no milk toggle shown for it at all, only the shot stepper.
- Confirming adds the line to Zone C, which updates live.

**Why a popover instead of the current full-screen modal sheet:** Apple's HIG draws a real distinction here — a sheet is modal by default and "prevents people from interacting with the parent view until they dismiss," recommended to be used "brief and occasional... only to facilitate an important task." A popover, by contrast, is for exposing "a small amount of information or functionality," is "particularly well-suited" to iPad, and is meant for lightweight, temporary tasks. Now that milk choice is a single opt-in toggle and shots are a stepper — not a multi-field form — the customisation set is exactly the "small amount of functionality" popovers are for, not the "important task" threshold sheets are meant to gate. A barista doing this dozens of times a shift pays a real, compounding cost for a full-screen open/close cycle every time, per Phase 1's Fitts's Law and Hick's Law citations on minimizing steps for high-frequency actions. **Recommendation: anchor a popover to the tapped tile, dismiss on tap-outside, no separate "confirm" step needed for the common case (nothing selected = add as-is).**
*Sources: Apple Developer Documentation, "Popovers" and "Sheets," developer.apple.com/design/human-interface-guidelines — consistent with the Fitts's Law / Hick's Law citations already in `POS_REBUILD_PHASE1_RESEARCH.md`.*

**5. Apply loyalty — already solved by existing backend, just needs the right UI framing.** If a customer is attached with ≥100 points and order total ≥ R20, a control appears directly in Zone C. This is **not** a single redeem-or-don't toggle — it's a **stepper of R20 units**: 100 points = 1 unit = R20, 200 points = up to 2 units = up to R40, capped at however many whole units the order total can absorb. The barista (or customer, via the barista) picks how many units to apply with −/+, defaulting to 0 (nothing redeemed) until they choose to engage with it — satisfying "choose if they want to use their points at all" — then picks 1 or more units if they do. **This isn't new complexity to design: it's exactly what `redeemLoyalty()` (AT-109) and the original stepper UI (AT-110) already do.** The Phase 5 wireframe just needs to place this stepper inside Zone C instead of a separate dialog.

**6. Payment.** "Charge R[total]" — existing Yoco hosted-fields flow, charging the post-redemption total. No wallet/stored-balance option anywhere.

**7. Completion.** Payment confirms; order enters the existing queue/production flow unchanged (stock deduction now correctly reads milk/shot customisations per AT-145). Zone A auto-clears back to empty after payment; keeping the same customer attached for a follow-up order is one tap away.

**8. Daily order history — new, but mostly already built.** A simple, barista-accessible view (reachable from a menu) showing what was made per day — e.g. "20 coffees today, 10 yesterday." This substantially reuses the existing `TodayCard.tsx` / `getPosToday()` (task M12) — that already shows today's order count, revenue, and waste events to any barista+. It needs two extensions: (a) a per-item breakdown (counts by drink, not just a total order count), and (b) the ability to look at a previous day, not only today. Same permission level as the existing feature (barista + admin) — nothing new is exposed.

## Decisions locked, all rounds

1. Opening-time prompt: every login, dismissible, pre-fills if already set.
2. Notification: fires only on first submission of the day or an actual change/new session — never on re-confirming an unchanged value.
3. Multi-session days: admin dashboard gets a "today's sessions" planner (First opening, Second opening, ...) as a same-day override on the weekly schedule; barista side stays a single simple "what time are you opening" prompt per login, which appends a new session and re-notifies on genuine reopening. Barista never records a closing time.
4. Customer search: name, email, or phone.
5. Milk customisation: normal is not a selectable option, only the macadamia alternative is a clickable toggle. Customisation UI changes from a full sheet to a popover (Apple HIG-backed).
6. Loyalty redemption: confirmed as the existing R20-unit stepper, defaulting to 0/not-redeemed until the barista opts in — no new design needed, just correct placement in Zone C.
7. New: daily order-history view, extending the existing TodayCard rather than building new.

No open questions remain. This is the Phase 5 wireframe brief.
