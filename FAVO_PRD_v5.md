# FAVO Café — Product Requirements Document v5.0

**Authored by:** HOFMI Build Team · nikao@hofmi.net
**Hosting & infrastructure chapter:** Transformate · 2026-08-07
**Version:** v5.0.0
**Supersedes:** FAVO PRD v4.0 (2026-06-18) **and** the v4 context-and-scope direction paper (2026-08-11). Both are retired by this document. v3.0 (2026-05-27) was already superseded.
**Last updated:** 2026-08-12
**Status:** Authoritative. Direction finalised; technical chapters current as of `main` @ `8cef809`.

---

## Why this document exists

Two files were both called "v4" and they contradicted each other on loyalty, wallet, coffee packs, offline mode and hosting. That ambiguity is what produced the Vercel-versus-Coolify split in the infrastructure docs and, downstream, an app that is currently offline. **v5 is a full replacement.** Nothing in v4 or v3 remains authoritative. Where this document and any other file in the repo disagree, this document wins and the other file is a bug.

Three things changed since v4, all structural:

1. **The priorities inverted.** Ease of use for baristas and customers is now Priority 1; cost management is Priority 2. See §03 — this is a deliberate reversal of the v4 scope paper, and it changes the delivery order.
2. **The product got smaller.** Loyalty, the stored-value wallet and coffee packs are removed. FAVO is a café that runs itself well and reports honestly — not a rewards platform.
3. **The hosting model inverted.** Serverless is now disqualified by a diagnosed technical failure, not merely disfavoured. See §09.

Appendix B is a line-by-line diff against v4 for anyone holding the old document.

---

## 01 — Header & Metadata

| Field | Value |
|---|---|
| Project name | FAVO Café Web App |
| Document type | PRD v5.0 — full replacement |
| Repository | `github.com/Heritage-Of-Faith/Favo-WebApp` (private) |
| Public URL | `favo.hofmi.net` — **not** `favo.hofmi.org`, which has never existed (§9.3) |
| Deploy target | Always-on container/VM on Transformate infrastructure |
| Tenancy | Single-tenant within `hofmi`. One café. Multi-location is an explicit non-goal. |
| Locale | English (UI) · ZAR (currency, integer cents) · `Africa/Johannesburg` (UTC+2) |
| Distribution | Public PWA for customers. POS and admin surfaces require **FAVO staff** PIN auth (§1.1). |
| Target launch | **No fixed date.** The app is offline today, so go-live is prioritised over scope. |
| Current state | Built through v4 Phases 1–4, ~900 unit tests green on `main`. Production is down (Vercel `402 — DEPLOYMENT_DISABLED`). |

### 1.1 Who "staff" means — read this before anything else

The word *staff* was doing two incompatible jobs in v4 and in earlier v5 drafts. It refers to two populations who share almost nothing: different numbers, different auth, different relationship to the café. **This document uses the three terms below and never the bare word "staff" on its own.**

| Term | Who | Count | Auth | In the schema |
|---|---|---|---|---|
| **FAVO staff** | Baristas and the admin/owner — the people who *run* the café | ~3–5 | **PIN** on the tablet | `staff` table, `staff.role ∈ {barista, admin}` |
| **Office staff** | HOFMI office employees — church staff, **not** FAVO staff. They *buy and drink* the coffee, and get the free weekday cup | ~63 | Email + password (optional) | `customers` with `status = 'office_staff'` |
| **Church member** | Congregation. Sunday customers | Low hundreds | Email + password (optional) | `customers` with `status = 'church_member'` |

**Office staff and church members are customers.** They never touch the POS, never hold a PIN, and never appear in the `staff` table.

> **This ambiguity was hiding a live bug — see §12.1 L03/L14 and §14 R15.** The free-coffee entitlement is currently keyed to the `staff` table, meaning it can only be granted to one of the ~3 FAVO staff. The ~63 office staff it is actually *for* cannot receive it at all. Credit to Mia for the terminology catch that surfaced it.

---

## 02 — Problem & Why Now

FAVO is a specialty coffee café operating inside the HOFMI office on weekdays and serving the congregation around the Sunday service. It is run by three baristas — Louis, Thandeka and Nkuli — for roughly 63 weekday office staff plus the Sunday congregation.

The daily problem is friction. Order-ready messages go out over WhatsApp, which means either the whole staff group gets pinged for one person's coffee or the barista messages people one at a time, losing seconds on every cup. Someone's "usual" lives on a card written out again for every order. On a Sunday, 45 orders arrive in 85 minutes and a paper queue cannot hold them cleanly. **Every one of these costs the barista time at exactly the moment they have none.**

Underneath that sits the reporting problem: **nobody knows the true cost of a cappuccino.** Beans get rotated, milk gets thrown when it foams badly, cups get dropped, staff drink their free coffee and nobody counts it. COGS moves month to month with no narrative.

And the immediate problem is blunter than either: **there is no working production environment.** The Vercel deployment is disabled and the domain in the docs was never registered. This is not a migration of something healthy — it is a restoration.

> **Mission frame.** FAVO is not run to maximise profit. Weekday coffee is free for staff by design, and Sunday only needs to *not lose money*. What matters first is that the thing is effortless — for the three people making the coffee and for everyone drinking it. Close behind: knowing exactly what it costs, with nobody guessing.

---

## 03 — Priorities

In order. Everything in this document serves one of these two. Where they conflict, Priority 1 wins.

### Priority 1 — Ease: baristas and customers

Order-ready notifications, a fast POS, barista scheduling with opening-hours broadcasts, and simple self-service registration. **The goal is a system that gets out of the way** — not one with more features than anyone asked for.

The test is behavioural, not aesthetic: does a barista mid-rush, with wet hands, get from a person at the counter to an order in the queue without thinking about the software? Does a customer get told their coffee is ready without anyone typing their name?

### Priority 2 — Cost management

Live visibility into COGS, expenses and margin, with no CSV download and no spreadsheet maths. A single rollup showing the ministry what FAVO actually costs to run, and a Sunday P&L that never quietly slips into a loss.

The canonical statement, from FAVO Admin: *"the ability to easily see the movement of COGS and if we are making profit or not, without having to download a CSV and make the calculations myself."*

> **Note on the reversal.** The v4 scope paper ranked these the other way round and said so explicitly: *"knowing exactly what this costs comes first."* v5 reverses it on the owner's decision (2026-08-12). Two consequences worth stating plainly:
>
> - **The ministry rollup — the number the funders care about — now ships after the functionality work.** That is the trade being made, and it should be made with open eyes.
> - **The delivery order barely moves.** Cost management's weekday figures depend on mode confirmation and the walk-in log to be correct at all (§13). The dependency graph already wanted ease-first; the priority order now matches it instead of fighting it.

**Corollary, and it is load-bearing:** a feature serving neither priority is not a feature, it is a liability. This is the reasoning that removes loyalty, wallet and packs in §08.

---

## 04 — Operating Modes

FAVO runs under three modes. Mode **defaults from the date** and is confirmed by the on-duty barista as part of setting the day's opening window (§6.3) — never as a separate step. A normal day needs no extra action; overriding for an event, a cancelled service or a holiday is one tap in the same place.

| | Weekday (Mon–Fri) | Sunday | Event / Social |
|---|---|---|---|
| **Who it serves** | ~63 **office staff** | Office staff + congregation | Attendees, often unregistered |
| **Menu** | Coffee-category items only, single or double shot | Full menu — every active item | Per event profile |
| **Payment** | Free for office staff (1/day). **Yoco not used.** | Everyone pays via Yoco | **Per event profile — may be free, standard-priced, or event-priced** |
| **Milk** | Normal milk provided. Macadamia is bring-your-own. | Macadamia stocked | Follows Sunday stock unless noted |
| **Cups** | Office staff use their own mugs — **no cup/lid cost** | Disposable cup + lid (§7.4) | **Per event profile** |
| **Visitors who aren't office staff** | Logged as a **walk-in** — not charged, tracked for cost | N/A — standard paying customer | Per event profile |
| **Broadcast audience** | Office staff only | Office staff + church members | Per event profile |
| **Financial goal** | No profit expected — track stock, manage cost | Don't run a loss. Don't overcharge either. | Set per event; still tracked for cost |

### 4.1 Two clarifications, because the table reads more expansively than reality

- **"Full menu" on Sunday is five items.** The live menu is Americano, Cappuccino, Mocha, Chai Latte, Hot Chocolate (locked 2026-07-05, Jira AT-136). Sunday does not unlock a larger catalogue — it unlocks the *non-coffee* items among those five, plus payment. Weekday is the coffee-category subset of the same list.
- **Macadamia is the only alternative milk.** Free (R0), not a paid upcharge, and the only alt milk FAVO stocks. Oat and almond were dropped by the same decision. Where the table says "alt. milks", read "macadamia".

### 4.2 How the app knows what day it is

**It reads the calendar date's day-of-week in `Africa/Johannesburg`.** Nothing else — no rolling counter, no "five days then switch," no schedule that advances and could drift out of step. The date is the input; the mode is derived from it fresh, every day:

| Day-of-week | Default mode |
|---|---|
| Monday–Friday | **Weekday** |
| Sunday | **Sunday** |
| **Saturday** | **No default — the café is closed unless an event says otherwise** |
| Any day with an event window in force | **Event** (overrides the above — §6.6 precedence) |

A counter-based scheme would be fragile in exactly the ways that matter here: a missed day, a clock change or a restart would leave it off by one, and it would then be confidently wrong about whether people pay. Deriving from the date cannot drift.

> **Saturday was undefined until Mia asked this question.** The mode table says Weekday means Mon–Fri and Sunday means Sunday, which leaves Saturday with no mode at all. It is now explicit: **Saturday has no default mode and the café is treated as closed.** A Saturday social is an *event* (which is exactly what §6.6's "Saturday social, 18:00–21:00" example is), and if someone opens on a Saturday without one, the opening-window step requires them to pick a mode rather than inheriting a wrong one. This also keeps L03 coherent — the free-coffee entitlement is weekdays only, so a Saturday must never silently behave like a weekday.

### 4.3 Event mode is configured, not inherited

v4's direction paper proposed that Event mode "borrows Sunday's behaviour wholesale." **That model is wrong and v5 discards it**, for a concrete reason: *Discipleship 101 runs on Wednesday nights and nobody pays.* A free evening event that uses disposable cups matches neither Sunday (paid, disposables) nor Weekday (free, own mugs). Inheriting either one produces wrong money or wrong stock.

Event mode therefore carries **its own four switches**, set per event and independent of one another. The full activation strategy is §6.6.

---

## 05 — Success Criteria

Ordered by priority: ease first, cost second, platform last.

### Priority 1 — ease

| Criterion | Target | How verified |
|---|---|---|
| Order-ready push | ≤ 10 s from "Done" | E2E on a real device against staging, through the edge. |
| **Notification target bound at ring-up** | 100% of orders | Every order has a target — a registered customer or explicit none — recorded at creation, before the drink is made (§6.1). Query: orders with a null target must return zero. |
| **No customer-facing order status** | Zero reachable surfaces | No route, page or endpoint exposes order or queue state to an unauthenticated caller. `GET /api/queue/stream` rejects a request without a barista session (§8.6, L23). |
| iOS push honesty | No silent failures | On an iPhone that has not installed the PWA, the app states that notifications need the install — it never shows a subscribed state it cannot honour (L29). |
| Favo one-tap repeat | ≤ 2 taps from matched customer to order placed | Manual drill at the POS. |
| **Favo controls stay bounded** | Never a full-screen takeover | The menu grid is visible and tappable at all times; the Favo row occupies no more than a quarter of the order panel (§6.4). |
| Sunday peak throughput | 45 orders in 85 min (07:50–09:15) | Load test against staging. Queue board stays stable throughout. |
| Order-to-cup — weekday | p50 ≤ 5 min | `placed_at` → `completed_at`. |
| Order-to-cup — Sunday peak | p95 ≤ 10 min | Same query, Sunday window. |
| Opening broadcast audience | Correct without anyone choosing | Weekday broadcast reaches office staff only; Sunday reaches office staff + church members; event reaches its profile's audience. Computed, never hand-picked. |
| **Free event runs with no payment step** | Zero Yoco calls | Discipleship 101 drill: open the event, place orders, assert no payment intent is created and no card prompt appears (§6.6). |
| Event closes itself | Automatic | At the window's end time, mode reverts to the date default and price overrides expire. No event leaks into the next day. |

### Priority 2 — cost

| Criterion | Target | How verified |
|---|---|---|
| Live COGS dashboard | Real time, no manual step | Admin opens dashboard: day revenue, running COGS, expenses, margin, profit flag present and current. Place a test order; COGS increments within 5 s. |
| Ministry rollup | One view, no assembly | Weekday cost + Sunday revenue and cost + event cost, netted, over a selectable week or month. No CSV, no spreadsheet. |
| Weekly ops summary | Delivered automatically | Push + in-app screen to the three baristas and the Admin role, split by mode, every week without anyone triggering it. |
| Walk-in visibility | Every walk-in counted | Weekday summary shows staff coffees and walk-in coffees as two separate counts. |
| Weekday cup/lid exclusion | Zero cup/lid deduction on weekday orders | Place a weekday order; assert `stock_movements` contains no cup or lid row. Place the same order in Sunday mode; assert it does. |
| Weekly inventory variance | < 5% by week 2 | SQL view `v_weekly_variance`. |
| Audit coverage | 100% | `GET /api/admin/audit-coverage` returns 0 orphans. |
| Staff entitlement | Max 1 per staff per weekday | `SELECT staff_id, day FROM staff_entitlement_log GROUP BY 1,2 HAVING COUNT(*) > 1` returns empty. |
| Monthly P&L sign-off | 100% signed before close | `monthly_reports.status='closed'` requires `admin_sig`. DB CHECK. |

### Platform

| Criterion | Target | How verified |
|---|---|---|
| **Live queue survives a full shift** | Connection held ≥ 4 h through the edge | §9.8. This is the constraint that broke the last host — a go-live gate, not a nice-to-have. |
| Backup restores | Verified before go-live | §13.0. A backup that has never been restored is not a backup. |

**Retired from v4:** the loyalty accrual criterion (feature removed) and the offline-drill criterion (demoted — §8.4).

---

## 06 — Functionality · Priority 1

### 6.1 Order-ready notifications — and the flow fix

Registered customers get a push the moment the barista marks the order done. This replaces the WhatsApp workaround, where either the whole staff group is pinged for one person's coffee or the barista messages people individually, wasting time on every cup.

#### The flow assumption that was wrong

The order flow as built assumes **the customer is standing at the counter when the order is created**. The real weekday flow isn't like that: a cup gets placed on the counter and the person walks away. The barista makes it minutes later. By then there is nobody to ask *who is this for*.

This is a sequencing problem in the POS, not a missing table. v5 resolves it with one rule:

> **L28 — Every order binds a notification target at ring-up, before the drink is made.**

Exactly one of two targets is chosen when the order is created:

| Target | How it is set | Notification |
|---|---|---|
| **Known customer** | Barista searches by name or phone; taps their **Favo** or **Something else** (§6.4) | Push to their registered subscription |
| **None** | One tap — a walk-in, an unregistered visitor, or someone who doesn't want a notification | No push. Logged so the consumption count stays honest. |

The POS will not complete order creation without one of the two. "None" is an explicit choice, never a default reached by skipping a step — and it is the correct, expected choice for anyone who isn't a registered customer.

#### Ring-up and make are separated in time

The state machine already supports this — `ordered → in_progress → ready → collected` — and the change is entirely in the POS surface:

1. **Drop-off:** the barista rings up in seconds (Favo one-tap, or none). The order lands in the queue in `ordered`.
2. **The queue is the work list.** Not a status display — the thing the barista actually works from.
3. **Making:** the barista taps into an order to start it (`in_progress`, which deducts stock) and taps **Done** when ready (`ready`, which fires the push).

So the person can walk away the moment they've dropped the cup, and the system already knows who to tell.

#### The platform constraint that shapes all of this: iOS Web Push

**On iPhone and iPad, Web Push does not work in Safari.** It works only for a web app that has been **added to the Home Screen**, and permission must then be requested from a direct user tap. This has been the rule since Web Push arrived on iOS 16.4 and it has not relaxed.

**It constrains the whole Priority 1 notification story**, and the earlier drafts of this document did not state it anywhere:

| Who | Android / Chrome | iPhone / iPad |
|---|---|---|
| Registered customer, order-ready push | Works in-browser | **Requires the PWA installed to the Home Screen** |
| Office staff, opening broadcast | Works in-browser | **Requires install** |

Two consequences, both requirements rather than observations:

1. **Registration and onboarding must include an install step**, with explicit iPhone instructions ("Share → Add to Home Screen"). A customer who registers on an iPhone and never installs will silently never receive a notification — the worst failure mode available, because everything looks like it worked.
2. **This is a further reason notifications are for registered customers only** (§8.6). A mechanism that cannot reach a passing visitor's iPhone is not a mechanism for passing visitors.

*Status: registered-customer push is built. The target-binding rule and the ring-up/make separation are new.*

### 6.2 POS speed and layout

A standard for the **whole** POS, not one screen. Order entry, queue view and checkout are all judged against "does this slow a barista down."

- Large, thumb-friendly tap targets — baristas often have wet or full hands mid-shift.
- A shallow path from customer lookup to order placed. Nobody should get lost several screens deep looking for something routine.
- **No full-screen interstitials on the ordering path.** Anything that covers the menu is a step backwards; see 6.4.
- The Sunday rush is the stress test: **a mis-tap or a buried menu costs real time when it is repeated 45 times.**

*Status: in progress under the POS rebuild (AT-132/133/134). Touch-target audit AT-138 shipped.*

### 6.3 Barista schedule and opening-hours broadcast

An in-app barista schedule (Louis, Thandeka and Nkuli rotate), a shift-start push to whoever is on duty, and a way for that barista to set the day's opening window and broadcast it.

The window is **the window for dropping cups off** — *not* the time by which drinks are finished. The broadcast is plain, not decorated: *"Favo is open 8:45–9:15 — Thandeka."*

**Audience is automatic.** Weekdays reach **office staff** only — congregation members aren't in the building. Sundays reach **office staff + church members**. Events reach whatever their profile specifies (§6.6). The app computes this; nobody assembles a recipient list.

**Mode is defaulted, not forced.** The same step shows the day's mode — Weekday, Sunday, or a named event — already selected from the date. Most days the barista does nothing further. On an exception they switch it right there, before broadcasting, in one tap.

*Status: the opening-window half is built (`opening_sessions`, AT-134, with the admin notify toggle). The rota, shift-start push, mode confirmation and audience split are new.*

### 6.4 Self-registration and The Favo

Anyone — staff or congregation — registers themselves without a barista's help and sets their **Favo**: a menu item plus any standard modifications. Editable at any time, by them.

#### At the POS: prominent, never a takeover

Once a barista looks up a matched customer, two controls appear:

- **Favo — [order spelled out]** — primary, one tap, places the repeat order.
- **Something else** — secondary and visually lighter; dismisses the row and focuses the menu.

**Layout constraints, and these are requirements rather than suggestions:**

- The Favo row is **inline, above the menu grid**. It is never a modal, an interstitial, or a full-screen state.
- It occupies **at most a quarter of the order panel's height**.
- **The menu grid stays visible and tappable at all times.** There is no state in which the barista must dismiss something to reach the menu.
- "Something else" is a dismissal, not a navigation. It does not open another screen.
- Both controls still meet the AT-138 touch-target minimum. *Bounded, not small.*

The point is a one-tap shortcut that costs nothing when it isn't wanted — a full-screen prompt taxes every order that isn't a repeat, which on a Sunday is most of them.

#### Drift prevention is a requirement

Customer-side setup (the account page) and barista-side setup (the POS) must call the **same server action and validate against the same schema** — not two implementations that happen to write to the same table.

*Status: built (`favos` table, `actions/favo.ts`). Needs wiring into the POS row, to the layout constraints above.*

### 6.5 Walk-in tracking

Someone visiting the church on a weekday who isn't office staff, wanting a coffee, **isn't charged** — same as staff — but is logged as a **walk-in** rather than counted against the one-per-staff-per-day entitlement. This keeps weekday consumption numbers (§7.3) honest without turning a walk-in into a registration requirement.

**No daily limit is enforced.** The staff entitlement is DB-enforced at one per day because it is tied to a specific person. A walk-in has no persistent identity to key a limit off, so it is **barista discretion, logged for visibility, not policed by the database.**

Logging captures drink category and type only — **no identity of any kind.**

*Status: new.*

### 6.6 Event / Social mode — activation strategy

Event mode exists so that special weekends, socials and midweek gatherings run on the same system instead of falling back to paper. It is **configured per event, not inherited from Sunday** (§4.3).

#### The four switches

Every event carries these, set independently:

| Switch | Options | Why it is separate |
|---|---|---|
| **Menu scope** | Full · coffee-only · custom subset | A dessert evening and a prayer breakfast want different menus |
| **Payment posture** | `free` · `standard` (Yoco, normal prices) · `override` (Yoco, event prices) | **Discipleship 101 is free.** A paid social is not. Neither should have to borrow the other's behaviour |
| **Cup & lid** | Consumed · not consumed | A free event still burns disposables. Payment and cups are unrelated facts |
| **Broadcast audience** | Staff · Church Member · both · nobody | Wednesday-night attendees are church members on a weekday, which the weekday rule would otherwise exclude |

**The Discipleship 101 profile**, as a worked example: menu = coffee-only · payment = **free** · cups = **consumed** · audience = **Church Member**. Note that this combination is reachable from neither Weekday nor Sunday — which is exactly why the switches exist.

#### Three activation paths

**Path A — recurring template. This is the Discipleship 101 case and the one that matters most.**

An admin defines the event **once**: name, recurrence (*every Wednesday*), window (*18:30–20:30*), and the four switches. From then on, date-defaulting finds it automatically. On a Wednesday the opening-window step already reads:

> **Discipleship 101 · Event · free · disposables · Church Member** — [Confirm]

The barista confirms with the same single tap as any other day. **Zero recurring admin effort, by design** — a weekly event that needs setting up every week is a weekly opportunity to forget, and the day it's forgotten the café silently charges people who shouldn't pay.

**Path B — one-off scheduled event.** Identical, but on a specific date instead of a recurrence. Set up in advance; defaults on the day.

**Path C — ad-hoc, start now.** For something unplanned. From the opening-window step, tap **Start an event**, pick an existing profile or set the switches directly, and **give it an end time**. An end time is mandatory — see deactivation.

#### Deactivation is automatic, and that is the safety-critical part

At the window's end time:

- Price overrides expire. They are **time-boxed `price_history` rows**, so reversion is a property of the data model rather than a cleanup job that can fail to run.
- Mode reverts to the date default.
- The next day defaults normally.

**An event can never leak into the next day.** Backstop: an event window may not exceed 24 hours (L27). An event that silently stayed open would change the café's economics without anyone deciding to — a free event left running turns every subsequent Sunday order free.

#### Precedence, so two rules never both apply

1. A one-off event beats a recurring template on the same date.
2. An explicit event beats the date-derived mode — **including Sunday** — but overriding a Sunday requires a confirmation step, because it is unusual enough to be worth a second of friction.
3. Absent any event, the date decides: Mon–Fri → Weekday, Sun → Sunday.

#### Why event prices can't just be typed into Yoco

A reasonable question, and worth answering in the document because the intuition is common: *if Yoco is connected to the app, why not set the event price on the card machine and let it flow back?*

**Because the flow runs the other way.** The app is the pricing authority; Yoco is a payment gateway that charges the amount it is handed. `createOrder` computes the total from the menu and returns a Yoco payment intent **for that amount**; the webhook confirms that the amount was paid. Yoco has no concept of "a mocha costs R15 tonight" — it only ever sees a number.

Three things break if the price originates at the card machine instead:

1. **COGS and margin go wrong.** Revenue is recorded per order line from the app's own prices. A price entered only at Yoco is never attached to the item that was sold, so the Sunday and event P&L (Priority 2) silently misreports.
2. **The audit trail loses the *why*.** `price_history` is append-only and records who changed a price, when, and for how long. A number typed into a card machine leaves no such record.
3. **A standalone Yoco transaction has no order at all.** If someone charges from the machine directly rather than through the app, there is no order row, no stock deduction, and no queue entry — the drink effectively never happened as far as FAVO is concerned. (This is the deliberate fallback during a Yoco *outage*, and it requires manual reconciliation afterwards precisely because of this.)

**So the override stays in the app — and it is small.** An event window carries a `price_overrides` map; while the window is open, those prices win; when it closes, they expire. Mechanically it is ordinary time-boxed `price_history`, not a second pricing engine.

#### Events report as their own column

Event orders are tagged with the event id and reported as a **third column** in the rollup, alongside Weekday and Sunday — never folded into either. Their economics match neither: Discipleship 101 has weekday-like revenue (zero) and Sunday-like consumption (disposables). Folding it into weekday would understate cup costs; folding it into Sunday would show a phantom loss every Wednesday.

*Status: new. No longer provisional — this is a buildable spec. Scheduled last in §13 on sequencing, not uncertainty.*

---

## 07 — Cost Management · Priority 2

### 7.1 Live COGS dashboard

Real-time revenue, COGS, expenses and margin, visible without downloading anything. **Because weekday revenue is intentionally zero, the dashboard reports by mode rather than as one blended figure** — a blended margin would be meaningless and quietly alarming.

Access is gated to the **Admin role**, not a named individual. Anyone holding that role sees it; the role can be reassigned without a code change.

*Status: built (`GET /api/cogs/live`, `/api/cogs/stream`). Needs the per-mode split.*

### 7.2 Ministry rollup view

A single combined view — weekday cost, Sunday revenue and cost, and event cost — netted together, showing what FAVO actually costs the ministry over a week or a month. This is the number that matters to the people funding it: **total expense minus what Sunday brings in, in one place, assembled by the system and not by a person.**

> **"No spreadsheet" means no spreadsheet is *required* — not that exports go away.** CSV and PDF export stay (`GET /api/reports/export`), and anyone who wants to slice the numbers their own way still can. What ends is *having to* build a spreadsheet before you can answer "are we losing money." The answer is on screen; the export is for when you want to do something further with it.

*Status: new. The most important unbuilt Priority 2 item.*

### 7.3 Weekly ops summary

A short automatic weekly summary to the three baristas and the Admin role. Split by mode, because the week runs under different economic rules:

| Section | Shows |
|---|---|
| **Weekday** | Staff coffees and walk-in coffees as **two separate counts**, milk used, beans used, any stockout, notable waste. Cost and consumption only — no revenue exists. |
| **Sunday** | Revenue, COGS, and a clear profit (green) or loss (red) indicator — to catch a loss early, not to chase profit. |
| **Events** | Per event: attendance proxy (drinks made), consumption, cost, and revenue where the event charged. |

Deliberately compact: a handful of numbers, not a report. Delivered as a **push notification plus a single in-app screen** — not an emailed PDF or CSV.

*Status: partially built (`generateWeeklyPnL()` writes an archival row). Needs the mode split, the walk-in count, the event section, and the push + in-app screen.*

### 7.4 Cups, lids and stock counts

**Yes, FAVO does stock counts.** `stock_takes` and `stock_take_lines` are built, with `runStockTake(kind)` supporting opening, daily and weekly counts, and variance computed and stored on close. Variance bands are T01.

**Cups and lids are already modelled per recipe, and they already differ by drink.** In the seed, an Americano draws a cup and **no lid**; a Cappuccino draws a cup **and** a lid. So "just the cup?" is item-dependent and correct today for the drink, not a blanket rule.

What the recipe *cannot* capture is a customer declining a lid at the counter. Three options were considered:

| Option | Verdict |
|---|---|
| A POS toggle so the barista marks "no lid" | **Rejected.** It costs a tap on every Sunday order — 45 taps to track an R0.80 item. That is precisely the friction Priority 1 exists to remove. |
| Stop deducting lids entirely; treat them as a counted consumable | Rejected — loses the per-drink cost signal that makes COGS meaningful. |
| **Deduct per recipe; true up at stock take** | **Chosen.** |

**The chosen behaviour:** lids deduct per the recipe. Declines are not captured, so lid stock will drift *positive* — the count will show more lids than expected, never fewer. Because that drift is structural rather than a symptom of waste or theft, **lids carry their own wider variance band (T08) so the noise doesn't pollute the overall variance signal** that Priority 2 depends on.

The economics justify the imprecision: a lid is R0.80, and a 45-order Sunday puts at most ~R36 through this line. Modelling it precisely would cost more barista time each week than the entire lid budget. **Cups, by contrast, are 1:1 with a drink and reliable** — no drift, no special handling.

*Status: recipes exist and already vary lid by item. Needs the mode-awareness from §10.5 and the T08 band.*

---

## 08 — Non-Goals

Explicitly not being built, so scope stays honest.

### 8.1 Loyalty programme — removed

No points, no earn, no redemption, no liability. Registration exists for notifications and The Favo, not rewards.

This is a **removal of shipped, working code**. Loyalty earn, multi-unit redemption, the redesigned loyalty page and the in-cart redemption UI are all live on `main`. §13.2 covers the deletion; §14 covers the risk.

**No wind-down.** Outstanding point balances are not converted, credited or compensated. Points cease to exist at removal.

### 8.2 Stored-value wallet — removed, and stays removed

Confirmed emphatically by Nikao on 2026-07-05 and unchanged: no top-up flow anywhere, no spend-from-balance payment method, no balance displayed under any label. **The word "wallet" does not appear in new UI copy, tickets or code comments.**

**Verified complete as of 2026-08-12 — no work remains.** The schema is clean (`wallet_zar` and the wallet ledger are gone; `orders.payment_mode` is `yoco | yoco_deferred | free`), and the enforcement grep below already returns zero across `src/` and `db/`. There is no `topUpWallet` action and no top-up dialog: PR #209 wired one in, and AT-141 subsequently removed it. Any document or memory still describing a live POS top-up flow is out of date.

This clause stays in the PRD as a **standing prohibition**, not a task.

> If a PR, ticket or design reintroduces a top-up or stored-balance concept, it contradicts this document — flag it, don't build it.

### 8.3 Coffee packs — removed

Pre-paid 10-drink packs with 90-day expiry are cut. They served neither priority: they don't improve cost visibility, and they add a step at the counter rather than removing one.

*New in v5. Packs were in scope under v4 L16 and are built (`coffee_packs`, `pack_redemptions`, `purchasePack`, `PackDetailCard` — 22 files).*

### 8.4 Offline counter mode — trimmed, not kept and not deleted

**Not a launch gate.** But the earlier draft of this section said "keep all 23 files as a silent safety net," and **that was wrong for a reason worth recording**, because the mistake is instructive.

The v5 draft argued offline didn't matter because the café runs on a generator and the espresso machine needs power — no power, no coffee, no orders to lose. **That reasoning conflates a power outage with a network outage.** They are different events with different frequencies, and the common one is the network: a brief connectivity blip, during which the espresso machine is running fine and customers are still ordering. That is the case the outbox code actually protects against, and it is the case the generator argument says nothing about.

So the question is not "does offline matter" but **"how much offline machinery does a one-tablet café with brief network blips actually need?"** Three options were weighed:

| Option | Verdict |
|---|---|
| Keep all 23 files, add a CI regression test on the outbox write/replay path | Better than the original plan, but still carries reconciliation machinery for a scenario that cannot arise |
| **Trim to outbox + idempotent retry; delete the conflict-reconciliation layer; add the CI test** | **Chosen** |
| Delete offline entirely | Rejected — gives up real protection against the most likely failure mode |

**Why the conflict layer specifically goes.** `sync_conflicts` implements last-write-wins resolution for genuinely conflicting concurrent edits. FAVO has **one POS tablet** (§Appendix A) — one writer. Conflicting concurrent edits are not a scenario that occurs, so the reconciliation logic, the `sync_conflicts` table, `actions/sync-conflicts.ts` and the admin resolution surface are solving a problem the deployment does not have. Untested code for an impossible case is pure liability: it creates false confidence and it is one more thing to inherit.

**What stays, and why it is already safe.** The outbox queues orders locally and replays them on reconnect. The replay-safety primitive **already exists**: `outbox_log.client_uuid` is a POS-generated UUID with a `UNIQUE` constraint, so a replayed order is rejected as a duplicate rather than double-created. That is idempotency, not conflict resolution — and idempotency is the property a single-writer retry path actually needs.

**Testing.** One CI regression test on the write/replay path, asserting no data loss and no duplicate orders. That replaces the full chaos drill: cheap to run on every PR, and it catches the failure that would actually hurt. `SC08` ("offline: zero orders lost") and v4's "zero orders lost in a 1-hour outage" success criterion stay retired — a 60-minute drill was always testing the wrong duration.

Offline still imposes **no requirement on the host** — it runs entirely in the browser.

*Credit to Mia for the correction. The generator argument sounded decisive and was answering a question nobody asked.*

### 8.5 Discord — removed entirely

No Discord webhook, no `#favo-ops` channel, no ops pings. **The integration is deleted from the codebase, not merely left unconfigured.**

Discord entered FAVO through the HOFMI build-team convention, not through anything the café asked for: it arrived via PRD v3 §07/§09 and was implemented as task **G14** (`src/server/discord/webhook.ts`), wired into `close-daily.ts`, `generate-weekly-pnl.ts`, `scripts/ship-ping.ts` and `infra/sentinel/alerts.yml`.

**It was never relevant to the café.** The baristas coordinate on WhatsApp; the organisation runs on Google Workspace. A `#favo-ops` Discord is an engineering channel café staff have no reason to watch — so v4's rule that `closeDaily()` "pages Admin via Discord" was, in practice, paging a room with nobody in it. **A gate whose alert nobody reads is not a gate.** Keeping it as a dormant "developer sink" would just preserve the ambiguity about where alerts actually go.

> **Sequencing constraint — this one matters.** `closeDaily()`'s *only* current alert is the Discord ping. Deleting it before the replacement exists leaves daily reconciliation computing a variance, writing an audit row, and **telling nobody** — a silent regression on a rule meant to gate the day's close. **The in-app admin alert and Web Push (L09) must land before or with the deletion, never after.** §13.8 sequences this.

### 8.6 Customer-facing order status for guests and walk-ins — out of scope

**Order-ready notifications are for registered customers only.** Nothing shows an unregistered person the progress of their order.

Specifically not being built, in any form:

- No guest notification path — no counter QR, no short link, no "notify me when it's ready" flow, no ephemeral pairing token.
- **No customer-facing order-status or queue page.** The live queue exists for the barista on the POS and is not exposed to customers, guests or walk-ins in any form, under any URL.
- No walk-in order tracking. A walk-in is logged for consumption reporting only (§6.5) and receives no notification.

**Someone who wants to be told their coffee is ready registers.** That is a one-time, self-service step (§6.4). Everyone else collects at the counter, exactly as they do today — which is not a regression, because it is the current behaviour.

Earlier v5 drafts explored a guest QR paired to push, and then a guest-facing live order-status page reading off the queue event stream. **Both are withdrawn and neither should be reintroduced.** They expanded the notification surface to people the system holds no relationship with, and the second one exposed the POS queue — a barista tool — to the public. The iOS constraint in §6.1 independently undermined the first: it could not have reached a passing visitor's iPhone anyway.

> If a ticket, design or PR proposes a guest notification flow, a QR at the counter, or any customer-visible order-status or queue view, it contradicts this document — flag it, don't build it.

### 8.7 Unchanged from v4

Customer self-ordering (in-person only) · dine-in or pre-orders · EFT and instant-EFT · cash · tipping · multi-language · kitchen display screen · supplier composite rating · operating-hours enforcement as an order gate · multi-location · multi-currency · native mobile apps · email, WhatsApp and calendar integrations.

---

## 09 — Hosting & Infrastructure

*Prepared by Transformate, 2026-08-07. Adopted.*

### 9.1 Hosting model — the critical constraint

> **The application MUST run as a continuously-running server process. It MUST NOT be deployed on serverless or function-style hosting.**

The live order queue on the barista tablet holds an **open, long-lived connection for the whole shift**, fed by Postgres `LISTEN/NOTIFY` over SSE (`GET /api/queue/stream`, 30 s heartbeat). Serverless platforms terminate such connections after a short idle window. **This is exactly what broke the previous hosting setup** — a diagnosed failure, not a theoretical risk.

Three hard requirements follow. Any option failing **any one** is disqualified:

1. **Always-on runtime** — a container or VM running continuously. No cold starts, no per-request lifecycle.
2. **Direct database connection** — PostgreSQL over a *direct* session connection, not a serverless/pooler-only path. Note for evaluation: several serverless-Postgres products (Neon among them) do not support `LISTEN/NOTIFY` at all and are not candidates regardless of other merits.
3. **Co-location** — application and database in the **same location**. Every page makes several DB round trips, so app↔DB latency matters far more than user↔app latency.

### 9.2 Target architecture

| Concern | Provision |
|---|---|
| Runtime | Always-on VM on Transformate infrastructure; the Next.js server runs continuously |
| Database | PostgreSQL **co-located on the same host**, direct connection |
| Public access / TLS | HTTPS via Cloudflare; a **stable public URL** (required for the Yoco webhook and the PWA) |
| PWA & push | HTTPS + Web Push (installable app + "order ready" notifications) |
| Live order queue | Long-lived connection validated **end-to-end through the edge before go-live** (§9.8) |
| Timezone | `Africa/Johannesburg` on the container — all day-close and wall-clock logic depends on it |
| Resources | 512 MB working set, 768 MB burst. One instance. Traffic is tiny (§9.9). |

**Two code simplifications this unlocks:**

- `db/index.ts` sets `prepare: false` for PgBouncer compatibility. On a direct connection that workaround is removed and prepared statements are re-enabled.
- The two-connection-string arrangement (pooled `6543` for queries, session-mode `5432` for the queue stream) **collapses to one**, removing a standing source of misconfiguration.

### 9.3 Domain, DNS and TLS — resolved

**`favo.hofmi.net`.** Free, unused, and keeps FAVO under the HOFMI umbrella. A dedicated `.co.za` can be added later if the café wants its own public identity — the public base URL is a single config value, so cutting over later is trivial.

> **`favo.hofmi.org` was a wrong TLD, not a lost domain.** `hofmi.org` has never been registered — NXDOMAIN, not on public DNS at all. The domain HOFMI owns is `hofmi.net`: apex A records serve the existing website, Google Workspace MX carries the email, DNS is managed at **Xneelo**. `favo.hofmi.net` is NXDOMAIN and ours to take. Every `favo.hofmi.org` reference in this repo is a typo — §13.6.

**Transformate manages** the serving, the TLS certificates and their renewals. FAVO adds DNS records; Transformate runs the rest.

#### The mechanism, confirmed

Attaching `favo.hofmi.net` **does not require moving the `hofmi.net` zone.** The mechanism is **Cloudflare for SaaS custom hostnames**: Transformate adds `favo.hofmi.net` as a custom hostname on *their* Cloudflare zone, we add a CNAME for `favo` plus one validation record at Xneelo, and Cloudflare issues and renews the certificate.

**This is not an Enterprise-only capability.** Cloudflare for SaaS custom hostnames are available on Free, Pro and Business plans, with 100 custom hostnames included at no charge. We need exactly one.

> **Where the earlier doubt came from, so it isn't re-raised.** `docs/HOSTING_BRIEF.md` §6 concluded that partial/CNAME onboarding is Enterprise-only. That conclusion was about a **different product**: onboarding *our own zone* to Cloudflare in partial (CNAME) setup, which is indeed Enterprise and would require the nameservers for `hofmi.net` to change. What Transformate described is the SaaS-provider direction — their zone, our hostname — and it carries none of that exposure. The two were conflated. **The zone stays at Xneelo; Google Workspace MX is never touched; there is no zone migration in this plan.**

**Verification is a DNS check, not a conversation** — run before and after the change, and it must show only the intended difference:

```bash
dig +short MX hofmi.net && dig +short NS hofmi.net && dig +short favo.hofmi.net
```

Acceptance: MX unchanged, NS still Xneelo (`ns1/ns2.host-h.net`, `ns1/ns2.dns-h.com`), `favo.hofmi.net` resolving, certificate valid. Anything else is a stop.

### 9.4 Data, retention and POPIA

**Stored:** menu, orders, payments (**a reference and amount only — no card data**), stock and inventory, and a permanent append-only audit log of every change.

**Personal data:** customer name, email, phone, order history, hashed passwords; hashed staff PINs. **No card details are stored or seen** — all card entry happens in Yoco's own secure fields.

*v4 listed "loyalty history" among stored personal data. Removed with §8.1.*

**Retention:** financial records kept **≥ 5 years** for tax. Backups are sized for retention, not data volume.

**Backups:** automated, encrypted, off-site, with **periodically tested restores**. This is a payments and tax-record system — a backup that has never been restored is not a backup.

**Residency: EU** (§16). POPIA-compliant given the documented safeguards and the privacy policy already in place.

### 9.5 Authentication and access control

**Two independent auth systems:**

- **Staff** — PIN login on the tablet. Two roles: **barista** (orders, discounts) and **admin/owner** (menu, prices, stock, reports, audit log).
- **Customers** — email + password. May only ever access their own data.

**Authorization is enforced on the server**, not only in the interface. UI checks are advisory.

**Optional network-level lock** on the admin and till surfaces via Cloudflare Access (email-gated), layered on top of the app's own auth. Defence in depth, not a substitute for RBAC.

### 9.6 Integrations

- **Yoco** — card payments, including the **payment-success webhook**, which requires the stable public endpoint from §9.2.
- **Web Push** — order-ready notifications, opening broadcasts, shift-start pushes, low-stock alerts and the weekly summary. **This is the notification system of record for everyone who runs or uses the café.**
- **Four scheduled jobs** — low-stock check, end-of-day close, weekly P&L summary, and a retry for unconfirmed payments. On the new host these run as **server-side timers**, not platform cron functions.
- **No Discord** — removed entirely (§8.5).
- No email, WhatsApp or calendar integrations.

**Alerting, stated positively:** every operational signal FAVO raises — order ready, opening broadcast, shift start, low stock, daily-close mismatch, the weekly summary — is delivered by **Web Push and the in-app admin dashboard**. There is one notification system, and the people who run the café are already in it.

### 9.7 Deployment and environments

- **Source:** private GitHub repository; ~900 automated tests on every change.
- **CI/CD:** merge to `main` → tests run → **automatic deploy**. No manual uploads.
- **Environments:** a separate **staging** environment alongside production.
- **Secrets:** managed vault (Infisical). Never committed. Replaces v4's Vercel environment variables — roughly 15 variables move.

### 9.8 Operations

- **Monitoring:** uptime and health checks (`GET /api/healthz`) on Transformate's fleet observability engine.
- **Pre-go-live validation:** the live-queue long-lived connection is **explicitly tested end-to-end, through the edge**, because it is the previous failure point. A local test that bypasses Cloudflare does not satisfy this.

### 9.9 Scale — context for sizing

Low traffic. Peak is **~45 orders in 85 minutes** on a Sunday; low-hundreds of customer accounts over time; thousands of records per year; the database stays well under a few GB for years. Infrastructure is sized accordingly — **deliberately small.**

---

## 10 — Data Model

Schema in `db/schema.ts` (Drizzle), migrations in `drizzle/`. The audit log is append-only, trigger-enforced, forever.

**Current: 35 tables. After v5: 35 − 4 removed + 4 added = 35.**

### 10.1 Tables removed

| Table / column | Reason |
|---|---|
| `loyalty_transactions` | §8.1 — hard delete, no historical retention |
| `customers.loyalty_points` | §8.1 |
| `coffee_packs` | §8.3 |
| `pack_redemptions` | §8.3 |
| `sync_conflicts` | §8.4 — conflict reconciliation for a multi-writer scenario that a one-tablet café cannot produce. `outbox_log.conflict_id` drops with it. |

Removal is a forward migration with a `down` script, executed only after a verified backup (§13.2).

### 10.2 Tables added

| Table | Purpose | Key columns |
|---|---|---|
| `walk_ins` | Weekday non-staff visitors, for consumption reporting. **No identity of any kind.** | `id`, `order_id`, `menu_item_id`, `category`, `logged_by_staff_id`, `at` |
| `barista_shifts` | The rota. Who is on duty on which date. | `id`, `staff_id`, `shift_date`, `notified_at` |
| `event_profiles` | Reusable event definition, one-off or recurring. | `id`, `name`, `recurrence` (null = one-off), `default_start`, `default_end`, `menu_scope`, `payment_posture`, `consumes_cup_lid`, `audience`, `active` |
| `event_windows` | A concrete occurrence. **Switches are snapshotted at open**, so editing a profile never rewrites history. | `id`, `event_profile_id` (null = ad-hoc), `name`, `starts_at`, `ends_at` (NOT NULL), `menu_scope`, `payment_posture`, `consumes_cup_lid`, `audience`, `price_overrides` (jsonb), `created_by_staff_id` |

> **Why two event tables.** A recurrence needs a template; reporting needs a concrete occurrence to attribute orders to. Snapshotting the four switches onto the window is the same reasoning as `price_history` — the record of what actually happened must not change when someone edits the template next month.

### 10.3 Columns added to existing tables

| Table | Column | Purpose |
|---|---|---|
| `customers` | `status` (enum: `office_staff`, `church_member`) | Audience targeting (§6.3) and free-coffee eligibility (L03). Set at self-registration. **The value is `office_staff`, not `staff`** — the bare word collides with the `staff` table (§1.1). |
| `opening_sessions` | `mode` (enum: `weekday`, `sunday`, `event`) | The day's mode, defaulted from the date, confirmed by the barista. |
| `opening_sessions` | `event_window_id` (nullable) | The event in force, when mode is `event`. |
| `orders` | `notification_target` (enum: `customer`, `none`) | L28 — bound at ring-up, never null. |
| `orders` | `event_window_id` (nullable) | Attribution for event reporting (§6.6). |

### 10.3.1 Repointing the free-coffee entitlement (L03/L14)

The entitlement currently keys off the wrong table (§12.1 L03). Corrective migration:

| Change | Detail |
|---|---|
| `staff_entitlement_log.staff_id` → `customer_id` | FK to `customers`, not `staff`. This is the **beneficiary** — an office staff member. |
| `staff_entitlement_log.applied_by_staff_id` | **Unchanged.** Still FK to `staff` — the barista who applied it. Both facts matter and they are different people. |
| `UNIQUE(staff_id, day)` → `UNIQUE(customer_id, day)` | The daily cap now applies per office staff member, which is what L03 always meant. |
| Application check | Reject unless the beneficiary is `status='office_staff'`. A church member does not get free weekday coffee. |

**Existing rows:** any historical entitlement rows point at FAVO staff and cannot be mapped to a customer. Migrate them into an archival table rather than deleting or guessing — they are audit history and the audit log is append-only (L12).

**Table name.** `staff_entitlement_log` is now a misnomer. Renaming it is cosmetic and touches every query, so it stays; the column rename is what carries the meaning. Flagged here so the name isn't read as authoritative.

> **Design note — why `opening_sessions.mode` and not a parallel `service_days` table.** §6.3 requires mode confirmation to be *the same step* as setting the opening window, never a separate, easy-to-forget action. A parallel table invites exactly the drift the requirement exists to prevent: two rows disagreeing about what kind of day it is. One row, one confirmation, one source of truth. `opening_sessions` already carries the date, window, barista and broadcast record — mode belongs with it.

### 10.4 Config, not constants

- **Eligible free-item categories** — admin-editable, not hardcoded. Currently coffee-category only, but the list must be changeable **without a code change** (T06).

### 10.5 Recipe deduction — three changes in one pass

1. **Cup and lid excluded on weekday orders** (reusable mugs), included on Sunday, and **per the event's switch** on event orders (L24).
2. **`deductForOrder()` currently ignores `order_items.modifications` entirely** — it always deducts the base recipe regardless of which milk was chosen. Silently wrong since it was built (found 2026-07-05, Jira AT-145).
3. Deduction becomes **mode-aware**, reading the mode from the day's `opening_sessions` row.

These land on the same function and **must be fixed together.** Fixing (1) without (2) produces a deduction path that is mode-correct and ingredient-wrong — harder to spot than being wrong in both.

### 10.6 Invariants

- Never DELETE or UPDATE rows in `stock_movements`, `audit_log` or `price_history`. Void with a follow-up INSERT. Trigger-enforced on `audit_log`, policy-enforced on the others.
- Money is integer cents in `_zar`-suffixed columns. Never `numeric`.
- Storage in `timestamp with time zone`; all wall-clock semantics in `Africa/Johannesburg`.

### 10.7 RLS summary

- **Customers** — SELECT their own `orders` and their own `favos` row. No write access to orders.
- **Barista** — SELECT/INSERT `orders`, `order_items`, `waste_log`, `walk_ins`, `staff_entitlement_log`, `event_windows`. Search `customers` by name or phone (read-only, name + phone only). Cannot DELETE anything.
- **Admin** — write `price_history`, `operating_hours`, `stock_alert_recipients`, `barista_shifts`, `event_profiles`, eligible-category config; approve emergency `purchases`; sign `monthly_reports`; all financial reports. `audit_log` stays INSERT-only even for Admin.

---

## 11 — API Surface

Server Actions for mutations (`src/server/actions/*`). Route handlers for queries and webhooks. SSE for the live queue. All ordering flows are barista-only.

### 11.1 Removed

| Action | Note |
|---|---|
| `redeemLoyalty(...)` | §8.1 |
| loyalty earn on payment confirmation | §8.1 — removed from the Yoco webhook and `transitionOrder` |
| `topUpWallet(...)` | §8.2 — **already removed** by AT-141. Listed for the record; no work remains. |
| `purchasePack(...)` | §8.3 |
| `GET /api/admin/loyalty-liability` | §8.1 |
| `actions/sync-conflicts.ts` + the admin conflict-resolution surface | §8.4 — the reconciliation layer goes; the outbox and its idempotent retry stay |

### 11.2 Added

| Action | Kind | Auth | Behaviour |
|---|---|---|---|
| `setDayMode(sessionId, mode, eventWindowId?)` | Server action | barista | Sets `opening_sessions.mode`. Called from the opening-window step, defaulted from the date. Audited. |
| `logWalkIn(orderId, menuItemId)` | Server action | barista | Inserts `walk_ins`. Never charges. Never touches `staff_entitlement_log`. |
| `broadcastOpeningWindow(sessionId)` | Server action | barista | Push to the audience computed from mode: office staff on weekdays, office staff + church members on Sundays, the profile's audience on events. Never a hand-picked list. |
| `setEligibleCategories(list)` | Server action | admin | Config change for the free-item entitlement. Audited (T06). |
| `createEventProfile(input)` / `updateEventProfile(id, input)` | Server action | admin | The reusable template — recurrence + four switches (§6.6). |
| `openEventWindow(profileId? , input)` | Server action | barista/admin | Opens an occurrence, snapshotting the switches. **Requires `ends_at`**; rejects windows > 24 h (L27). |
| `closeEventWindow(id)` | Server action | barista/admin | Early close. Reverts mode and expires overrides. Automatic at `ends_at` regardless. |
| `getMinistryRollup(from, to)` | Route handler | admin | Weekday cost + Sunday revenue and cost + event columns, netted (§7.2). |

### 11.3 Amended

| Action | Change |
|---|---|
| `searchCustomer(query)` | Stops returning `loyalty_points`. Returns `status` and the customer's Favo. |
| `createOrder(input)` | Mode-aware. **Requires a `notification_target`** (L28). On weekday mode — and on events with `payment_posture='free'` — creates with `payment_mode='free'` and **no Yoco intent**. Tags `event_window_id` when an event is in force. |
| `transitionOrder(id, toState)` | `in_progress` deduction becomes mode-, event- and modification-aware (§10.5). `ready` fires push to the registered customer, and no-ops for target `none`. Loyalty accrual removed. |
| `applyStaffDiscount(orderId, beneficiaryStaffId)` → **`applyFreeCoffee(orderId, beneficiaryCustomerId)`** | **Signature change.** The beneficiary becomes a `customers.id` with `status='office_staff'`, not a `staff.id` (§10.3.1, L03). Rejects church members and FAVO-staff ids. Eligible categories read from config (T06). The rename is worth the churn — the old name is what made the bug invisible. |
| `POST /api/payments/yoco/webhook` | Loyalty accrual and wallet credit removed. Payment confirmation and idempotency unchanged. |
| `closeDaily()` | On mismatch, blocks and raises an **in-app admin alert plus Web Push** to the Admin role. The Discord ping is deleted (§8.5, L09). |

### 11.4 Unchanged

`loginWithPin` · `cancelOrder` · `logWaste` · `runStockTake` · `openContainer` / `closeContainer` / `listOpenContainers` · `checkLowStock` · `setMenuItemPrice` · `generateWeeklyPnL` · `approveMonthlyPnL` · `GET /api/queue/stream` · `GET /api/cogs/live` · `/api/cogs/stream` · `GET /api/reports/export` · `POST /api/push/subscribe` · `GET /api/healthz` · `GET /api/admin/audit-coverage` · refunds (L02).

### 11.5 Conventions

- `"use server"` on all actions. Zod validation at entry.
- Tagged-union returns: `{ ok: true, data } | { ok: false, code, message }`. **They never throw for auth or validation — always check `res.ok`.**
- Every mutation calls `writeAudit()`. Failure to audit fails the transaction.
- RBAC server-side via `getSession()`. UI is advisory.
- State transitions use `SELECT … FOR UPDATE`.
- Webhook idempotency keyed on provider id.
- Never log or echo PAN, CVV or expiry.

---

## 12 — Business Rules

### 12.1 Locked — require a PRD amendment to change

**L01 — Payment is required where payment applies.** On Sunday orders and on events with a paid posture, an order without a successful Yoco payment record is never completed; failed payment cancels the order and no stock is deducted. **On a standard weekday order, and on any event with `payment_posture='free'`, there is no payment step at all** — the order is created with `payment_mode='free'`.
*Amended from v4's unconditional "no payment, no order", which could not survive weekday free coffee, walk-ins, or a free event.*

**L02 — No refunds.** FAVO does not process refunds.

**L03 / L14 — Free weekday coffee: one per office staff member per weekday.** The beneficiary is an **office staff member — a `customers` row with `status='office_staff'`** (§1.1), *not* a FAVO staff member. 100% discount applied by the barista at checkout. Eligible items come from the **admin-configurable eligible-category list** (currently coffee-category only). Enforced at the DB by `UNIQUE(customer_id, day)` on `staff_entitlement_log`, weekdays only. Ineligible-category attempts are rejected at the application layer before the DB is touched.

> **This rule is not correctly implemented today, and the gap is material.** `staff_entitlement_log.staff_id` is a foreign key to the **`staff`** table — baristas and admins — and `applyStaffDiscount(orderId, beneficiaryStaffId)` takes a `staff.id`. So the entitlement can only be granted to one of the ~3 FAVO staff. **The ~63 office staff the benefit exists for cannot receive it at all**, because they are customers and have no `staff` row (which would require a PIN and a barista/admin role). The daily-uniqueness constraint is therefore also enforcing the wrong thing. Fix in §13.3; risk R15; migration in §10.3.

**L04 — Operating hours are display-only.** The system never rejects an order based on time of day.

**L05 — Ordering is in-person only.** Baristas create all orders. Customers have no write access to `orders`.

**L07 — Midnight SAST is the revenue-day boundary.**

**L08 — Every inventory adjustment writes an audit row.** Trigger-enforced.

**L09 — Stock reconciles with sales before daily close.** `closeDaily()` blocks on mismatch and **raises an in-app admin alert plus Web Push to the Admin role.** No other channel carries this alert.
*Amended: v4 made Discord the paging channel. Discord is removed entirely (§8.5), and the replacement must land before the deletion so the alert is never lost.*

**L10 — Emergency purchases require admin approval.** DB CHECK.

**L11 — Monthly P&L requires Admin sign-off to close.** DB CHECK.

**L12 — The audit log is append-only.** UPDATE and DELETE trigger-denied forever. Not disableable by any role.

**L13 — FAVO data is tenant-isolated to `hofmi`.** RLS-enforced.

**L15 — The barista taps Done to mark an order ready.** One person owns the full order lifecycle. **Done must be the most prominent action on the active-order view.**

**L17 — Milk and beans use the container model.** Tracked as bottles and bags (cups), not ml and g. One coffee = one cup from the OPEN container; at most one open container per item; open and close on the POS, auto-opening the next sealed container so coffee never stalls.

**L18 — Mode is derived from the calendar date's day-of-week in `Africa/Johannesburg`, never from a counter or rolling schedule**, and is confirmed in the opening-window step. Mon–Fri → Weekday; Sun → Sunday; **Sat → no default, café closed**; any day with an event window in force → Event. Never a separate action. Always overridable in one tap, before the broadcast is sent (§4.2).

**L19 — Yoco is used on Sundays and on paid events only.** No payment step exists on a standard weekday order or a free event.

**L20 — Walk-ins are logged but never charged, and never counted against the staff entitlement.** No daily limit is enforced — barista discretion, logged for visibility.

**L21 — Cost, expense and summary visibility is role-based.** Visible to the Admin role, never tied to a named individual.

**L22 — Broadcast audience is computed, never hand-picked.** Office staff on weekdays; office staff + church members on Sundays; the event's configured audience during an event. Audience is derived from `customers.status` (§1.1), never from the `staff` table.

**L23 — Order status is never exposed to a customer, guest or walk-in.** The live queue is a barista tool on the POS. There is no customer-facing order-status or queue view, and no guest notification path (§8.6).

**L24 — Cup and lid deduction follows the mode.** Excluded on weekday orders; included on Sunday orders; **per the event's `consumes_cup_lid` switch** on event orders.

**L25 — An event carries its own payment posture.** `free`, `standard`, or `override`. **Event mode does not inherit Sunday's payment behaviour.** A free event creates no Yoco intent and shows no card prompt.

**L26 — Cup/lid consumption is a per-event switch, independent of payment posture.** A free event may still consume disposables. *(Discipleship 101 is the reference case: free, disposables, church-member audience.)*

**L27 — Every event window has an end time, may not exceed 24 hours, and closes automatically.** On close, mode reverts to the date default and price overrides expire. **An event can never leak into the next day.**

**L28 — Every order binds a notification target at ring-up** — a registered customer, or explicit none — **before the drink is made.** Order creation cannot complete without one. "None" is chosen, never defaulted into.

**L29 — Web Push on iPhone and iPad requires the PWA to be installed to the Home Screen.** Registration and onboarding must include an install step with explicit iOS instructions. A customer who registers on an iPhone without installing must not be left believing notifications will arrive — the app states the requirement rather than failing silently (§6.1).

**Retired rule numbers — do not reuse.** `L06` (loyalty) and `L16` (wallet and coffee packs) are retired by §8.1–8.3. The numbers stay burned so an old reference to "L06" fails loudly instead of silently matching a new rule.

### 12.2 Tunable — Admin can change with a logged config change

| ID | Default | Tuning point |
|---|---|---|
| T01 | Variance bands: 0–5% ok · 5–10% investigate · 10%+ critical | `config.variance_bands` |
| T02 | Bean freshness alert at 14 days post-roast | Per-lot origin |
| T03 | Sunday rush window 07:50–09:15 | `config.sunday_window` |
| T04 | Low-stock thresholds | `inventory_items.low_stock_threshold` |
| T05 | Low-stock check interval: 15 min | Timer schedule |
| T06 | Eligible free-item categories: coffee only | Admin UI. Must extend without a rebuild. |
| **T08** | **Lid variance band: 0–25% ok** (wider than T01, because lid declines are deliberately unmodelled — §7.4) | `config.variance_bands.lid` |

**Retired tunable — do not reuse.** `T07` (guest pairing TTL) is retired with §8.6.

### 12.3 Universal invariants

Never store, log or echo PAN/CVV/expiry — Yoco hosted fields only · money is integer cents in `_zar` columns · wall-clock semantics in `Africa/Johannesburg` · every mutation writes an audit row, and failure to audit fails the transaction · RBAC server-side · idempotency on every webhook key.

---

## 13 — Delivery Plan

No calendar. Ship in priority order; each capability ships when it is ready and correct. The order below is dependency-driven.

### 13.0 Gate zero — get back online

Nothing else matters while production is down. This is §09 executed, and it ships before any feature work.

- Stand up the always-on host and co-located Postgres.
- **Rotate the database password** (exposed during development) and re-issue Yoco and VAPID keys.
- Attach `favo.hofmi.net` via Cloudflare for SaaS (§9.3); run the `dig` check before and after; set `AUTH_URL` + `PUBLIC_BASE_URL`.
- Move ~15 secrets into Infisical.
- Re-point the Yoco webhook; re-run `tests/e2e/prod-smoke.spec.ts`.
- **Verify the backup by restoring it**, before the café depends on the system again.
- **Validate the live queue through the edge for ≥ 4 hours** (§9.8). This is the gate the previous host failed.

### 13.1 Priority 1 — the flow fix

The highest-value functional change, and a prerequisite for everything else in Priority 1:

- `orders.notification_target` + the L28 binding rule.
- Ring-up / make separation in the POS; the queue as the work list.
- **PWA install step in registration/onboarding, with iOS instructions** (L29). Without it, every iPhone customer silently gets no notifications.
- Wire The Favo into the POS row, to the 6.4 layout constraints.

### 13.2 Removal — loyalty and packs

**The wallet is already gone** (§8.2, verified 2026-08-12) — this pass covers loyalty and coffee packs only. They share code paths, so it is one coordinated pass. Sequence matters:

1. Take and **verify** a full backup. Removal is a hard delete with no wind-down — the backup is the only reversal path.
2. Remove UI surfaces first: the customer loyalty page, the three admin loyalty pages (`/admin/loyalty`, `/loyalty/reconcile`, `/loyalty/liability`), in-cart redemption from AT-140, `PackDetailCard`, and the loyalty references on the admin customer detail page.
3. Remove server actions and the accrual path (`src/server/loyalty/calc.ts`, `accrue.ts`, the Yoco webhook hook, `GET /api/admin/loyalty-liability`).
4. Drop tables and columns (§10.1) with a tested `down` script.
5. Update the ~34 loyalty test files and ~22 pack files; suite green throughout.
6. Check the customer-facing **privacy policy** page — it currently describes loyalty data collection and must stop, since POPIA disclosure has to match what is actually stored (§9.4).

**Scale, so nobody underestimates it: 76 source files reference loyalty, 22 reference packs.** The largest single change in v5 — and it is deletion, which is the good kind of large. Placed here because it clears the POS and admin surfaces before the mode work lands on them.

**Enforcement checks — must return zero before this is done:**

```bash
grep -rIn -i "wallet" --include="*.ts" --include="*.tsx" src/ db/ | grep -v -iE "test|migration|POS_REBUILD"
```

```bash
grep -rInE -i "loyalt|coffeepack|packRedemption" --include="*.ts" --include="*.tsx" src/ db/ | grep -v -iE "migration"
```

### 13.3 Priority 1 — modes, schedule, identity

- `opening_sessions.mode` + `setDayMode` + one-tap confirm in the opening-window step (L18).
- `customers.status` (`office_staff` / `church_member`) + the registration change; computed broadcast audience (L22).
- **Repoint the free-coffee entitlement to `customers` (§10.3.1)** and rename `applyStaffDiscount` → `applyFreeCoffee`. Do this *with* the `status` column, not after — the entitlement check depends on it, and until both land the weekday benefit reaches nobody it is meant for (R15).
- Barista rota + shift-start push (§6.3).
- `walk_ins` table and POS logging (§6.5).
- **Mode-aware and modification-aware deduction, in one pass** (§10.5) — the correctness fix that makes every downstream cost number trustworthy.
- Eligible-category config (T06).

### 13.4 Priority 1 — event mode

`event_profiles` + `event_windows`, the four switches, all three activation paths, automatic close and the 24-hour backstop (§6.6). **Discipleship 101 is the acceptance case**: recurring Wednesday template, free, disposables, church-member audience, confirmed in one tap and closing itself at 20:30.

Last within Priority 1 on sequencing — it depends on modes (13.3) existing — not on uncertainty.

### 13.5 Priority 2 — cost management

- Per-mode split on the live COGS dashboard (§7.1).
- **Ministry rollup view (§7.2).**
- Weekly ops summary: mode split, walk-in count, event section, push + in-app screen (§7.3).

Deliberately after 13.3: the weekday and event figures are wrong until mode confirmation, the walk-in log and corrected deduction all exist. Building the reports first would produce numbers that look authoritative and aren't.

### 13.6 Offline trim (§8.4)

Small, and worth doing before go-live so nobody inherits untested machinery:

- Delete the `sync_conflicts` table, `actions/sync-conflicts.ts`, the admin resolution surface, and `outbox_log.conflict_id`.
- Keep `useOfflineOutbox`, `apply-outbox.ts`, `POST /api/sync/orders` and `outbox_log` — including the `client_uuid` unique constraint, which is the idempotency guarantee.
- **Add one CI regression test** on the write/replay path: assert no data loss and no duplicate order on replay. This runs on every PR and replaces the chaos drill.

### 13.7 Doc reconciliation — do not skip

The docs currently describe two different infrastructures and one domain that never existed.

- Correct `favo.hofmi.org` → `favo.hofmi.net` in `CLAUDE.md`, `ARCHITECTURAL.md`, `README.md`, `docs/deploy-runbook.md`, `docs/production-env-checklist.md`, `docs/CLAUDE.md`.
- Update `ARCHITECTURAL.md`, `docs/API.md`, `docs/BUSINESS_RULES.md`, `docs/DATA_MODEL.md` to match this document. `docs/API.md` and `docs/BUSINESS_RULES.md` were already stale against v4 — both still say the staff discount is "Cappuccinos only" and redemption is full-only. Fix them here rather than layering another version on top.
- Point `CLAUDE.md`'s "PRD is the source of truth" reference at **this file** — it currently points at `FAVO_PRD_v3.md`.
- Move the superseded documents to `docs/archive/`: `docs/FAVO_PRD_v4.md`, `docs/FAVO_PRD_v3.md`, `docs/FAVO_Phase4_Build_Plan.md`, `FAVO_Phase2_Build_Plan.md`, `docs/FAVO_Phase3_Build_Plan.md`. They describe retired infrastructure and removed features, and every one of them is a place a future session can pick up a stale answer.
- **Root-level duplicates.** `API.md`, `BUSINESS_RULES.md`, `ARCHITECTURAL.md` and `DESIGN.md` exist at both the repo root and in `docs/`, and the copies have drifted apart. Keep one of each — the `docs/` copy — and delete the root duplicates.

### 13.8 Discord removal — replacement first, then delete

Two steps, and **the order is not negotiable** (§8.5). `closeDaily()`'s only alert today is the Discord ping; deleting it first leaves reconciliation silently unalerted.

**Step 1 — build the replacement.** Admin-role Web Push plus an in-app admin dashboard alert for the daily-close mismatch (L09). The push infrastructure already exists (`subscribeStaffPush`, `stock_alert_recipients`, `low_stock_pings`), so this is a new alert on an existing rail, not a new rail. Verify by forcing a mismatch on staging and confirming the Admin device receives it.

**Step 2 — delete Discord.** Complete footprint:

| File | Action |
|---|---|
| `src/server/discord/webhook.ts` | Delete |
| `src/server/crons/close-daily.ts` | Drop the import and the `pingFavoOps` block; alert via the Step 1 path |
| `src/server/crons/generate-weekly-pnl.ts` | Drop the import and ping; the weekly summary already delivers by push + in-app (§7.3) |
| `scripts/ship-ping.ts` | Delete — the WI record is the ship notification (§15.2) |
| `tests/unit/server/close-daily.test.ts` · `tests/unit/server/crons.test.ts` | Remove the Discord mocks and assertions; keep the reconciliation and formatting coverage |
| `infra/sentinel/alerts.yml` | Repoint the `discord-favo-ops` contact point at Transformate's observability alerting (§9.8) |
| `.env.example` | Remove `DISCORD_WEBHOOK_FAVO_OPS` |
| `docs/ops-runbook.md` · `docs/incident-playbook.md` · `docs/deploy-runbook.md` · `docs/production-env-checklist.md` · `ARCHITECTURAL.md` · `docs/API.md` · `docs/BUSINESS_RULES.md` | Strip Discord references (fold into §13.7) |

**Completion gate** — must return zero. It excludes this PRD and `docs/archive/`, which legitimately record the removal:

```bash
grep -rIn -i "discord" --include="*.ts" --include="*.tsx" --include="*.yml" --include="*.md" src/ db/ tests/ infra/ scripts/ docs/ *.md | grep -v -E "FAVO_PRD_v5|docs/archive/"
```

Baseline at time of writing: **100 matches** across code, infra, scripts and docs — which is why §13.7 and this step are one piece of work. The concentrations: `src/server/discord/webhook.ts` (12), `infra/sentinel/alerts.yml` (9), `docs/ops-runbook.md` (9), `scripts/ship-ping.ts` (6). A further **~24 live in superseded documents** (`FAVO_PRD_v3/v4`, `FAVO_Phase2/4_Build_Plan`) and drop out of the gate automatically once §13.7 archives them — no editing required.

---

## 14 — Risks & Rollback

| ID | Risk | Likelihood | Impact | Mitigation | Rollback |
|---|---|---|---|---|---|
| R1 | **The live queue fails through the edge**, repeating the last failure | Med | **Critical** | §9.8 — explicit ≥ 4 h end-to-end test through Cloudflare before go-live. Not a local test. | Fall back to POS queue polling; the queue view degrades but the café runs. |
| R2 | DNS change affects HOFMI email | **Low** | **Critical** | §9.3 — mechanism resolved: Cloudflare for SaaS custom hostname on Transformate's zone, no zone migration, NS and MX untouched. `dig` check before and after, with MX/NS equality as the acceptance test. | Remove the `favo` CNAME. Apex, `www` and MX are never modified, so there is nothing to restore. |
| **R17** | **Untested offline persistence causes duplicate or lost orders** during a brief network blip | Med | Med | §8.4 — trim to outbox + idempotent retry (`outbox_log.client_uuid` UNIQUE), delete the unreachable conflict layer, and add one CI regression test on write/replay. | The idempotency constraint rejects duplicates at the DB; the audit log shows every replay attempt. |
| R3 | **Loyalty removal breaks unrelated code paths** — 76 files, shared with orders and the webhook | Med | High | Remove in the 13.2 sequence, suite green at every step. Enforcement greps as the completion gate. | Restore from the verified pre-removal backup. No partial rollback — which is why the backup is step 1. |
| R4 | A customer expects points they no longer have | Med | Low | No wind-down was chosen deliberately (§8.1). Remove the UI before the data so nobody sees a stale balance. | Counter explanation. Points are not reinstated. |
| R5 | **A free event charges people** — or a paid event doesn't | Low | **High** | Payment posture is an explicit switch snapshotted onto the window (L25), not inherited. The Discipleship 101 drill asserts zero Yoco calls (§05). | Refund is not available (L02) — so this is prevented, not recovered. The drill is the control. |
| R6 | **An event window is left open** and silently makes later orders free | Low | High | Mandatory `ends_at`, automatic close, 24-hour maximum (L27). | Admin closes the window; affected orders are identifiable by `event_window_id` and reconcilable. |
| **R16** | **Registered iPhone customers silently receive no notifications** because Web Push needs the PWA installed to the Home Screen | **High if unaddressed** | **High** | L29 — an install step in onboarding with explicit iOS instructions, and never showing a subscribed state the device cannot honour. | Customer collects at the counter, as an unregistered visitor does. The order is identified by the number on the cup. |
| R8 | Weekday cost numbers wrong because deduction still ignores modifications | **High if 13.3 slips** | High | AT-145 is a *known live bug*, not a new risk. Fix with the cup/lid change (§10.5). | Recompute historical COGS from `order_items.modifications` once deduction is correct. |
| R9 | Yoco outage during Sunday peak | Med | High | Health check every 60 s; deferred-payment mode after 3 consecutive failures. Weekday and free events are unaffected — no payment step. | Standalone Yoco card machine; reconcile within 24 h. |
| R10 | Push non-delivery | High | Low | The live queue board on the POS is the primary signal; push is secondary. | Customer asks at the counter. |
| R11 | Inventory deduction race on concurrent orders | Med | High | `SELECT … FOR UPDATE` inside the order transaction. | Daily reconciliation catches drift; alert above 1% variance. |
| R12 | Yoco webhook replay | Low | High | HMAC verification + idempotency on `yoco_payment_id`. | Rotate the secret in Infisical; redeploy; review the audit log. |
| R13 | COGS inaccurate because ingredient costs aren't seeded | High | Med | Seed best-estimate costs; dashboard warns until Admin confirms. | Admin updates lot costs at any time; COGS recalculates forward. |
| R14 | FAVO staff PIN compromise or sharing | Low | Med | Rotate PINs; anomaly detection on entitlement claims outside shift hours. | Revoke and re-PIN; review the audit trail. |
| **R15** | **The free-coffee entitlement cannot reach the ~63 office staff it exists for** — it is keyed to the `staff` table (§1.1, L03) | **Certain — this is current behaviour, not a risk of one** | **High** | Repoint to `customers` (§10.3.1) as part of 13.3. Until then, the weekday benefit either isn't being granted through the system or is being recorded against the wrong person, which also corrupts the weekday consumption counts feeding §7.3. | No rollback needed — the current state is the broken one. Historical rows move to an archival table rather than being reinterpreted. |

### Rollback strategies

- **Data.** Nightly encrypted off-site dumps with periodically tested restores (§9.4). The restore test is the deliverable, not the dump.
- **Schema.** Every Drizzle migration ships with a tested `down`. Staging runs `down` + `up` on every migration PR in CI.
- **Feature flags.** New capabilities ship behind a flag where practical. Removals do not — a half-removed loyalty system is worse than either state.
- **Catastrophic.** Static "We're back at the counter" page; paper for the day; restore overnight; reconcile the next morning.

---

## 15 — Acceptance Tests & Verification

### 15.1 Gates

| Area | Unit | E2E | Manual drill |
|---|---|---|---|
| Gate zero (hosting) | — | Prod smoke green against the new host | **≥ 4 h live-queue hold through the edge.** Backup restored and verified. `dig` shows MX and NS unchanged. Yoco webhook delivers. |
| Flow fix | Target binding rejects null | Ring up → walk away → Done → push arrives for a registered customer | Weekday drop-off drill: cup left on counter, barista makes it 4 min later, the registered customer is notified without anyone typing a name |
| **iOS install honesty** | — | A registered iPhone customer who has not installed the PWA is told notifications need the install, and is never shown a subscribed state | Real iPhone. The silent-failure case is the one that matters (L29, R16). |
| **No public order status** | Queue stream rejects unauthenticated callers | No customer-reachable route returns order or queue state | Attempt `GET /api/queue/stream` with no session — must be rejected (§8.6) |
| **Offline trim** | Outbox write/replay: no data loss, **no duplicate order on replay** | — | None. The CI test replaces the chaos drill (§8.4). |
| Favo layout | — | Menu grid remains hittable while the Favo row is shown | Barista confirms no screen requires dismissing anything to reach the menu |
| Removal | Suite green after each step of 13.2 | No loyalty, wallet or pack surface reachable | Both enforcement greps return zero |
| Modes & deduction | Mode defaulting; mode-, event- and modification-aware deduction | Opening-window step defaults, overrides in one tap, broadcasts | Weekday order deducts **no** cup or lid; Sunday order does |
| **Event mode** | Posture switches; 24 h cap; auto-close reverts mode and prices | Recurring Wednesday template defaults and confirms in one tap | **Discipleship 101 drill:** open, place orders, assert **zero Yoco calls and no card prompt**, assert cups **are** deducted, assert the window closes itself at 20:30 and Thursday defaults to Weekday |
| Walk-ins | Never charged, never counted against entitlement | POS walk-in flow | Weekly summary shows staff and walk-in as two counts |
| Cost management | Rollup arithmetic, per-mode split | Admin opens rollup; place a test order; figures move within 5 s | Admin confirms the rollup answers the funding question without assembly |

### 15.2 Protocol

1. **Pre-merge.** CI runs `bun typecheck`, `bun lint`, `bun test:unit`. All green, no exceptions.
2. **Merge.** Squash to `main` with the WI key in the commit message.
3. **Deploy.** Automatic on merge to `main` (§9.7).
4. **Post-deploy smoke.** Read-only paths only. No mutating tests against live data.
5. **Ship record.** Deploy SHA, URL, smoke result and audit-coverage result recorded on the WI. That record is the ship notification — there is no chat-channel ping (§8.5).

### 15.3 Live-op drills

`SC01`–`SC05` from `docs/HANDOVER_LOOSE_ENDS.md` still stand. **`SC08` (offline: zero orders lost) is retired** per §8.4 — replaced by a CI regression test on the outbox write/replay path, which catches the same failure on every PR instead of once in a drill.

---

## 16 — Decisions

### 16.1 Closed

| Decision | Resolution | Where |
|---|---|---|
| **Priority order** | **Ease (baristas + customers) first; cost management second.** Owner decision, 2026-08-12, reversing the v4 scope paper. | §03 |
| **Domain** | **`favo.hofmi.net`.** Nothing to register, nothing to buy. A `.co.za` remains a later branding option — the base URL is one config value. | §9.3 |
| **Cloudflare mechanism** | **Cloudflare for SaaS custom hostname on Transformate's zone.** Available on Free/Pro/Business (100 hostnames included); we need one. **No `hofmi.net` zone migration; NS stays at Xneelo; Google MX untouched.** The earlier Enterprise-only concern conflated this with onboarding our own zone in partial setup. | §9.3 |
| **Data residency** | **EU.** POPIA-compliant with the documented safeguards and existing privacy policy; no cost delta; app and DB co-located, which is the latency that matters. **Revisit trigger:** if POS interaction latency is judged annoying during the gate-zero drill, re-open with SA as the alternative. Not a blocker for go-live either way. | §9.4 |
| **Event mode design** | **Closed — §6.6 is a buildable spec.** Four switches, three activation paths, automatic close. No longer provisional. | §6.6 |
| **Free events** | **Supported and specified.** Payment posture is per-event; `free` creates no Yoco intent. Discipleship 101 (Wednesdays, free, disposables, church-member audience) is the reference case and the acceptance drill. | L25, §6.6 |
| **Discord** | **Removed entirely — deleted from the codebase, not left unconfigured.** All alerting consolidates on Web Push + the in-app admin dashboard. Owner decision, 2026-08-12. The L09 replacement must land before the deletion (§13.8). | §8.5, L09 |
| **Loyalty / wallet / packs** | **Removed, hard delete, no wind-down.** Owner decision, 2026-08-12. | §08 |
| **Offline mode** | **Trimmed, not kept wholesale and not deleted.** Outbox + idempotent retry stay and gain a CI regression test; the `sync_conflicts` reconciliation layer is deleted as unreachable on a one-tablet POS. `SC08` retired. Revised 2026-08-12 on Mia's correction — the original reasoning conflated power outages with network blips. | §8.4 |
| **Guest notifications & customer order status** | **Out of scope entirely.** Order-ready notifications are for registered customers only. No guest QR, no pairing token, and **no customer-facing order-status or queue view** — the live queue is a barista tool and is not exposed publicly. Owner decision, 2026-08-12: *"the POS queue page is completely out of scope."* | §8.6, L23 |
| **Saturday** | **No default mode — café treated as closed.** A Saturday social is an event. Surfaced by Mia's question about how mode is derived. | §4.2 |
| **Timeline** | **No fixed date.** Gate zero first, then priority order. | §13 |

### 16.2 Open

| Decision | Owner | Notes |
|---|---|---|
| **Commercial terms** | FAVO ↔ Transformate | Infrastructure cost fits comfortably **under R500/month**; the **management/service fee is a separate commercial agreement** and is not part of the infra figure. Not a technical blocker — gate zero can proceed on the agreed infra while terms are settled. |
| **Do baristas get the free weekday coffee?** | FAVO | Surfaced by §1.1. Baristas are *FAVO staff*, not *office staff*, so once the entitlement is repointed to `customers` (§10.3.1) they fall outside it. **Recommendation: one mechanism, no special case** — a barista who is also an office employee gets a customer record like everyone else and claims it that way. The alternative is a parallel FAVO-staff allowance, which reintroduces exactly the two-populations confusion this section removes. Cheap either way; decide before 13.3 builds it. |

---

## Appendix A — Glossary

| Term | Definition |
|---|---|
| **FAVO staff** | Baristas and the admin/owner — the people who run the café. PIN auth, `staff` table. ~3–5 people. Never called just "staff" (§1.1). |
| **Office staff** | HOFMI office employees. Customers with `status='office_staff'`. ~63 people. Get the free weekday coffee. **Not FAVO staff.** |
| **Church member** | Congregation. Customers with `status='church_member'`. |
| **The Favo** | A customer's saved usual — a menu item plus modifications, editable by them, one tap at the POS. Formerly "regular order". |
| **Notification target** | Who to tell when an order is ready. Bound at ring-up: a registered customer, or explicit none (L28). |
| **Walk-in** | A weekday non-staff visitor. Not charged, not counted against the staff entitlement, logged for consumption reporting. No identity captured. |
| **Mode** | Weekday, Sunday or Event. Defaulted from the date, confirmed by the barista in the opening-window step. |
| **Event profile / event window** | The reusable template, and a concrete occurrence of it. The window snapshots the profile's four switches so history doesn't change when the template is edited. |
| **Payment posture** | An event's payment behaviour: `free`, `standard`, or `override` (event prices). Independent of cup/lid consumption. |
| **Opening window** | The window for dropping cups off — *not* the time by which drinks are finished. |
| COGS | Cost of Goods Sold. Computed live from stock movements × ingredient cost. |
| Container model | Milk and beans tracked as physical bottles and bags (in cups), not ml and g. At most one open container per item. |
| PIN | 4–6 digit numeric staff login code, bcrypt-hashed at rest. |
| POS | Point of Sale — the tablet at the counter. One barista takes the order, makes the drink and taps Done. |
| POPIA | Protection of Personal Information Act (South Africa). |
| PWA | Progressive Web App. Installable to a home screen; here for installability and push, **not** for offline (§8.4). |
| RLS | Row-Level Security — per-row Postgres access policies, independent of the application. |
| SAST | South African Standard Time (UTC+2). All times in this document unless stated otherwise. |
| SSE | Server-Sent Events — the live POS queue transport, fed by Postgres `LISTEN/NOTIFY`. |
| VAPID | Key pair authenticating the push server to the browser push service. |
| Variance | Expected stock (recipe deductions) minus counted stock (stock takes), as a percentage. |
| Yoco | South African card gateway. PCI-DSS managed. FAVO holds no card data. |

---

## Appendix B — What changed from v4

For anyone holding `FAVO_PRD_v4.md` or the 2026-08-11 context-and-scope paper.

### Priorities inverted

| v4 | v5 |
|---|---|
| P1 cost management, P2 ease. *"Knowing exactly what this costs comes first."* | **P1 ease (baristas + customers), P2 cost management.** Owner decision, 2026-08-12. Delivery order follows (§13). |

### Removed features (all previously built and shipped)

| v4 | v5 |
|---|---|
| Loyalty: earn, multi-unit redemption, 12-month expiry, liability endpoint (L06) | **Removed entirely.** No wind-down. §8.1 |
| Wallet top-ups (L16) | **Removed.** Schema already clean; application code goes. §8.2 |
| Coffee packs, 90-day expiry (L16) | **Removed.** New in v5 — packs were in scope under v4. §8.3 |
| Offline mode as goal #8, success criterion and `SC08` gate | **Trimmed** — outbox + idempotent retry kept and CI-tested; conflict layer deleted; `SC08` retired. §8.4 |

### New requirements

Operating modes (§04) · **notification target bound at ring-up, and ring-up separated from making (L28, §6.1)** · **explicit non-goal: no guest notifications and no customer-facing order status (§8.6)**  · bounded Favo controls, never a full-screen takeover (§6.4) · walk-in tracking (§6.5) · **event mode with four independent switches, three activation paths and automatic close (§6.6)** · **free events (L25) with Discipleship 101 as the reference case** · barista rota and shift-start push (§6.3) · office-staff vs church-member audience targeting (L22) · **the three-way staff/office-staff/church-member vocabulary and the entitlement repointing it exposed (§1.1, §10.3.1)** · mode-driven cup/lid deduction (L24) · admin-configurable eligible free-item categories (T06) · ministry rollup with an event column (§7.2).

### Structural changes

| | v4 | v5 |
|---|---|---|
| Framing | 9 ranked goals | Two priorities, ease first (§03) |
| Event mode | "Borrows Sunday's behaviour wholesale", provisional | **Configured, not inherited. Buildable spec.** Sunday-inheritance discarded because a free midweek event matches neither Sunday nor Weekday (§4.3) |
| Hosting | Vercel serverless + Supabase pooled | **Always-on container + co-located Postgres, direct connection.** Serverless disqualified (§09) |
| Cloudflare | Zone migration assumed to be required | **Cloudflare for SaaS custom hostname — no zone migration** (§9.3) |
| Discord | The paging channel for daily-close failures (L09) and ship pings | **Removed entirely.** Code deleted; all alerting on Web Push + in-app admin (§8.5) |
| Secrets | Vercel env vars | Infisical (§9.7) |
| Scheduled jobs | Platform cron functions | Server-side timers (§9.6) |
| DB connections | Two strings — pooled 6543 + session 5432; `prepare: false` | **One direct connection**; `prepare: false` removed (§9.2) |
| Domain | `favo-web-app.vercel.app` / `favo.hofmi.org` | **`favo.hofmi.net`.** `hofmi.org` never existed (§9.3) |
| Launch | Firm deadline, 3 June 2026 | **No fixed date.** Gate zero, then priority order (§13) |
| Menu | 5 items + variants, 14 seeded | 5 items, final: Americano, Cappuccino, Mocha, Chai Latte, Hot Chocolate |
| Alt milk | Oat, almond, macadamia | **Macadamia only, free (R0)** |
| L01 | "No payment, no order" — unconditional | Payment required **where payment applies**; weekday and free events have no payment step |
| "Staff" | One word for two populations | **Three terms: FAVO staff / office staff / church member** (§1.1). `customers.status` value is `office_staff`, not `staff` |
| L03 entitlement | Keyed to `staff.id` — reachable by ~3 FAVO staff | **Keyed to `customers.id` with `status='office_staff'`** — reachable by the ~63 people it is for (§10.3.1, R15) |
| `applyStaffDiscount` | Takes a `staff.id` | **`applyFreeCoffee`**, takes a `customers.id` |
| Lids | Deducted per recipe, no variance handling | Same deduction, but an explicit **wider variance band (T08)** because declines are deliberately unmodelled (§7.4) |
| Guest notifications | Guest QR paired to push | **Out of scope entirely.** Notifications are for registered customers; no guest path, no customer-facing order status or queue view (§8.6, L23) |
| iOS Web Push | Not mentioned anywhere | **Stated as a constraint with an install requirement (L29) and a risk (R16)** |
| Offline | Goal #8, then "keep all 23 files" | **Trimmed:** outbox + idempotent retry + one CI test; conflict layer deleted (§8.4) |
| Saturday | Undefined | **No default mode; café closed unless an event** (§4.2) |
| Mode derivation | Unstated | **Day-of-week from the calendar date in SAST — never a counter** (L18, §4.2) |
| Naming | "regular order" | **The Favo** |
| Rule numbers | L01–L17 | L06 and L16 **retired and burned**; L18–L28 added |
| Open decisions | Six | **One** — commercial terms (§16) |

---

*FAVO Café — Product Requirements Document v5.0. Supersedes v4.0 and v3.0 in full. Hosting chapter contributed by Transformate, 2026-08-07.*
