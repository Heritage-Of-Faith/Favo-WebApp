---
title: "FAVO Café — Product Requirements Document"
version: "7.0"
date: 2026-09-18
status: "Authoritative. Build-ready, with one named gate (§6.8.2, gated in §15.1)."
supersedes: ["v6.0 (2026-09-07)", "v5.2 (2026-08-31)", "v5.1", "v5.0", "v4.0", "v4 context-and-scope paper"]
repository: "github.com/Heritage-Of-Faith/Favo-WebApp"
code_baseline: "main @ 9aefc2c"
source_artifact: "https://claude.ai/artifact/GUYdFx38DzHoRrUD8ruwkL"
normative_layer: "Appendix C — the requirements register (148 rows, REQ-001…REQ-177). Build from it."
precedence: >-
  Where this document and any other file in the repository disagree, this document wins and the other
  file is a bug. One exception (criterion C-3): where this document specifies an interaction with an
  external system, the artefact that system actually produces is dispositive as to feasibility.
  Within the document, §7.0 governs the arithmetic and §6.0's worked sequences govern the flows.
identifier_schemes:
  - "§ — section number, the reference scheme used throughout"
  - "L01–L48 — locked business rules (§12.1). L06 and L16 are retired and must not be reused."
  - "T01–T15 — admin-tunable values (§12.2)"
  - "S1–S9 — rules the worked sequences share (§6.0.1)"
  - "P1–P7 — card-tender rules (§6.8.1)"
  - "T1–T10 — worked sequences (§6.0) and, separately, T10 the reconciliation control (§12.2)"
  - "D1–D10 — UI requirements (§17.2)"
  - "R1–R25 — risk register (§14)"
  - "DEC-01…DEC-16 — dated owner decisions (§16.1)"
  - "DEF-A…DEF-G — defects found in v6.0 and fixed in v7.0 (§00)"
  - "COL-1…COL-31 — collisions between amendment pack A and v6.0, each resolved in place"
  - "OPEN-08, FACT-1, FACT-2, FEE-1 — what is still open (§16.2)"
---

<!-- Markdown rendering of the v7.0 PRD, generated from the published artifact. Content is unchanged. -->

# FAVO Café

**Product Requirements Document v7.0 — full replacement, superseding v6.0**

*FAVO Café · Product Requirements Document · **v7.0 — final** · 18 Sep 2026*

FAVO takes card payments from a website. The installed app is off the table, Phase 0 is gone, and the eleven items v5.2 left open are decided and recorded here. **v7.0 merges Amendment pack A in full** — shot pricing corrected, the Untracked hot drink voucher, the blessing fund, as many sessions a day as a day needs, and the group tab recorded as a non-goal. This document is authoritative and it is buildable — with one step in the payment chapter that has not yet been run against the real card machine, named in §6.8.2 and gated in §15.1.

## Contents

- [00 · Read this first — The decision ledger, and what is still outstanding](#00--read-this-first--the-decision-ledger-and-what-is-still-outstanding)
- [01 — Header and metadata](#01--header-and-metadata)
- [02 — Problem, and why now](#02--problem-and-why-now)
- [03 — Priorities](#03--priorities)
- [04 — Operating modes](#04--operating-modes)
- [05 — Success criteria](#05--success-criteria)
- [06 — Functionality · Priority 1](#06--functionality--priority-1)
- [07 — Cost management · Priority 2](#07--cost-management--priority-2)
- [08 — Non-goals](#08--non-goals)
- [09 — Hosting and infrastructure](#09--hosting-and-infrastructure)
- [10 — Data model](#10--data-model)
- [11 — API surface](#11--api-surface)
- [12 — Business rules](#12--business-rules)
- [13 — Delivery plan](#13--delivery-plan)
- [14 — Risks and rollback](#14--risks-and-rollback)
- [15 — Acceptance tests and verification](#15--acceptance-tests-and-verification)
- [16 — Decisions](#16--decisions)
- [17 — Design](#17--design)
- [Appendix A — Glossary](#appendix-a--glossary)
- [Appendix B — What changed from v6.0, what changed from v5.2, and what did not](#appendix-b--what-changed-from-v60-what-changed-from-v52-and-what-did-not)
- [Appendix C — The normative requirements register](#appendix-c--the-normative-requirements-register)
- [Appendix D — What this document is least confident about](#appendix-d--what-this-document-is-least-confident-about)

## 00 · Read this first — The decision ledger, and what is still outstanding

v5.2 was authoritative and *not* build-ready: it carried eleven open items, four of them the owner's, and a payment chapter resting on a premise that turned out to be false. All eleven are now closed or narrowed. One of them changes the shape of the build, and the rest are recorded below in the section that owns each.

> **The headline**
>
> **Yoco can drive the card machine from a website. FAVO stays a web app.** FAVO's server sends the amount to the Khumo over Yoco's `Web POS` API, the machine lights up, the customer taps, and FAVO reads the outcome back. No native wrapper, no SDK integration key on the device, no Apple Business Manager, no two-day App Review for a till hotfix — and no barista ringing every Sunday sale twice on two devices.
>
> **Phase 0 comes out of this document entirely**, and with it the double-entry flow, the 7–9 taps per Sunday sale, the human-attested *Amount matches* tap, the `receipt_suffix` join key, the day-grain reconciliation, the `tender_mode` cutover flag and the whole of v5.2's §9.10. §6.8 is rewritten around four calls.

| Item | Decision | State | Owns it |
| --- | --- | --- | --- |
| OPEN-12 · the POS↔reader seam | **Build the Web POS route. No installed app.** The SDK route is recorded as considered and rejected: its original reason no longer holds, and its one remaining advantage is unconfirmed and probably absent. §6.8 | [Closed] | Nikao |
| The SDK application | **Send it anyway, as insurance.** A free form with a multi-day turnaround, and the only fallback if the web route fails against the real machine. It is a one-line contingency, not step 0. §13.1 | [Closed] | Nikao |
| OPEN-11 · the card machine | **Khumo Print family** — large touchscreen, prints slips. Identified on sight, which settles the half that mattered: no Yoco Go, so no hardware purchase and no phone-pairing workaround. §6.8.2 | [Part closed] | Nikao → Yoco |
| OPEN-06 · ingredient costs | **Best-estimate costs now, real invoices later** — with a condition: a per-ingredient `cost_source` field, and any drink containing an estimated ingredient renders its margin *provisional* and never green. §7.0.1b | [Closed] | Nikao + build |
| OPEN-13 · ringing a quantity of two | **A stepper on the order line, never a second tap on the item.** This overrides v5.2's own default. §6.2.2 | [Closed] | Nikao |
| D.5 · the double shot | **A modifier on the drink, not a second item** — one extra tap, and a recipe-level multiplier on the coffee deduction, which is also the R8 fix. Weekday budget closes at **4 taps**. §6.2.3 | [Closed] | Nikao |
| OPEN-01 · POS responsiveness | **Instant for drinks; FAVO waits only for money.** The principle is the testable part; four figures are its budget. §05 | [Closed] | Nikao |
| OPEN-03 · rate limits | **Generous on accounts; the till never locks out.** A lockout during the Sunday rush is a worse outcome than the abuse it prevents. §9.5.3 | [Closed] | Nikao |
| OPEN-05 · the training bar | **Two criteria: a weekday shift solo, and a supervised Sunday.** A bar that never tests Sunday does not test the thing most likely to break. §05 | [Closed] | Nikao / FAVO Admin |
| OPEN-04 · alerting | **Alert on anything that could lose money or data, routed to whoever can fix it** — with de-duplication as a requirement, not a nicety. §9.6.3 | [Closed] | Nikao |
| OPEN-08 · Transformate terms | **Asked, not assumed.** Four questions are with Matt. The gate is the fourth — who is contractually on the hook if the server dies at 08:00 on a Sunday. §16.2 | [Open] | Nikao ↔ Matt |
| OPEN-02 · job schedules | Closed in v5.2 by the scheduled-job register and recorded as closed here. §9.6.2 | [Closed] | — |
| OPEN-10 · charge idempotency | **Narrowed, not closed.** Yoco documents no idempotency mechanism, so FAVO still never re-sends a payment; but the Web POS route echoes FAVO's own `client_reference` and is fetchable server-side, so recovery is a plain lookup rather than a device-side SDK call. §6.8.4 | [Narrowed] | Nikao → Yoco |

> **What v7.0 adds to v6.0 — amendment pack A, merged in full**
>
> **v6.0 closed eleven open items from documentation, a Yoco export and one grounded Sunday morning. Amendment pack A came from standing at the counter**, and it found four things the café actually does that v6.0 had no mechanism for — plus one it priced wrongly. All five are in the body of this document, and **every decision behind them is taken and dated 14 September 2026.**
>
> | Section | What it is | Decisions |
> | --- | --- | --- |
> | §6.2.3 · The shot count | **v6.0 priced the double shot wrongly.** One and two shots are both the listed price; R10 starts at the third. `shot` becomes a number picked from 1–4, T09 is redefined, and margin breaks out by shot count — *which is how the café finds out its best seller mostly sells in its worst-margin form* | DEC-16 · supersedes DEC-08 |
> | §6.2.4 · Where the controls live | The screen all five mechanisms share. **What the drink is and what is owed go on the line; who pays goes in the footer** — which is why the voucher attaches to a drink and the fund to an order. L48 keeps the panel from filling up | L48 · D10 |
> | §6.9 · The voucher | A one-tap R0 on one unit of one line, for a visitor holding an Untracked hot drink voucher. **The paper slip is surrendered and counted at the close — that count, not a serial number, is the control** | DEC-13 · L41–L43 |
> | §6.10 · The blessing fund | A named, non-refundable balance that pays for other people's coffee, opened at the counter and funded by a card payment **Yoco must confirm before a cent of it is drawable**. Names may be linked to it — *and that single fact is what makes it the answer to the group tab* | DEC-14 · DEC-15 · L44–L47 |
> | §6.11 · Sessions & Untracked Church | **Reverses v6.0's one-session-per-day narrowing.** A revenue day carries as many sessions as it needs, at most one open at a time — which answers the objection v6.0 gave for narrowing it. Untracked Church becomes a recurring event profile carrying a sixth switch: which voucher kinds are live | Owner, 14 Sep |
> | §8.11 · The group tab | **Recommended against, and adopted as a non-goal.** Settling many orders on one card tap needs a payment pointing at more than one order — the one schema change FAVO cannot afford. *A group fund does the same job with the cash moving one day earlier* | Nikao |
>
> **Both new mechanisms are one tap, and neither is a discount the barista invents.** A voucher is a paper slip the church issued and the café counts back; a fund draw is money already received and recorded. In both cases the barista's tap *spends something that already exists* — **which is why neither may be built on L33's comp path.** L33 is capped at two per barista per session precisely so a pattern of free drinks is visible; *twenty vouchers a Sunday flowing through that cap turns the cap into noise and gives every future comp somewhere to hide.*

> **Seven defects in v6.0, found on the way here, and fixed in this document**
>
> **Six were live in v6.0 and reachable with none of the new work built.** They are fixed here whether or not the voucher and the fund ship.
>
> - **DEF-A · A line could carry two discounts and be counted twice** — Nothing said at most one discount *mechanism* may apply to an order line. An L03 entitlement and an L33 comp on the same line both summed into `order_discount`, and the comp also into `comps_zar`. **Fixed by L41.**  *(Was live)*
>
> - **DEF-B · The comp ceiling ignored the discount already on the line** — L33's ceiling read `line_gross` — quantity × unit price — which knows nothing about an entitlement already applied, so a line could be discounted past its own value. **Fixed in L33.**  *(Was live)*
>
> - **DEF-C · An order worth R0 still went to the card machine** — A Sunday single-line order comped under L33 nets R0, and nothing stopped `beginTender` sending R0.00 to the Khumo. *Reachable in two taps.* **Fixed by L42.**  *(Was live)*
>
> - **DEF-E · Two of the same drink, made differently, could not be rung** — L37's "one line per menu item" collided with `shots` and `modifications` living at line level, and its repeat-tap rule left no path to create the second line. **Fixed in L37: one line per distinct configuration.**  *(Was live)*
>
> - **DEF-F · Customer search had no contract, and the push feature rests on it** — `searchCustomer` was reachable but §11 never said what it matched, how fast, or whether it blocked. When it fails a barista falls back to "no notification" — *and §05's 100% criterion still passes.* **Fixed by §6.9.4a.**  *(Was live)*
>
> - **DEF-G · A multi-shot drink could drain the bean bag mid-line** — L17 models one coffee as one cup from the open container, so a deduction never spanned two, and `line_cogs` costed the whole line at the first bag's rate. *A four-shot drink hits it four times as often as a double.* **Fixed in §10.5 and §7.0.2.**  *(Was live)*
>
> - **DEF-D · `net_settled` assumed all revenue is card revenue** — It would have claimed money Yoco never settles once a fund buys a coffee — *and under-claimed by every top-up taken that day once the correction was made.* **Fixed in §7.0.2.**  *(Bites with §6.10)*

### Five actions, and who holds each

- **Run the R1.00 Web POS test against the real Khumo** — The gate in §15.1. Everything in the payment chapter rests on it, and it is roughly one to two hours of one person's time.  *(Nikao + build)*

- **Email Yoco: device linking, Khumo Print 2 support, fee retrieval** — Closes the remainder of OPEN-11 and both unconfirmed facts below. Draft ready.  *(Nikao)*

- **Submit the Yoco SDK integration application** — Insurance only now, but it is the one item with an external clock, and it is free to send.  *(Nikao)*

- **Get Matt's answer on the Transformate terms** — Must land before §13.0 completes — gate zero commits FAVO to this infrastructure. The earlier note to Matt also needs correcting: it flags a future native iOS POS, which is no longer the plan.  *(Nikao ↔ Matt)*

- **Count the taps for a double shot on Yoco today** — Two minutes with one cappuccino. It validates the speed baseline the §05 budgets are compared against; it blocks nothing.  *(FAVO)*

### What must not be read as settled

> **Hold lightly**
>
> - **Nothing in §6.8 has been run against FAVO's actual card machine.** The Web POS endpoints are documented and the machine is in the supported family, but the chain has not been executed end to end. High confidence, not proof.
> - **Unconfirmed fact 1 — Yoco does not publish how a terminal is linked to a Web POS device.** Every other step in the chain is documented. This is the single genuine unknown in the payment chapter, and it is the reason the SDK application still goes in.
> - **Unconfirmed fact 2 — the supported-model list is third-party.** The list putting the Khumo Print family in scope comes from an integrator's help pages, not from Yoco. v5.2's own warning about third-party lists still applies; this document narrowed it and did not close it.
> - **The payment chapter is new text and has had no independent review.** v5.2 recorded that its final pass had no second reader and that the payment sections needed one most. A rewrite makes that more true, not less.
> - **The build-time figures in §13 are estimates, not quotes.** The gap between the two routes is wide enough that the decision holds either way, but "one to two weeks" is not a commitment.
> - **Ingredient costs are estimates by explicit choice.** The *provisional* label is what makes that safe. If the label is dropped during the build, the risk comes straight back.
> - **The traces in §6.0 still describe one Sunday morning in which nothing went wrong.** §6.8.4 now specifies the failure paths properly, and none of them has been observed.

> **How to read this document**
>
> §06 and §07 are the strongest chapters and are built from with confidence. **Every number in §07 still needs one independent recomputation** before anyone funds a decision on it. Appendix C is the normative requirements register — **148 rows** with IDs and testable Given/When/Then, **42 of them new in v7.0** — and **it is the layer to build from**. v5.2's running self-corrections ("*v5.2 said X*") have been moved out of the body into Appendix B, so the body states only what is true. Appendix D is the honest account of what this document is least sure of.

## 01 — Header and metadata

|   |   |
| --- | --- |
| Project | FAVO Café Web App |
| Project | FAVO Café Web App |
| Document | PRD v6.0 — full replacement. Supersedes v5.2 (2026-08-31), v5.1, v5.0, v4.0 and the v4 context-and-scope paper. All retired by this document. |
| Document | PRD v6.0 — full replacement. Supersedes v5.2 (2026-08-31), v5.1, v5.0, v4.0 and the v4 context-and-scope paper. All retired by this document. |
| Authored by | HOFMI Build Team · nikao@hofmi.net. Hosting chapter contributed by Transformate, 2026-08-07, adopted. |
| Authored by | HOFMI Build Team · nikao@hofmi.net. Hosting chapter contributed by Transformate, 2026-08-07, adopted. |
| Status | **Authoritative. Build-ready, with one named gate.** §6.8's device-link step (§6.8.2) must be proven against the real Khumo before the payment chapter is written on proof rather than on documentation. |
| Status | **Authoritative. Build-ready, with one named gate.** §6.8's device-link step (§6.8.2) must be proven against the real Khumo before the payment chapter is written on proof rather than on documentation. |
| Repository | `github.com/Heritage-Of-Faith/Favo-WebApp` (private). Technical chapters current as of `main @ 9aefc2c`. |
| Repository | `github.com/Heritage-Of-Faith/Favo-WebApp` (private). Technical chapters current as of `main @ 9aefc2c`. |
| Public URL | `favo.hofmi.net` — **not** `favo.hofmi.org`, which has never existed (§9.3) |
| Public URL | `favo.hofmi.net` — **not** `favo.hofmi.org`, which has never existed (§9.3) |
| Deploy target | Always-on container or VM on Transformate infrastructure |
| Deploy target | Always-on container or VM on Transformate infrastructure |
| Tenancy | Single-tenant within `hofmi`. One café. Multi-location is an explicit non-goal. |
| Tenancy | Single-tenant within `hofmi`. One café. Multi-location is an explicit non-goal. |
| Locale | English (UI) · ZAR, integer cents · `Africa/Johannesburg` (UTC+2) |
| Locale | English (UI) · ZAR, integer cents · `Africa/Johannesburg` (UTC+2) |
| Distribution | **One installable PWA, for every surface.** Customers install it for push; the POS runs it on the counter tablet; admin runs it in a desktop browser. POS and admin surfaces require FAVO staff PIN auth (§1.1). **There is no native application on any platform** (§8.9). |
| Distribution | **One installable PWA, for every surface.** Customers install it for push; the POS runs it on the counter tablet; admin runs it in a desktop browser. POS and admin surfaces require FAVO staff PIN auth (§1.1). **There is no native application on any platform** (§8.9). |
| Target launch | **No fixed date.** The app is offline today, so go-live is prioritised over scope. |
| Target launch | **No fixed date.** The app is offline today, so go-live is prioritised over scope. |
| Current state | Built through v4 Phases 1–4, ~900 unit tests green on `main`. Production is down (Vercel `402 — DEPLOYMENT_DISABLED`). This is a restoration, not a migration of something healthy. |
| Current state | Built through v4 Phases 1–4, ~900 unit tests green on `main`. Production is down (Vercel `402 — DEPLOYMENT_DISABLED`). This is a restoration, not a migration of something healthy. |

### 1.1 Who "staff" means — read this before anything else

The word *staff* was doing two incompatible jobs in v4 and in early v5 drafts. It refers to two populations who share almost nothing: different numbers, different auth, different relationship to the café. **This document uses the three terms below and never the bare word "staff" on its own.**

| Term | Who | Count | Auth | In the schema |
| --- | --- | --- | --- | --- |
| FAVO staff | Baristas and the admin/owner — the people who *run* the café | ~3–5 | **PIN** on the tablet | staff · role ∈ {barista, admin} |
| Office staff | HOFMI office employees — church staff, **not** FAVO staff. They buy and drink the coffee, and get the free weekday cup | ~63 | Email + password (optional) | customers · status = 'office_staff' |
| Church member | Congregation. Sunday customers | low hundreds | Email + password (optional) | customers · status = 'church_member' |

**Office staff and church members are customers.** They never touch the POS, never hold a PIN, and never appear in the `staff` table.

**A person may hold both records.** A barista who also wants the free weekday cup has a `staff` row to run the till *and* a `customers` row with `status='office_staff'` to drink the coffee. Two different facts about the same human, treated independently — one mechanism, no special case (DEC-11).

> **This ambiguity was hiding a live bug — §12.1 L03 and R15**
>
> The free-coffee entitlement is currently keyed to the `staff` table, so it can only be granted to one of the ~3 FAVO staff. The ~63 office staff it is actually *for* cannot receive it at all. Credit to Mia for the terminology catch that surfaced it.

## 02 — Problem, and why now

FAVO is a specialty coffee café operating inside the HOFMI office on weekdays and serving the congregation around the Sunday service. It is run by three baristas — Louis, Thandeka and Nkuli — for roughly 63 weekday office staff plus the Sunday congregation.

**The daily problem is friction.** Order-ready messages go out over WhatsApp, which means either the whole staff group gets pinged for one person's coffee or the barista messages people one at a time, losing seconds on every cup. Someone's "usual" lives on a card written out again for every order. On a Sunday, 45 orders arrive in 100 minutes and a paper queue cannot hold them cleanly. Every one of these costs the barista time at exactly the moment they have none.

**Underneath sits the reporting problem: nobody knows the true cost of a cappuccino.** Beans get rotated, milk gets thrown when it foams badly, cups get dropped, staff drink their free coffee and nobody counts it. COGS moves month to month with no narrative.

**And the immediate problem is blunter than either: there is no working production environment.** The Vercel deployment is disabled and the domain in the docs was never registered.

> **Mission frame**
>
> FAVO is not run to maximise profit. Weekday coffee is free for staff by design, and Sunday only needs to *not lose money*. What matters first is that the thing is effortless — for the three people making the coffee and for everyone drinking it. Close behind: knowing exactly what it costs, with nobody guessing.

## 03 — Priorities

In order. Everything in this document serves one of these two. Where they conflict, Priority 1 wins.

### Priority 1 — Ease: baristas and customers

Order-ready notifications; a POS fast enough to hold the ring-up budgets of §05 and the responsiveness principle now settled there; barista scheduling with opening-hours broadcasts; and simple self-service registration. **The goal is a system that gets out of the way** — not one with more features than anyone asked for.

The test is behavioural, not aesthetic: does a barista mid-rush, with wet hands, get from a person at the counter to an order in the queue without thinking about the software? Does a customer get told their coffee is ready without anyone typing their name?

> **The contradiction v5.2 flagged is gone**
>
> v5.2 had to record that its own payment plan made the busiest flow in the café *harder* — Phase 0 rang every Sunday sale twice, ≈7–9 taps against ~3–4 today — and that this fought Priority 1 directly. **Nothing in this plan now makes the Sunday rush harder than it is today.** The web route lands at 3–4 taps a sale from the first day it ships, and the section v5.2 marked "worth flagging" no longer applies.

### Priority 2 — Cost management

Live visibility into COGS, expenses and margin, with no CSV download and no spreadsheet maths. A single rollup showing the ministry what FAVO actually costs to run, and a Sunday P&L that never quietly slips into a loss.

The canonical statement, from FAVO Admin: *"the ability to easily see the movement of COGS and if we are making profit or not, without having to download a CSV and make the calculations myself."*

**Corollary, and it is load-bearing:** a feature serving neither priority is not a feature, it is a liability. That is the reasoning that removes loyalty and packs in §08 — **and it removed the customer stored-value wallet on the same grounds**, which is why §8.2 remains a standing prohibition rather than a deleted paragraph.

**§6.10's blessing fund passes the test the wallet failed, and that is why DEC-14 narrowed §8.2 rather than deleting it.** It serves *both* priorities — one tap instead of a card interaction for the recipient (P1), and money and COGS that are invisible today become counted (P2). The corollary keeps its teeth: what stays banned is a self-service, universal, refundable customer balance (§6.10.1).

> **Note on the reversal**
>
> The v4 scope paper ranked these the other way round and said so: *"knowing exactly what this costs comes first."* v5 reversed it on the owner's decision (2026-08-12). The ministry rollup — the number the funders care about — therefore ships after the functionality work, and that is the trade being made. The delivery order barely moves either way: cost management's weekday figures depend on mode confirmation and the walk-in log to be correct at all.

## 04 — Operating modes

FAVO runs under three modes. Mode **defaults from the date** and is confirmed by the on-duty barista as part of setting the day's opening window (§6.3) — never as a separate step. A normal day needs no extra action; overriding for an event, a cancelled service or a holiday is one tap in the same place.

|   | Weekday (Mon–Fri) | Sunday | Event / Social |
| --- | --- | --- | --- |
| Who it serves | ~63 office staff | Office staff + congregation | Attendees, often unregistered |
| Menu | Coffee-category items only, single or double shot | Full menu — every active item | Per event profile |
| Payment | Free for office staff, 1/day. **No card step at all.** | Everyone pays by card | **Per event profile** — free, standard-priced, or event-priced |
| Milk | Normal milk provided. Macadamia is bring-your-own. | Macadamia stocked | Follows Sunday stock unless noted |
| Cups | Own mugs — **no cup/lid cost** | Disposable cup + lid (§7.4) | Per event profile |
| Non-staff visitors | Logged as a **walk-in** — not charged, tracked for cost | n/a — a standard paying customer | Per event profile |
| Extra-shot surcharge | None — nobody pays. **Shots capped at 2** (T15) | **R10 per shot beyond the second** (T09). One and two shots are both the listed price | Per event profile — charged only if the profile says so |
| Broadcast audience | Office staff only | Office staff + church members | Per event profile |
| Financial goal | No profit expected — track stock, manage cost | Don't run a loss. Don't overcharge either. | Set per event; still tracked for cost |

### 4.1 Two clarifications, because the table reads more expansively than reality

- **"Full menu" on Sunday is five items.** The live menu is Americano, Cappuccino, Mocha, Chai Latte, Hot Chocolate (locked 2026-07-05, Jira AT-136). Sunday does not unlock a larger catalogue — it unlocks the *non-coffee* items among those five, plus payment. Weekday is the coffee-category subset of the same list.
- **Macadamia is the only alternative milk.** Free to the customer (R0), not a paid upcharge, and the only alt milk FAVO stocks. Oat and almond were dropped by the same decision. Where a table says "alt milks", read "macadamia".

### 4.2 How the app knows what day it is

**It reads the calendar date's day-of-week in `Africa/Johannesburg`.** Nothing else — no rolling counter, no "five days then switch", no schedule that advances and could drift out of step. The date is the input; the mode is derived from it fresh, every day.

| Day-of-week | Default mode |
| --- | --- |
| Monday–Friday | **Weekday** |
| Sunday | **Sunday** |
| Saturday | **No default — the café is closed unless an event says otherwise** |
| Any **session** whose window overlaps an event window | **Event** — overrides the above (§6.6 precedence). **A session's default is computed against that session's own window**, never against the day and never against `now` — so a Sunday morning does not inherit the evening's event, and an evening session opened at 17:45 for an 18:00 service still finds it (§6.11.1) |

> **Saturday, and why there is no Saturday value in the enum**
>
> The mode table says Weekday means Mon–Fri and Sunday means Sunday, which leaves Saturday with no mode at all. It is explicit: **Saturday has no default mode and the café is treated as closed.** A Saturday social is an *event*, and **a session cannot be opened on a Saturday at all unless an event window is in force** — created in advance or started there and then. The opening-window step offers *Start an event*, not a mode picker. There is deliberately no Saturday-shaped enum value because every available value would be wrong: `weekday` would grant free coffee and skip cups, `sunday` would charge. This keeps L03 coherent — the free-coffee entitlement is weekdays only, so a Saturday can never silently behave like a weekday (DEC-04). Surfaced by Mia's question about how mode is derived.

### 4.3 Event mode is configured, not inherited

v4's direction paper proposed that Event mode "borrows Sunday's behaviour wholesale". **That model is wrong and v5 discarded it**, for a concrete reason: *Discipleship 101 runs on Wednesday nights and nobody pays.* A free evening event that uses disposable cups matches neither Sunday (paid, disposables) nor Weekday (free, own mugs). Inheriting either one produces wrong money or wrong stock. Event mode therefore carries **its own six switches**, set per event and independent of one another (§6.6).

## 05 — Success criteria

Ordered by priority: ease first, cost second, platform last. Three of the rows below are new in v6.0 and carry the decisions that closed OPEN-01 and OPEN-05; the Sunday ring-up row is materially simpler than v5.2's, because there is only one tender flow to measure now.

### 5.1 Responsiveness — the principle, then the budget [OPEN-01 closed]

> **The principle, which is the testable part**
>
> **The barista is never blocked on the network, except while a card payment is actually going through.** Adding a drink is a local action that appears immediately and syncs behind the scenes. Payment is the one place FAVO stops and waits, because it is the one place it must know the truth before it says "paid" — **showing an unsaved cappuccino is recoverable; marking an uncleared card as paid is not.**

| Budget | Target | How verified |
| --- | --- | --- |
| Visual response to any tap | **< 100 ms** | Never network-dependent. Measured on the real tablet through the edge. |
| Adding an item to an order | **Zero network wait** | The line appears locally and syncs behind it. Assert no request blocks the render. |
| Sending an order (commit) | **< 1.5 s at p95** | Optimistic commit; the round trip measured on café wifi across a Sunday window. |
| Cold load on a Sunday morning | **< 5 s** | Real device, cleared cache, through Cloudflare. |
| Degraded network | Usable at **3G-grade speeds** | Throttled drill on the ordering path. Nothing on that path may become unusable. |
| The payment wait | **Visible progress state and a defined ceiling** | §6.8.4 sets the ceiling at **180 s** from the moment the machine is handed the amount, with a progress state the barista can read from arm's length. Beyond it the payment becomes `unresolved` and is resolved by lookup — never by sending again. |

**The 300 ms figure v5.2 carried is retired.** It was an undecided placeholder with a note that it had to survive a measurement against ~160 ms per app↔DB round trip. The principle above replaces it, and the <100 ms visual-response figure is achievable regardless of region *because it is explicitly not network-dependent* — which is the whole point of stating the principle before the numbers. Region remains a gate-zero measurement (§13.0) and its revisit trigger is now the 1.5 s commit figure, not a tap figure.

### 5.2 Priority 1 — ease

| Criterion | Target | How verified |
| --- | --- | --- |
| Order-ready push | ≤ 10 s from "Done" | E2E on a real device against staging, through the edge. |
| Notification target bound at ring-up | 100% of orders | Every order has a target — a registered customer or explicit none — recorded at creation, before the drink is made (§6.1). Query: orders with a null target must return zero. |
| No customer-facing order status | Zero reachable surfaces | No route, page or endpoint exposes order or queue state to an unauthenticated caller. `GET /api/queue/stream` rejects a request without a barista session (§8.6, L23). |
| iOS push honesty | No silent failures | On an iPhone that has not installed the PWA, the app states that notifications need the install — it never shows a subscribed state it cannot honour (L29). |
| Favo one-tap repeat | ≤ 2 taps from matched customer to order placed | Manual drill at the POS. |
| Ring-up budget — Sunday, unregistered | **≤ 4 taps and ≤ 10 s** from *new order* to *in queue*, no typing | **Four taps:** item (1) · `shots · 2` on the segmented picker (2, §6.2.3c) · target `none` (3, L28 forbids defaulting into it) · Place (4). **A triple or a quad is still four taps**, because the picker reaches any value in one. **The tender costs no tap** — FAVO pushes the amount to the machine and the customer taps it, so there is no amount to read, key or confirm. Timed drill on the real tablet. ⚠ Re-time this drill after the R1.00 test: if the Web POS confirm step turns out to require a merchant tap in FAVO's own browser (§6.8.2), the budget becomes 5 and this row is amended by the measurement rather than by an argument. |
| Ring-up budget — weekday, known office staff | **≤ 3 taps** single shot · **≤ 4 taps** double | Including the free cup, no typing, **met via the recents grid of §6.2.1** and not by search. The double is 4 because the shot must be recorded or ~45% of bean cost goes missing. **D.5 is closed at 4** — the document is not held open waiting for an observation nobody has made yet (§6.2.3). Timed drill against the 08:05–08:23 sequence of 2026-08-16, run twice: once single-shot, once double. |
| Quantity of two | ≤ 1 extra tap | Stepper on the order line (§6.2.2). Assert that tapping an already-added drink **does not** change the quantity. |
| Ring-up budget — Sunday voucher order [new in v7.0] | **≤ 4 taps** single shot · **≤ 5 taps** double | A new row rather than an amendment to the Sunday budget above, **because a budget that absorbs every new tap is not a budget** (§6.9.3). Timed drill on the real tablet against the same 08:05–09:16 sequence. |
| Ring-up budget — fund draw [new in v7.0] | **≤ 4 taps** with one active fund · **≤ 3 taps** for an auto-applied linked name | Timed drill. The linked-name figure is lower because L28's target tap is already spent and the fund keys off it (§6.10.6). |
| Make cycle | `in_progress` + Done ≤ 2 taps | Reachable from the queue with no navigation. Manual drill. |
| Discretionary write-downs are attributable and bounded | 100% | **Five discretionary acts, not three.** Every comp, deferred write-off, abandoned order, **voucher redemption and fund draw** carries `audit_log.actor_staff_id`, and a per-barista weekly figure for each appears on §7.3.1's summary — **vouchers as a count *and* a value** (§6.9.2a). A voucher redemption and a fund draw both move goods without taking money, by a named barista, which is exactly what this criterion exists to make attributable. **Drill:** one barista comps 5 of 14 orders, defers-and-writes-off 3, abandons 2, **redeems 4 vouchers and draws 2 fund orders**. Assert at least one Admin push the same day, and **five** named per-barista figures in that week's summary. |
| Favo controls stay bounded | Never a full-screen takeover | The menu grid is visible and tappable at all times; the Favo row occupies no more than a quarter of the order panel (§6.4). |
| Sunday peak throughput | 45 orders in 100 min (07:50–09:30) | Load test against staging (queue board stays stable) **and a timed human drill**: one barista rings up *and makes* 45 orders in 100 minutes on the real tablet using §6.0's sequences, with the ring-up budgets above met at p95. **Measured per window, not per day** — T03 holds a *list* of windows, and the pass condition applies to each, so the Untracked Church evening is measured rather than excluded (COL-22). ⚠ **The 45-in-100 figure has no recorded source** and it sizes §9.9's infrastructure, T03's windows and two criteria here — it needs provenance or re-derivation. |
| Order-to-cup — weekday | p50 ≤ 5 min | `placed_at` → `orders.completed_at`, which is set when the barista taps **Done** (`state='ready'`) — **not** when the `collected` sweep runs. |
| Order-to-cup — Sunday peak | p95 ≤ 10 min | Same query, **measured per T03 window** — the morning service and the Untracked Church evening each pass on their own figures. *A slow evening service passing because it was averaged into a fast morning is the failure COL-22 names.* |
| Opening broadcast audience | Correct without anyone choosing | Weekday reaches office staff only; Sunday reaches office staff + church members; event reaches its profile's audience. Computed, never hand-picked. |
| Free event runs with no payment step | Zero Yoco calls | Discipleship 101 drill: open the event, place orders, assert **no payment is ever sent to the machine** and no card prompt appears (§6.6, §6.8). |
| Event closes itself | Automatic | At the window's end time, mode reverts to the date default and price overrides expire. No event leaks into the next day. |

### 5.3 Barista onboarding — the training bar [OPEN-05 closed]

> **Two criteria, both tested once with a real person before go-live**
>
> 1. **Weekday solo.** A barista new to the system completes a full weekday shift unaided after one 20-minute walkthrough.
> 2. **Sunday supervised.** The same barista takes **ten consecutive paid Sunday orders** with a second person present but not intervening.
>
> The first criterion alone was the suggested bar, and it only covers the easy shift. Weekdays are free coffee with no payment step. Sunday is paid, busy, and involves the card machine — **a bar that never tests Sunday does not test the thing most likely to break.**

### 5.4 Priority 2 — cost

| Criterion | Target | How verified |
| --- | --- | --- |
| Live COGS dashboard | Real time, no manual step | Admin opens the dashboard: day revenue, running COGS, expenses, margin and profit flag present and current. Place a test order; COGS increments within 5 s. |
| Ministry rollup | One view, no assembly | Weekday cost + Sunday revenue and cost + event cost, netted, over a selectable week or month. No CSV, no spreadsheet. |
| Weekly ops summary | Delivered automatically | Push + in-app screen to the three baristas and the Admin role, split by mode, every week without anyone triggering it. |
| Walk-in visibility | Every walk-in counted | Weekday summary shows staff coffees and walk-in coffees as two separate counts. |
| Weekday cup/lid exclusion | Zero cup/lid deduction on weekday orders | Place a weekday order; assert `stock_movements` contains no cup or lid row. Place the same order in Sunday mode; assert it does. |
| Margin honesty | **Never green on an estimate** | Any drink containing an ingredient whose `cost_source = 'estimate'` renders its margin as *provisional*. Assert the flag reads `provisional` on the seeded database and turns green only after every contributing ingredient is invoice-backed (§7.0.1b). |
| Weekly inventory variance | < 5% by week 2 | SQL view `v_weekly_variance`, honouring the T08 lid band. |
| Audit coverage | 100% | `GET /api/admin/audit-coverage` returns 0 orphans. |
| Staff entitlement | **Max 1 free CUP per office staff member per weekday** | **Two queries, because one row is not one cup.** (a) rows: `SELECT customer_id, day FROM staff_entitlement_log GROUP BY 1,2 HAVING COUNT(*) > 1` returns empty. (b) cups: `SELECT l.id FROM staff_entitlement_log l JOIN order_items oi ON oi.order_id = l.order_id WHERE oi.discount_zar > oi.unit_price_zar` returns empty — no entitlement ever discounted more than one unit's price. |
| Monthly P&L sign-off | 100% signed before close | `monthly_reports.status='closed'` requires `admin_sig`. DB CHECK. |

### 5.5 Platform

| Criterion | Target | How verified |
| --- | --- | --- |
| Live queue survives a full shift | Connection held ≥ 4 h through the edge | §9.8. This is the constraint that broke the last host — a go-live gate, not a nice-to-have. |
| Card machine reachable | Alert within **2 minutes** of it going unreachable during trading hours | New in v6.0, and it exists because of the web route (§9.6.3). Drill: take the Khumo off the wifi mid-window and assert the barista's own device is alerted, not only Nikao. |
| Backup restores | Verified before go-live | §13.0. A backup that has never been restored is not a backup. |

**Retired from v4:** the loyalty accrual criterion (feature removed) and the offline-drill criterion (demoted — §8.4).

## 06 — Functionality · Priority 1

### 6.0 The eight worked sequences

> **This section is the sequence of record**
>
> Until v5.1 this document gave 34 rules (§12), an action catalogue (§11), a screen list (§17.4) and a column list (§10) — and nothing that bound them into an order of operations. For no seam did it state *step → screen → action → rows written → external call → failure branch → what the human sees*. **Where §11 or §12 disagrees with a sequence here, the sequence governs** and the disagreement is a defect to be reconciled by amendment.
>
> **T2 is rewritten in v6.0** and is now a single flow. v5.2 had to walk two, because both tender modes were in force at once.

#### 6.0.1 — Rules the sequences share

**S1 — Error codes are a closed set.** §11.5's `{ ok: false, code, message }` enumerates exactly these, and they are the only values a client may branch on.

| Code | Meaning | What the barista sees |
| --- | --- | --- |
| AUTH_REQUIRED | No valid PIN session | Return to the PIN pad |
| FORBIDDEN | Role lacks the action | The control is not shown; if reached, "Needs an admin" |
| STALE_STATE | The row moved under you (`SELECT … FOR UPDATE` loser) | "This order just changed — reloading", and the queue refreshes |
| NO_SESSION | No `opening_sessions` row for today | The opening-window step, blocking |
| MODE_FORBIDDEN | Action not permitted in the current mode | A named reason — e.g. "Saturday needs an event" |
| ENTITLEMENT_USED | `UNIQUE(customer_id, day)` violated | "Free cup already claimed today" — the order continues as paid |
| NOT_ELIGIBLE | `applyFreeCoffee` on a church member, a FAVO-staff id, or an ineligible category | "Not eligible for the free cup" — the order continues as normal |
| STOCK_EXHAUSTED | No open container and none openable, **at ring-up** | "Out of beans — tell the admin". The order is **blocked before payment** (S8) |
| STOCK_EXHAUSTED_AT_MAKE | Deduction failed at `in_progress` — **the order is already paid** (S8b) | "Out of beans — this order is paid and cannot be made. Get an admin." Admin pushed immediately |
| TERMINAL_UNREACHABLE | **New in v6.0.** No Web POS device is linked, or Yoco reports the device offline or unresponsive. This is the code the card machine's own failures now land on | "Card machine not responding — check it's on and on the wifi, or switch to deferred", with `setDeferredMode` one tap away. **Never a silent retry** |
| GATEWAY_UNAVAILABLE | **New in v6.0.** Yoco's API itself is unreachable and returned an error *without* a payment id, so **no payment resource was created and nothing was sent to the machine** | "Couldn't reach the card system — try again." This is the one payment failure where sending again is safe, and §6.8.4 says why |
| PAYMENT_DECLINED | Yoco reports the payment `failed` — a declined card, or a customer who walked away and let the terminal cancel | "Card declined — try again or use another card." The order **stays** in `ordered` (S3) |
| PAYMENT_UNKNOWN | No determinate answer inside the ceiling of S2, or a send whose outcome cannot be established | A small *unresolved* marker. **The drink is made and the queue moves on** (S4) |
| ALREADY_RESOLVED | The order is already settled or written off | **"Already paid — do not charge again"**, naming the settling barista and the time |
| TENDER_IN_PROGRESS | Something tried to change an order's total while a tender attempt was open | "This order is at the card machine — finish or cancel the payment first" (P4) |
| OFFLINE_UNAVAILABLE | Action requires a connection (§8.4) | A named reason; the control is disabled, never silently inert |
| REPLAY_TOO_OLD | An offline order older than 12 h at replay | Not shown to the barista; surfaced on the admin exception list |
| COMP_LIMIT | L33's per-order or per-session comp ceiling reached | "Comp limit reached — needs an admin" |
| VOUCHER_NOT_IN_MODE | **New in v7.0.** The voucher kind is not active for this session (§6.9) | The chip is not rendered (L48). If reached, "No vouchers on today" |
| FUND_INSUFFICIENT | **New in v7.0.** The fund's balance is below the order's net charge | The tile shows the balance and is not tappable — **never a refusal after the tap** |
| FUND_NOT_LINKED | **New in v7.0.** A draw against a fund with linked names, for someone not on the list. *A distinct code because `NOT_ELIGIBLE` already means the free weekday cup* (COL-3) | "This fund is for a set group — they're not on it" |
| FUND_UNAVAILABLE | **New in v7.0.** No active fund, the order has no net charge, or the fund is dormant | A named reason. The control is disabled, never silently inert |
| VALIDATION | Malformed input | A field-level message |

> **What left the set, and why**
>
> `READER_UNAVAILABLE` is renamed `TERMINAL_UNREACHABLE` because the failure changed shape: it was a Bluetooth pairing fault between an iPhone and a reader, and it is now a machine that is off, asleep or off the wifi. **Every iOS SDK result code is gone from this document** — the `.bluetoothDisabled` / `.cardMachineError` / `.invalidToken` / `.printFailed` / `.unknownResult` enum, the Android integer codes that shadowed it, and the four rounds of corrections between them. FAVO branches on the three statuses Yoco's Web POS payment resource actually reports — `pending · successful · failed` — plus its own two reachability codes. **FAVO does not invent a fourth status.**

**S2 — Timeouts are numbers.** Any server action from the POS: **10 s**. The send call to Yoco: **10 s**. The status fetch: **5 s**, retried at most **twice**. The poll loop while a payment is at the machine: every **2 s** for the first 30 s, then every **5 s**, to a ceiling of **180 s** from the send. On any expiry the client receives `PAYMENT_UNKNOWN` (payments) or `STALE_STATE` (everything else), and never a silent hang.

> **The 180-second ceiling is FAVO's, and it is not a cancel**
>
> A cardholder may take thirty seconds to find their card, and **FAVO must not impose a deadline on a customer standing at a terminal.** 180 s is chosen as longer than any realistic tap and shorter than a barista standing still, and OPEN-01 requires the wait to have a visible progress state and a defined end — this is that end.
>
> **Reaching the ceiling stops FAVO waiting; it does not stop the machine.** Yoco documents no way to cancel a Web POS payment in flight, so FAVO does not claim one. At the ceiling the payment becomes `unresolved`, the order enters the queue, the drink is made, and the money is resolved by the lookup of S4. A ceiling that pretended to cancel would be the most dangerous sentence in this chapter.

**S3 — A declined card pauses an order; it does not destroy one.** *This amends L01.* L01 originally said a failed payment cancels the order — which at 08:10 destroys an order that already holds a queue position and a bound notification target, forcing a re-ring from customer search. Instead the order **stays in `ordered`**, no stock is deducted, and tender is re-attemptable from the same screen. L01's guarantee is preserved in the form that matters — *an order is never completed without a successful payment record* — and the order is swept by `closeDaily()` if it is still unpaid at the close (S3a).

**S2a — Entering deferred mode alerts the Admin, and staying in it keeps alerting.** Entry fires an **immediate push to the Admin role naming the barista, the session and the reason**, repeating every **30 minutes** it remains on. Written-off value crossing `config.writeoff_alert_zar` (default **R100**), or **3 written-off orders in one session**, raises the L09 admin push **independently of stock reconciliation**.

> **Why, in the words of the attack it stops**
>
> Manual deferred mode was a clean channel that **both** reconciliations pass. Take orders deferred, collect by any off-book means, never settle, let the close write them off: T10 nets to zero on both sides because a written-off order contributes nothing to either, and L09's variance is zero because stock deducts normally and the drinks were really made. There was no alert on entry, no cap on how long the mode could stay on, and no threshold on write-off volume. The three controls above are the only things in this document that make the channel visible.

**S3a — What the close does with an unpaid order.** `closeDaily()`'s settle-or-write-off step (§6.0.5) sweeps **every order with no successful payment record and a non-zero amount owed** — `yoco_deferred`, and any `yoco` order whose payment never succeeded. **Never a `free` order**: a weekday entitlement cup, a walk-in and a free-posture event order have no payment record *by design* (L19), and sweeping them would book ~63 × R20 ≈ **R1,260 of phantom loss every weekday** straight into `contribution`. A declined-and-never-retendered order and an S4 order whose outcome was never resolved are both written off, **with a reason distinguishing them**. `GET /api/admin/unpaid-orders` is likewise defined over *unpaid*, not over `yoco_deferred`.

**S4 — An unresolved outcome proceeds, and is resolved by asking Yoco — never by sending again.** If the card flow ends without a determinate result, the order **enters the queue immediately** and the drink is made. *Fail closed on the money, fail open on the coffee.* `payments.status` becomes `unresolved` and the recovery is a **server-side fetch, not a re-send**:

1. **Fetch the payment's own status resource by id** — the id Yoco returned when FAVO sent the amount, persisted before the send. 5 s, at most two retries (S2). Runs immediately, again after 60 s, and thereafter with the unconfirmed-payment job (§9.6.2 job 4).
2. **Read the status and act on exactly what it says.** `successful` → attach it: `payments.status='successful'`, `yoco_payment_id`, `charged_amount_zar`. Done. `pending` → the customer is probably still at the machine, or has just walked away. Leave it `unresolved` and fetch again. `failed` → the money was not taken; a second send becomes possible under step 3. **A fetch error is not a status** and never resolves anything.
3. **A second send needs two independent negatives, and never immediately.** It is authorised only when all three hold: (a) the status resource read `failed` — not an error, not `pending`, not an empty response; (b) **two consecutive fetches at least 60 s apart both read `failed`**; and (c) at least **120 s** have elapsed since the send, because a payment still in flight is legitimately not yet successful. Anything else leaves the payment `unresolved` and the order unpaid.
4. **Two successful payments against one order means a double charge has already happened.** The payment attaches at the first, the order is flagged `duplicate_charge` to T10 **immediately, not at the close**, and the Admin is pushed with both Yoco payment ids and the amount. Under L02 the only remedy is an L33 comp and it needs a person today, not at month-end.
5. **Still unresolved at the close** → written off under S3a with the reason `unresolved_at_close`, and **reported to T10 for reconciliation against Yoco's record**, never silently absorbed — the terminal may well have taken the money.

> **This is materially safer than the route v5.2 specified, and the reason is worth stating**
>
> Under the SDK route, recovery ran through `getIntegratorTransactions(receiptNumber:)`, whose callback **carried no result code at all** and returned null for *"no transactions found **or** lookup fails"* — indistinguishably. A flat network at the counter read identically to *never charged*. That ambiguity is what forced v5.2's four-condition test, and it was the most dangerous defect either review run found.
>
> **The Web POS route does not have it.** Each payment is a server-side resource with an explicit `status` of `pending`, `successful` or `failed`, fetched by id over TLS from FAVO's own server. A network failure is an HTTP error, not a null that could mean either thing. **FAVO no longer needs idempotency on the send, because it can ask what happened.** OPEN-10 stays open — Yoco still documents no idempotency mechanism, so FAVO still never sends twice on one negative — but it is no longer load-bearing.

**S4a — `unresolved` is loud, and it is loud immediately.** The Admin is pushed **the moment a payment enters `unresolved`**, naming the order's `daily_seq`, the amount, the barista and the session — not at 00:05, and not only if it is still unresolved at the close. **A write-off at 00:05 is not the first notice; it is the last.** The push names one action: *"Ask the customer whether their card was charged before they leave — the slip from the machine settles it."* **Two unresolved payments in one session escalate** to S2a's channel, because two is the signature of a failing machine rather than one unlucky transaction.

**S5 — The queue survives disconnection.** The queue view renders from local state while offline: orders already loaded stay visible, orders created offline appear immediately marked *not yet synced*, and `in_progress`/Done are disabled with a visible reason. **An empty work list during a disconnection is a defect, not an offline state.** The drinks are made from the list regardless.

**S6 — SSE reconnect and catch-up.** `GET /api/queue/stream` sends a monotonic `id:` on every event. The client reconnects with `Last-Event-ID` and exponential backoff (1 s, 2 s, 4 s, capped at 15 s). On reconnect the server replays events after that id from `outbox_log`; if the id is older than the retention window the client performs a **full queue refetch** instead. `LISTEN/NOTIFY` drops notifications sent while no listener is attached, so the refetch — not the notification — is the correctness guarantee. Beyond **60 s** disconnected the POS shows a persistent banner (§9.6.3).

**S7 — `collected` is set by sweep, not by a tap.** Set by a background sweep **20 minutes after `ready`**, whose only purpose is to clear the queue board. **No barista tap is added** — L15 keeps Done as the barista's last action, and §05's tap budgets are unaffected. A `ready` order is never blocked by its absence.

**S7a — `payment_mode` precedence, where two branches both apply.** `createOrder` writes `'free'` on weekday mode and on `payment_posture='free'` events, **and** `'yoco_deferred'` when the till is deferred. **`'free'` wins.** An outage is irrelevant where nobody pays, and deferred mode is **inert** under a free posture: no order is created deferred and none is written off. Under the other reading a weekday free coffee would be created deferred and then written off at the close as a loss — inventing a phantom loss on every outage weekday and corrupting both `entitlement_cups` and the staff/walk-in split §7.3 depends on.

**S7b — Every order carries a `client_uuid`, online as well as offline.** With S2's 10 s server-action timeout returning `STALE_STATE`, a barista mid-rush taps Place, waits, sees "This order just changed — reloading", and taps again — **two orders, two payments, two stock deductions**, on the one path L02 leaves no remedy for. The POS generates a `client_uuid` for **every** order the moment Place is tapped; `orders.client_uuid` is **UNIQUE**; a repeat submission returns the original order rather than creating a second.

**S7c — A fully comped order carries `payment_mode='free'`, in any mode.** L01's exception list gains this entry. The grounded Sunday contains a `Free` tender on a Sunday (receipt `2026/08/002843`) and no rule covered it. A comped order requires **no payment record** and is therefore never swept by S3a.

**S7d — T10 excludes retail receipts.** §8.7 rules non-menu retail lines out of FAVO entirely, so they appear in Yoco's record and in no FAVO order **by design**. Without an exclusion, T10 fires a **structural false positive every week that a bag of beans is sold**, on the same channel as a real stock mismatch. T10 matches on the Yoco payment id and **skips transactions whose items are all non-menu SKUs**, reporting them as a separate informational line rather than a mismatch.

**S8 — Stock exhaustion blocks before money.** If no container is open and none can be opened, `createOrder` fails with `STOCK_EXHAUSTED` **before any payment is attempted**. The café never takes money for a drink it cannot make.

**S8a — Stock deducts at exactly one point: `transitionOrder('in_progress')`.** Not at `createOrder`. The drink is deducted when the barista starts making it, in every mode. This decides whether a cancel before `in_progress` has anything to reverse — which is the exact question T6 turns on.

**S8b — Stock can run out AFTER the money is taken, and that has a code and a resolution.** S8 checks availability at `createOrder`; deduction happens at `in_progress`, which on a Sunday is **after** tender. Orders ahead in the queue can consume what S8 saw. On a failed deduction the order **does not silently proceed**: `transitionOrder` returns `STOCK_EXHAUSTED_AT_MAKE`, the order stays `ordered`, no stock row is written, and the resolution is an **admin-PIN cancel with an L33 comp on a later order** (L02 returns no money) or an admin opening a container. **The Admin is pushed immediately** — a paid order that cannot be made is the one failure the money rules cannot absorb.

**S9 — Transitions are monotonic.** `transitionOrder` rejects any backwards or repeated transition with `STALE_STATE`. A duplicate `ready` therefore cannot re-fire the customer push.

> **What every *Benchmark* line below is, and is not**
>
> Each sequence states how a mature till normally solves its problem and why FAVO differs. **No published POS research was ever staged in this project's grounding**, so every benchmark is a claim of general card-present and hospitality practice, **made by this document, with no citation behind it**, and it is labelled that way rather than dressed as research. Phrases like "every mature POS" mean "FAVO believes this is normal practice". **They may not be used as evidence for anything**, and nothing in §07, §10 or §12 depends on one. Their whole job is to stop an *unexamined* difference passing as a considered one. **A benchmark line that would change a decision needs a source first.**

#### 6.0.2 T1 — Weekday free coffee, drop-off then collect

| # | Screen | Barista action | Server action | Rows written | External | Failure branch |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | POS opening window | Confirm the opening time, then the mode | openSession(opensAt) → setDayMode | opening_sessions | — | `NO_SESSION` blocks all ordering → the opening step, unskippable |
| 2 | Order entry | Tap the customer on the recents grid | searchCustomer | — | — | Offline → `OFFLINE_UNAVAILABLE`; the target falls back to `none` |
| 3 | Order entry | Tap the item | — | — | — | `STOCK_EXHAUSTED` → blocked here, before any money (S8) |
| 4 | Order entry | *none — automatic* | entitlement applied per L03 | — | — | `ENTITLEMENT_USED` → continues as a paid order, barista told once |
| 5 | Order entry | Tap **Place** | createOrder (payment_mode='free') | orders · order_items · staff_entitlement_log · audit_log | **none** — nothing is ever sent to the machine | `VALIDATION` → field message |
| 6 | Queue | Tap the order | transitionOrder('in_progress') | stock_movements · audit_log | — | `STALE_STATE` → queue reloads (S9) |
| 7 | Queue | Tap **Done** | transitionOrder('ready') | orders.state · audit_log | Web Push | Push fails → R10: the queue board is the primary signal; the customer asks at the counter |
| 8 | — | *none* | sweep at +20 min | orders.state='collected' | — | Sweep missed → S7, never blocking |

| Who | When | What they see |
| --- | --- | --- |
| Barista | Step 2 | The recents grid — the office staff who have **not** yet claimed today, most recent first. The bound target's name stays visible on the order **until Place**, so a mis-tap is caught before the drink is made, not after |
| Barista | Step 4 | A **free-cup badge on the line**, not a dialog. No confirmation, no tap — the entitlement is the norm on a weekday, and a modal on 63 orders a day is the regression §7.4's arithmetic rejects |
| Barista | Step 5 | The order appears in the queue **immediately**, with its target name. **No payment screen is shown at all** |
| Customer | Step 7 | Web Push: *"Your coffee is ready."* If push fails they are told nothing — R10 accepts this, and the queue board at the counter is the primary signal |
| Customer | Step 8 | Nothing. Their own order history shows the order as Ready for up to 20 minutes after handover — a known cosmetic lag, not a fault |

**Benchmark.** Mature POS systems treat a comp as a tender type at payment. FAVO applies the entitlement **automatically at item selection** instead, because the weekday free cup is the norm (63 office staff daily), not an exception — and a tender-type tap would cost a tap on every weekday order, the same arithmetic §7.4 uses to reject the lid toggle. **Deliberate departure.**

#### 6.0.3 T2 — Sunday card sale, **triple shot** [re-walked in v7.0]

> **Why a triple and not a double**
>
> **DEC-16 makes one and two shots both the listed price, so a double no longer exercises the surcharge at all.** This trace is re-walked at three shots — R20 base + R10 for the third — so the one thing it is here to prove still happens in it. *v6.0's version of this trace put "R30 on the machine" against a double, which after DEC-16 is R20: it was the only place in the document where the shot price appeared as copy rather than as a rule, and therefore the one a builder would have implemented verbatim.*

One flow, not two. The order is written before money is asked for (P1); the amount is pushed to the machine; FAVO polls for the outcome; the result is recorded.

| # | Screen | Barista action | Server action | Rows written | External | Failure branch |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Order entry | Tap the item, tap **3** on the shot picker (§6.2.3c) | — | — | — | `STOCK_EXHAUSTED` → blocked before money (S8) |
| 2 | Order entry | Tap **Place** | createOrder | orders (incl. client_uuid) · order_items (surcharge on the line) · audit_log | **none yet** | Write fails → no order, no payment, nothing to reconcile. **This ordering is the whole point** (P1) |
| 3 | Tender | *none — automatic on Place, or one tap from the queue if the customer stepped away* | beginTender(orderId) | payments (status='pending', attempt, client_reference, amount_zar, webpos_device_id) | — | `ALREADY_RESOLVED` · `TENDER_IN_PROGRESS` · `STALE_STATE`. **From here the order total is frozen** (P4) |
| 4 | Tender | *none* | sendToTerminal(orderId, attempt) | payments.yoco_payment_id (the id Yoco returns), payments.sent_at | **POST to Yoco's Web POS device — the machine lights up** | Error *with no id* → `GATEWAY_UNAVAILABLE`, nothing was sent, safe to send again · device error → `TERMINAL_UNREACHABLE` · **timeout** → `PAYMENT_UNKNOWN` → S4, **never re-sent** |
| 5 | Tender | Watches the machine. **The customer taps** | pollTenderResult — S2's schedule | payments.last_checked_at | **GET the payment's status resource** | `pending` → keep polling · `failed` → `PAYMENT_DECLINED`, order stays `ordered`, re-attemptable (S3) · **180 s ceiling** → `PAYMENT_UNKNOWN` → S4 |
| 6 | — | *none* | recordTenderResult | payments.status='successful' · charged_amount_zar · tip_zar · audit_log | — | **Asserts the charged amount equals `orders.total_zar`**. A mismatch is recorded **at the charged amount** and flagged to T10 — never silently overwritten |
| 7 | — | *none* | importYocoTransactions — daily, 06:00 | payments.fee_zar · receipt_no | Yoco's transaction record (T10) | Unmatched in either direction → T10's exception list (§6.8.3) |
| 8–10 | As T1 steps 6–8: make, Done, sweep. |   |   |   |   |   |

| Who | When | What they see |
| --- | --- | --- |
| Barista | Steps 3–4 | *"Amount sent — R30 on the machine."* **No amount to read, key or confirm**, because the machine already has the figure. This is the tap the web route removes, and it is why the Sunday budget is 4 rather than 7–9 |
| Barista | Step 5, waiting | A **progress state readable from arm's length** — the amount, and that FAVO is waiting on the machine. OPEN-01 requires this to be the one place the barista is asked to wait, so the wait is visible rather than a frozen screen |
| Barista | Declined | *"Card declined — try again or use another card."* **The order is still there**, in `ordered`, with its queue position and bound target intact (S3). Nothing is re-rung |
| Barista | `TERMINAL_UNREACHABLE` | *"Card machine not responding — check it's on and on the wifi, or switch to deferred"*, with `setDeferredMode` **one tap away** |
| Barista | Unresolved | **The drink is made and the queue moves on** — *fail open on the coffee.* The order carries a small *unresolved* marker; the barista is not asked to wait, and is **never asked to charge again** |
| Customer | Throughout | The card machine's own screen, and its slip. FAVO shows the customer nothing during tender |
| Admin | Next morning | The fee lands with the daily import. **Until it does, every fee-dependent figure reads *unavailable*, never zero** (§10.3.3) |

**Where the R10 lands:** on the `order_items` line, so revenue stays attributable (DEC-16, superseding DEC-08). **The attribution is unchanged by the re-pricing — the surcharge still lands on the line, it just starts one shot later**, at `extra_shot_zar × MAX(0, shots − 2)` per unit. **Where the fee lands:** `payments.fee_zar`, from the daily import, read as an expense line by §7.0.4 — never estimated.

**Benchmark.** Standard practice is that the POS pushes the amount to an integrated terminal, and **this is that practice.** v5.2's Phase 0 departed from it deliberately and temporarily; v6.0 has no departure to explain.

#### 6.0.4 T3 — Card machine unavailable → deferred → settled

| # | Trigger | Server action | Rows written | Failure branch |
| --- | --- | --- | --- | --- |
| 1 | **One barista tap**, or three consecutive failed device checks (60 s) | enter deferred mode | opening_sessions.deferred_* · audit_log | — |
| 2 | Orders taken | createOrder(payment_mode='yoco_deferred') | orders · order_items | Queue behaves normally. **Stock still deducts at `in_progress`** (S8a) |
| 3a | The machine is answering again | settleDeferredOrder(id) | orders.settled_at · payments · audit_log | **Query before sending.** Fetches the status of **every** payment this order has already created. Any `successful` → the settle is **refused with `ALREADY_RESOLVED`** and that payment is attached. Only on S4 step 3's two-negative result does it send a **new** payment |
| 3b | A standalone machine was used instead | settleDeferredOrder(id, ref) | as above + settlement_ref | — |
| 4 | **A manual entry exits only manually.** A check-triggered entry also exits on three consecutive successful checks | leave deferred mode | opening_sessions · audit_log | — |

> **Why the exit is asymmetric**
>
> An early draft let three successful checks exit deferred mode however it was entered — which **undoes the reason manual entry exists.** A barista who declares deferred mode because the machine is dead or flat would be ejected from it by a check that was never red, and every order after that silently demands a card the machine cannot take. So `opening_sessions.deferred_entered_by` records **`manual` or `health_check`**, and only a `health_check` entry may auto-exit.

> **The web route narrows this gap, where the SDK route widened it**
>
> v5.2's reasoning was that *"a server-side check probes Yoco's service; the grounded single point of failure is one physical reader, and a dead, unpaired or flat reader leaves the check green forever."* That was exactly true in Phase 0, where FAVO could not see the machine at all.
>
> **FAVO can now see the machine.** Its Web POS device has a status FAVO's server can fetch, so the device check probes *the machine* and not merely Yoco's service, and the first failed send is itself the signal — `TERMINAL_UNREACHABLE` offers deferred mode on that error rather than waiting three checks. **The manual tap remains the primary trigger**: a machine that is present, online and simply not taking cards still needs a human to say so.

| Who | When | What they see |
| --- | --- | --- |
| Barista | Entering deferred mode | A **persistent banner: *"Card machine unavailable — orders are being taken unpaid."*** It does not go away and cannot be dismissed, because the state it describes loses money silently |
| Barista | Every order while deferred | The tender step is **replaced, not skipped**: *"This order is unpaid — settle it when the machine is back."* The customer still gets their drink |
| Admin | Immediately, then every 30 min | Push naming **the barista, the session and the reason** (S2a). The repeat is the control: a mode that quietly stays on is the deferred-mode theft channel |
| Barista | Settling | The unpaid list, oldest first, with the amount. On success the order leaves the list. On `ALREADY_RESOLVED`: **"Already paid — do not charge again"**, naming who settled it and when |
| Barista | Exiting | The banner clears. **A manually-entered mode never clears itself** — it needs the same tap that set it |

> **Why settlement must ask Yoco before it sends, and not merely check FAVO's own records**
>
> `ALREADY_RESOLVED` is derived from FAVO's `payments` rows — and **the entire reason a deferred order exists is that FAVO's record may be wrong.** A deferred order whose earlier attempt actually succeeded but whose result was lost has no successful payment row in FAVO, so the guard does not fire, the barista taps Settle, and the customer is charged a second time for one coffee. **The guard is the query; the enum value is only the message.**

**Benchmark.** Every mature POS gives the operator a manual offline/deferred tender override. A device check alone would have been a departure with no stated reason; the manual tap **matches standard practice.** An existing *"Mark as paid"* control in the codebase is this mechanism and is named as such.

#### 6.0.5 T4 — Deferred order never settled

`closeDaily()` runs in this order, and the order is normative:

1. **Settle-or-write-off runs first and unconditionally.** Every **unpaid** order — `yoco_deferred`, and any `yoco` order with no successful payment record (S3a) — gets `written_off_at`, an `audit_log` row, and a reason. **This step is never gated on reconciliation.** **The close never settles** — it only writes off; an automatic settlement is exactly the charge-adjacent action §6.7 forbids.
2. **Then** the L09 stock reconciliation. A mismatch blocks **only the close record** — never the write-off — and pushes the Admin.
3. **A blocked close does not prevent the next day's session opening.** It surfaces as a persistent banner on the opening-window step and the admin dashboard until an Admin resolves it, and the alert repeats at **06:00 SAST** so it is read before trading.

**The close runs at 00:05 SAST and closes the *previous* revenue day.** L07 puts the revenue-day boundary at midnight; a 23:55 close cannot satisfy §10.6's deferred-order invariant for an order rung up at 23:57 — which L04 explicitly guarantees is possible. A missed run catches up on startup, records that it was a catch-up, and always names the revenue day it closed.

**In the P&L:** a written-off order appears as its own **write-off line**, not as negative revenue and not as an expense — `Σ order_net_charged where written_off_at IS NOT NULL` (§7.0.2).

| Who | When | What they see |
| --- | --- | --- |
| Barista | Nothing, ever | **The write-off is silent to the barista by design** — it runs at 00:05 when nobody is there. What they see is the *consequence*: the order is gone from the unpaid list next morning |
| Admin | 00:05, and again 06:00 | Push naming **the count and the value written off**, and the reason for each. Crossing `config.writeoff_alert_zar` (R100) or 3 write-offs in one session raises it independently of stock (S2a) |
| Admin | Daily, until resolved | Each `unresolved_at_close` write-off is an **open item on T10** until Yoco's record confirms no payment exists or produces one. *A write-off nobody checks is indistinguishable from money taken and lost* |
| Admin | Weekly | A **write-off line and a per-barista count** in §7.3.1's summary — the figure that makes the deferred-mode channel visible |

> **The write-off is executed unattended and is not thereby authorised**
>
> Every row `closeDaily()` writes carries `actor_kind='system'` **and `actor_staff_id` set to `orders.staff_id`, the barista who took the order**, plus a reason. The close then raises an **Admin approval item** listing every write-off with its `daily_seq`, value, reason and barista, which an Admin clears with a PIN — the same gate §11.3 puts on cancelling a single in-progress drink. **Until cleared, the day's write-offs report as `unapproved`** on §7.3.1 and the Day summary.
>
> **Why this is a gap rather than a preference.** Every other discretionary write-down in this document is capped, attributed and admin-gated; the largest one was none of those. A barista needs an admin PIN to cancel one R20 cup, while a cron wrote off an unbounded amount with nobody's authority — and because `actor_staff_id` was NULL for system actors, **a write-off and a theft produced byte-identical records.** *Alternatives considered:* block the close until an Admin approves — rejected, one unreachable person stops the next day's trading; alert on volume only — rejected, that is what makes the two indistinguishable. **Taken:** write off unconditionally so the books close, approve afterwards so the loss has a name against it.

**Benchmark.** A mature till normally resolves an unpaid tab **at the close, by the operator, on screen** — the day cannot be closed while something is open, and a human decides each one. FAVO writes off unconditionally and automatically, before the reconciliation gate, in an unattended job. *Deliberate departure, and it is the riskiest one in this document.* The reason is L01: a deferred order may never survive the day's close, and a café with one barista who has gone home has nobody to ask at 00:05. What the departure costs is that a write-off is a machine's decision, so it is bounded rather than trusted — each one attributed, counted, valued, reported per barista, pushed to the Admin the same day, and checked against Yoco's record before it is believed.

#### 6.0.6 T5 — Network blip → outbox → replay

| # | Step | Behaviour |
| --- | --- | --- |
| 1 | Connection drops | Queue renders from local state (S5). `transitionOrder`, stock, entitlement, walk-in, broadcast and **all tender** → `OFFLINE_UNAVAILABLE` |
| 2 | Order created offline | Written to the outbox with the POS-generated `client_uuid` |
| 3 | Reconnect | Replay; `outbox_log.client_uuid` UNIQUE rejects duplicates. SSE catch-up per S6 |
| 4 | Replay attribution | **A replayed order takes the server's receipt time as its revenue day**, never the client's `placed_at`. A replay landing after a close belongs to the new day and is never back-dated into closed books |
| 5 | Queue age | An order more than **12 hours** old at replay is rejected and surfaced on the admin exception list. Never silently accepted |
| 6 | **A vouchered order in the outbox** [new in v7.0] | **It queues and replays cleanly, voucher and all** (owner, 14 Sep 2026). A voucher is a line attribute set during order creation — the one thing §8.4's scope statement says *does* queue — and it carries **no uniqueness constraint for a replay to violate**, which is exactly why L34's connection requirement does not transfer to it. **The slip is surrendered whether or not the network is up**, so the close's paper count reconciles either way (§6.9.2). *This is the only discount that queues, and this trace is where that ruling is walked* |

**The entitlement collision (L34).** §8.4 states both that free-coffee entitlement claims *require a connection* and, four lines later, what happens when *two offline claims* replay. Both are normative and they cannot both hold. **Reading of record: the scope statement governs** — an entitlement claim requires a connection and fails visibly offline, so the double-claim scenario cannot arise through the entitlement path. §8.4's replay ruling stands as **defence in depth** for the case where that constraint is ever violated, and remains correct if it is.

**The offline drill (§15.1) must exercise an entitlement claim**, not five plain orders. The current drill passes while leaving this seam untested.

**Benchmark.** Mainstream tills go **fully offline**: they take payment, print, and sync everything later, because a till that stops when the network does is unusable in a market stall. **FAVO queues order *creation* only** — no payment, no entitlement claim, no stock movement. *Deliberate departure, and a narrowing rather than a shortfall.* FAVO's till lives on one fixed line in one building, so the blip it must survive is seconds, not hours; and the three things it refuses to do offline are exactly the three that cannot be made safe without a reconciliation layer, which §8.4 removes on the grounds that a one-tablet café cannot produce the multi-writer conflicts it exists to resolve. **Full offline tender would mean charging a card FAVO cannot reach**, which L02 leaves no remedy for. The cost is real and is stated: on a weekday outage a free coffee cannot be claimed and the barista is told so.

#### 6.0.7 T6 — Cancel after `in_progress`

| # | Screen | Actor | Action | Rows | Failure branch |
| --- | --- | --- | --- | --- | --- |
| 1 | Queue → order detail | Barista | Tap **Cancel** | — | Before `in_progress`: permitted outright |
| 2a | Admin PIN prompt | **Admin present** | Enter PIN | orders.state · compensating stock_movements · **a compensating donor_fund_entries `adjustment` row where the order was fund-settled (§6.10.5)** · audit_log (naming the overriding admin) | `FORBIDDEN` if no admin |
| 2b | Order detail | **Barista alone** | Complete the drink, log **abandoned** | orders.state='cancelled' · waste_log (order_id, category 'abandoned', mandatory reason) · audit_log (action='override') | — |

| Who | When | What they see |
| --- | --- | --- |
| Barista | Before `in_progress` | **Cancel**, plainly available. Nothing has been deducted and nothing must be returned |
| Barista | After, admin present | An **admin PIN prompt stating what it is for**: *"Cancelling a started order reverses stock. Needs an admin."* |
| Barista | After, alone (2b) | **Not a cancel — an "Abandoned" control** with a **mandatory reason**, and the screen says what it does: *"The drink was made. This records the waste against this order."* No PIN, because it reverses nothing |
| Barista | Either path | The order **leaves the queue immediately** |
| Customer | Any path | Nothing from FAVO. **L02 means no money returns**, and if they were charged the remedy is an L33 comp on a later order, which an admin grants — never an automatic refund |
| Admin | Weekly | **A per-barista abandoned count** in §7.3.1. That count is the only thing distinguishing a real abandonment from a barista taking the cup |

**2b is the normal case.** The grounded Sunday had **one** staff member across all 13 orders. A customer who leaves mid-make previously created an order the on-duty barista **could not resolve at all** — holding a queue slot, stock already deducted, L02 keeping the money. **No compensating stock movement is written** on this path: the drink was genuinely made and the ingredients genuinely consumed. The admin PIN is required only for a cancellation that *reverses* stock, which is an after-the-fact correction, never a counter action during a rush.

**Benchmark.** A mature POS voids a started order under a **manager function**, reverses stock, and — where money has moved — voids or refunds it. **FAVO matches the first two and refuses the third.** There is no void in Yoco's Web POS flow either, a reversal is a refund needing Yoco's own payment id, and L02 states FAVO does not process refunds. So a cancelled paid order corrects the stock and the record, and the money stays put — the remedy for a customer who has actually lost out is an L33 comped drink.

#### 6.0.8 T7 — Discipleship 101, open to auto-close

| # | Step | Behaviour |
| --- | --- | --- |
| 1 | Wednesday opening window | The recurring profile is found by **the session's own window** (COL-8); **six** switches snapshotted onto `event_windows` |
| 2 | Orders | `payment_posture='free'` → **nothing is ever sent to the machine**; cups consumed; audience church-member; extra-shot surcharge inert; **no voucher kinds live** |
| 3 | 20:30 | `opening_sessions.mode` **stays as stored.** The event's *force* is derived on read from `event_windows.starts_at`/`ends_at` — an expired window is simply no longer in force |
| 4 | After `ends_at` | Menu scope, payment posture, cup consumption, audience and the surcharge **all revert automatically**, because they are read from the window and the window has expired. **No job involved** |

> **`mode` is stored; the event's force is derived**
>
> §6.6 claimed reversion is *"a property of the data model rather than a cleanup job that can fail to run"* — true of **prices only** (time-boxed `price_history`), while something had to end the event itself. An early attempt said *"mode is computed on read"*, which was unbuildable: `opening_sessions.mode` is a **stored enum column**, `setDayMode` writes it, and roughly a third of this document reads that value — whether anyone pays (§04), whether cups deduct (L24), whether the entitlement applies (L03), whether a Saturday can open (DEC-04), which `payment_mode` `createOrder` writes (S7a), and how every §07 figure buckets.
>
> **The resolution:** `mode='event'` records that an event was opened; whether it is *currently in force* is read from the window on every read. At `ends_at` the six switches stop applying with **no timer and no job**, while the session row still records what happened. **A session bound to that window closes with it** — the expiry forces `closeSession`, audited, with the slip count prompted as normal, rather than leaving an open session in a mode nobody selected (COL-11). `closeEventWindow` records an **early** close; it is not what ends a window on time.

| Who | When | What they see |
| --- | --- | --- |
| Barista | Wednesday opening | The event **named on the opening window** — *"Discipleship 101, free, until 20:30"* — with the six switches shown as confirmed state, not as choices. A recurring profile is not re-decided every week |
| Barista | Every order in the window | **No tender step and no card prompt at all.** The order goes straight to the queue |
| Barista | Ordering off-menu scope | `MODE_FORBIDDEN` with the **named reason** — *"Not on the Discipleship 101 menu"* — never a bare refusal |
| Barista | At 20:30 | **Nothing happens on screen, and that is correct.** The window expires on read; no job runs, nothing flashes. The next order simply prices and behaves normally |
| Admin | In every rollup | Events as their **own third column**, never folded into Weekday or Sunday — weekday-like revenue with Sunday-like consumption would understate cup cost or invent a phantom loss |

**Benchmark.** Hospitality tills normally handle a special-pricing period as a **manually switched price level**, which an operator turns on and — the classic failure — forgets to turn off. FAVO's event window carries its own end time and everything reverts at `ends_at` with no job involved. *Deliberate departure, and the reason is the failure mode itself:* the thing that goes wrong with a price level is never switching it on, it is **the Monday morning that is still running Sunday's prices.**

#### 6.0.9 T8 — Day close with a stock mismatch

**The close is now preceded by `closeSession`**, which ends the day's last session and prompts for that session's voucher slip count (§6.11.1). It is a separate step from `closeDaily()` and it never blocks it: an uncounted tin leaves `voucher_slips_counted` NULL, which is distinguishable from zero (L43). **Then** steps 1–3 are T4's ordering, which resolves the collision between L09's blocking gate and §10.6's deferred-order invariant. What the humans see:

| Who | When | What they see |
| --- | --- | --- |
| Admin | 00:05, then 06:00 | Push naming the item, expected vs counted, and the variance band (T08 for lids) |
| Barista | Next opening window | Persistent banner: a close is unresolved. **Ordering is not blocked** |
| Admin | Any time | The reconciliation screen, with deferred write-offs already applied and listed |

**Benchmark, and a real departure — see §7.5.** Every mainstream POS ends the day with an operator-initiated close and an on-screen report: tender totals, order count, discounts, voids, discrepancy. FAVO's close is an unattended job and there is no cash-up, because there is no cash. That part is deliberate. **What was not deliberate** is that the barista who traded 13 orders could not see a total anywhere — answered by §7.5's Day summary.

### 6.1 Order-ready notifications, and the flow fix

Registered customers get a push the moment the barista marks the order done. This replaces the WhatsApp workaround, where either the whole staff group is pinged for one person's coffee or the barista messages people individually.

**The flow assumption that was wrong.** The order flow as built assumes the customer is standing at the counter when the order is created. The real weekday flow is not like that: a cup gets placed on the counter and the person walks away. The barista makes it minutes later. By then there is nobody to ask *who is this for.* This is a sequencing problem in the POS, not a missing table, and v5 resolves it with one rule:

> **L28**
>
> **Every order binds a notification target at ring-up, before the drink is made.**

| Target | How it is set | Notification |
| --- | --- | --- |
| Known customer | The barista taps them on the recents grid, or searches; then their **Favo** or **Something else** (§6.4) | Push to their registered subscription |
| None | **One tap** — a walk-in, an unregistered visitor, or someone who does not want a notification | No push. Logged so the consumption count stays honest |

The POS will not complete order creation without one of the two. "None" is an explicit choice, never a default reached by skipping a step — and it is the correct, expected choice for anyone who is not a registered customer.

#### Ring-up and make are separated in time

The state machine already supports this — `ordered → in_progress → ready → collected` — and the change is entirely in the POS surface: the barista rings up in seconds and the order lands in the queue in `ordered`; **the queue is the work list**, not a status display; the barista taps into an order to start it (`in_progress`, which deducts stock) and taps **Done** when ready (`ready`, which fires the push). So the person can walk away the moment they have dropped the cup, and the system already knows who to tell.

#### The platform constraint that shapes all of this: iOS Web Push

**On iPhone and iPad, Web Push does not work in Safari.** It works only for a web app that has been **added to the Home Screen**, and permission must then be requested from a direct user tap. This has been the rule since Web Push arrived on iOS 16.4 and it has not relaxed.

| Who | Android / Chrome | iPhone / iPad |
| --- | --- | --- |
| Registered customer, order-ready push | Works in-browser | **Requires the PWA installed to the Home Screen** |
| Office staff, opening broadcast | Works in-browser | **Requires install** |

1. **Registration and onboarding must include an install step**, with explicit iPhone instructions ("Share → Add to Home Screen"). A customer who registers on an iPhone and never installs will silently never receive a notification — **the worst failure mode available, because everything looks like it worked.**
2. **This is a further reason notifications are for registered customers only** (§8.5). A mechanism that cannot reach a passing visitor's iPhone is not a mechanism for passing visitors.

*Status: registered-customer push is built. The target-binding rule and the ring-up/make separation are new.*

### 6.2 POS speed and layout

A standard for the **whole** POS, not one screen. Order entry, queue view and tender are all judged against "does this slow a barista down."

- Large, thumb-friendly tap targets — baristas often have wet or full hands mid-shift (§17.6.2).
- A shallow path from customer lookup to order placed. Nobody should get lost several screens deep looking for something routine.
- **No full-screen interstitials on the ordering path.** Anything that covers the menu is a step backwards (§6.4).
- The Sunday rush is the stress test: **a mis-tap or a buried menu costs real time when it is repeated 45 times.**

#### 6.2.1 Customer recall without typing

Both ring-up budgets forbid typing, and the only recall mechanism v5.1 specified was a name-or-phone search — which is exactly the *typed name* L03 indicts v5.0 for.

**The order-entry screen leads with a recents grid**, above the search field: **the office staff who have NOT yet claimed today's cup, most recent first, then the last 12 matched customers.** One tap to bind. Search is the fallback, not the primary path. The ≤ 3-tap weekday budget is measured against the grid and **not** against search.

> **The ordering is load-bearing**
>
> An earlier draft led the grid with *today's already-served office staff* — which, by L03's one-cup-per-person-per-weekday rule, is **precisely the set of people who cannot order again today.** The grid led with dead tiles, the ~63 recurring staff competed for the 12 remaining slots, giving roughly a **19% hit rate on the first cup of the day** — the common case — and everyone else fell through to search, which is typing, which the budget forbids.
>
> **Inverting the first section fixes it:** the people who have not yet claimed are exactly the people about to order, and on a weekday that set starts at ~63 and shrinks all morning. A *served* tile is not useless — it is how a barista notices a double claim — so it stays visible, **below** the unclaimed set and visibly marked, never occupying a primary slot.

| Case | Path | Typing? |
| --- | --- | --- |
| Weekday, recurring office staff (~63) | The recents grid — office staff first, then the last 12 matched customers, one tap to bind | No |
| Sunday, unregistered | `target = none`, an explicit tap that L28 forbids defaulting into | No |
| Registered customer not in the grid | **Search — and this is typing** | Yes |

**The third row is a real exception and it is bounded rather than hidden.** It arises for a registered customer who has not ordered recently enough to be in the last 12, which on the grounded weekday pattern is rare. **The budgets are stated as met for the grid and `none` paths, and the search path is outside them.**

> **Irrelevant to the tap budgets. Not irrelevant to notifications (DEF-F)**
>
> v6.0 recorded the search path as *"on a Sunday irrelevant."* **That is correct about tap budgets, which is what this section is about, and wrong about the feature search exists for.** The recents grid holds 12 slots against a congregation in the low hundreds, so **for a registered church member on a Sunday or at Untracked Church, typing their name is not the fallback path — it is the only path**, and it is the path the whole push feature depends on (L28).
>
> **§05 keeps its ≤ 4-tap budget measured against the grid**, because the two statements answer different questions. `searchCustomer`'s contract is §6.9.4a.

**On a clean database the grid is empty** (§13.0), so the first weekday's orders go through the search the budget forbids. **That is accepted and time-boxed:** the ≤ 3-tap weekday budget is measured **from the second week of trading**. Gate zero's seed step does not pre-populate it — inventing customer rows to hit a tap budget would be worse than admitting the first week is slower.

#### 6.2.2 Ringing a quantity of two — the stepper [OPEN-13 closed]

> **This overrides v5.2's own default**
>
> v5.2 proposed that **tapping an item again adds one**, on the grounds that it costs no extra tap. **Nikao's call is that this is too easy to get wrong during a rush** — a stray tap silently doubles a drink and nobody notices until the total is wrong, which on a Sunday is after the customer has paid it.

**The specification.** The first tap on a menu item adds the drink at quantity 1. Every quantity change after that happens on an explicit **− / +** stepper on the order line. **Stepping down to zero removes the line.**

**Tapping an already-added drink changes nothing about the quantity.** It flashes that line and draws the eye to its stepper — giving the barista visible confirmation the drink is already on the order, which is the useful half of the repeat-tap behaviour, without the half that costs money.

**One line per menu item, carrying a quantity.** Two taps on Cappuccino produce one line, not two, so `line_gross` and `line_cogs` read exactly as §7.0.2 writes them, an L33 comp on a quantity-2 line is an **explicit** choice to comp both cups, and L03's entitlement still discounts **one unit** of one line.

**Cost to the budgets: one tap, and only on the orders that need it.** Three of the fourteen grounded Sunday orders carry quantity 2, so roughly one order in five pays it. §05's drills are timed at quantity 1 and the stepper is timed separately; **the ≤ 4-tap Sunday budget is a single-quantity budget and says so.**

#### 6.2.3 The shot count, and what it does to T09 [rewritten in v7.0 · DEC-16]

> **The pricing rule, from the counter**
>
> **One shot and two shots are both the listed price. From the third shot on, it is R10 a shot.** A cappuccino is R20 single, R20 double, R30 triple, R40 with four.
>
> **v6.0 had this materially wrong:** T09 and DEC-08 said a *double* shot carried the R10. It does not, and never did. **DEC-16 supersedes DEC-08 on its merits**, and it is the revision v6.0's own §12.2 said it left T09 admin-tunable for.

| Shots | Sunday price | Surcharge | Coffee deducted | Margin |
| --- | --- | --- | --- | --- |
| 1 | R20.00 | — | 1 × | Highest |
| 2 | R20.00 | — | 2 × | **Lowest on the menu** |
| 3 | R30.00 | R10.00 | 3 × | Recovers |
| 4 | R40.00 | R20.00 | 4 × | Recovers |

> **A Priority-2 finding that falls straight out of this table**
>
> Price is flat from one shot to two; cost is not. **The second shot is the least profitable thing FAVO sells** — it adds a full coffee unit of COGS and not a cent of revenue — and on the grounded Sunday **83% of cappuccinos took it**. The café's best-selling item is overwhelmingly sold in its worst-margin configuration, and nothing in v6.0 would ever have shown that, because v6.0 believed the second shot was the one that earned R10.
>
> **So §7.1's dashboard and §7.3's weekly summary must break margin down by shot count**, not only by item. It costs one `GROUP BY` and it is the single most actionable number this change produces for Priority 2. **L39 applies wherever that figure surfaces** — a per-shot margin derived from an estimated ingredient renders *provisional* and never green, like any other.

#### 6.2.3a This is the revision v6.0 asked for, not a reversal of it

v6.0's §12.2 recorded doubt about its own decision, in its own words: T09 *"functions as a 50% increase on the majority configuration of the best-selling item, not a surcharge on a minority option,"* and it made T09 admin-tunable *"specifically so this can be revised on the first month's evidence."* This is that revision, and it arrived from the counter rather than from the first month's reports. **DEC-08 stands as a dated decision and is superseded on its merits** — the concern v6.0 raised about itself turned out to be the actual pricing.

> **And it completes something §10.5 left half-done**
>
> §10.5 deletes the `Extra Shot` row from `menu_customisations`, on the correct grounds that two pricing paths for one fact is a defect. But the *fact* that row encoded — **extra shots are chargeable, and repeatable** — was real, and the deletion left it with nowhere to live. It now lives on `order_items.shots` and T09, which is one path, not two. **The deletion was right; it was just incomplete**, and §10.5 no longer files repeatability as an error (COL-15).

#### 6.2.3c Shots become a number you pick, not one you step to

- **`order_items.shot` (enum `single | double`) becomes `order_items.shots` (integer NOT NULL default 1, `CHECK BETWEEN 1 AND T15`).** An enum with two values cannot hold four. §13.0 starts on a clean database, so there is nothing to backfill.
- **A segmented picker on the order line — `1 2 3 4`, one tap to any value** (owner, 14 Sep 2026). **Not a − / + stepper.**
- **It removes the one risk a stepper could not mitigate.** Two − / + steppers on one line — quantity and shots — is the hazard §6.2.2 spends a whole decision on: a stray tap that changes a number silently, found when the total is wrong. **A picker and a stepper cannot be confused for one another at all**, because they are not the same control. *The risk is designed out rather than tested for.*
- **It is also fewer taps, not more.** A double is one tap either way; a triple is one tap instead of two, and a quad one instead of three. The §05 Sunday budget is unchanged at its worst case and better above it.
- **The weekday ceiling renders as two segments, not four greyed ones.** On a weekday the picker is `1 2` — L48 applied, and it falls out of the control rather than needing a rule of its own (T15).
- **The segments are spaced, never flush** — four targets at D1's 44 px with ≥ 8 px between them, under one `shots` label (D10). A designer handed the words "segmented control" draws it flush by default, and D1 would then be broken by a convention rather than by a decision (COL-9).
- **DEC-09 generalises cleanly and is strengthened, not replaced.** "A double deducts twice the base recipe's coffee and nothing else" becomes **coffee × `shots`, everything else × 1** — same cup, same lid, same milk. The recipe-level multiplier v6.0 chose is keyed on `shots` instead of `shot` and otherwise does not change. *That the mechanism survived a change to the fact it encodes is a point in its favour.*

#### The tap budget is unchanged, because the default does not move

- Sunday double shot — §05's budget, and it still holds: Item → shots · 2 → Target · none → Place  — **4 taps**
- Sunday triple shot — one tap cheaper than a stepper: Item → shots · 3 → Target · none → Place  — **4 taps**

**Defaulting to 1 keeps §05's four-tap Sunday budget exactly as written** — one tap to reach a double, and now one tap to reach any shot count at all. Defaulting to 2 would save a tap on ~83% of cappuccinos and cost one on the rest, which is tap-optimal and is *not* recommended yet: a barista who forgets to step down gives away a shot of beans, and the 83% figure is one day of one item. **It is a per-item config default the moment a second Sunday's data agrees with the first.**

**The arithmetic lives in §7.0.2 and nowhere else** — `surcharge_zar = config.extra_shot_zar × MAX(0, order_items.shots − 2)` per unit, and `line_cogs`'s `shot_factor`. §7.0 governs where any section disagrees with it, which is why the formulas are not restated here.

#### 6.2.4 Where every control lives, once all of this is on one screen [new in v7.0]

> **Stated plainly, because it is the honest position**
>
> **Amendment pack A specified five mechanisms one at a time and never drew the screen they share.** Each was argued at "one tap" in isolation. A quantity stepper, a four-segment shot picker, a voucher chip, a comp, an entitlement, a modifications control and a fund tile all want space on the same order panel, and "one tap each" stops being a useful claim once they are competing for the same 44 px.
>
> This section is that omission closed. **It adds no mechanism** — it decides where the ones already specified go, and states the rule that keeps the screen from filling up.

#### 6.2.4a The organising principle — and it answers the voucher question directly

> **Three places, and every control belongs to exactly one**
>
> - **What the drink *is* → the line.** Shots, milk and other modifications, quantity.
> - **What is *owed* → the line.** The Untracked hot drink voucher, the L33 comp, the L03 entitlement. All three are per-unit discounts and all three attach to a drink.
> - **Who *pays* → the footer.** The blessing fund, and the card — which costs no tap at all, because FAVO pushes the amount to the machine.
>
> **This is why the voucher sits on the drink and the fund sits on the order, and it is not an arbitrary split.** A voucher changes what the café is owed for one cup — so it has to know which cup. A fund settles whatever is owed once the order is complete — so it must not care which cup, or trace T10 becomes unbuildable. **The Untracked hot drink voucher attaches to the drink, never to the order**, and §6.9.1b's two traces are the reason.

#### 6.2.4b Frequency decides prominence

§6.2's standard is "does this slow a barista down." The answer follows from how often each control is actually reached — measured against the grounded Sunday and the weekday pattern, not guessed.

| Control | Reached on | Where it lives |
| --- | --- | --- |
| Item · target · Place | Every order | Menu grid · footer · footer. Unchanged from v6.0 |
| Shot picker `1 2 3 4` | ~83% of cappuccinos | **On the line, always rendered.** The most-reached control v7.0 adds |
| Quantity stepper | ~1 order in 5 | On the line, always rendered (§6.2.2) |
| Modifications — macadamia | Occasional | On the line, always rendered |
| Untracked hot drink voucher | ~25 per outreach evening · **zero on an ordinary Sunday** | **On the line, only when a voucher kind is live for the session.** On a normal Sunday it does not exist |
| Blessing fund | A few a day at most | **In the footer, only when an active fund exists and the order has a net charge** |
| L33 comp | ≤ 2 per barista per session, by rule | Behind the line's `⋯`. Rare by design, and it needs a reason picker anyway |
| L03 free cup | Every weekday office cup | **No control at all** — auto-applied, one tap only to decline (L03) |

> **L48 — a control that cannot apply is not rendered**
>
> The voucher chip does not exist on a weekday. The fund tile does not exist when no fund is active or the order owes nothing. The shot picker does not exist on a drink with no coffee in it, and shows only `1 2` on a weekday. **Rendering a control that can only refuse is how a POS fills up with things a barista has to learn to ignore**, and it is the mis-tap surface §6.2.2 spends a whole decision on.
>
> **This is about applicability, never about permission, and §17.6 owns the other half.** §17.4.1 is explicit that a barista's third comp *"renders the admin-PIN prompt rather than hiding the control — the barista must see why they are stopped."* That stands and does not conflict: a control you could use with an admin beside you is shown and explains itself; a control that could never do anything here is absent. ***Stopped is shown. Meaningless is hidden.***

#### 6.2.4c The line, drawn

Trace T10 — a church member with a cappuccino, a newcomer's hot chocolate on an Untracked hot drink voucher, one order, outreach evening so the voucher chip is live.

**POS order panel — the drawing, as structured text.**

*Order panel · Untracked Church evening*

- **Cappuccino** — 2 shots · macadamia — R20.00
  Controls: quantity stepper · shot picker 1/2/3/4 (selected: 2) · milk · voucher · ⋯

- **Hot Chocolate** — untracked voucher — 1 of 1 — ~~R20.00~~ R0.00
  Controls: quantity stepper · milk · voucher — LIT · ⋯

- **Footer** — To pay R20.00 | tell · Thandeka M. · nobody | pays · Thandeka's group · R180 · Blessing fund · Louis M. · R340 · +4 | Place order — card

*What the drawing is claiming*

- **No shot picker on the hot chocolate.** L48 — there is no coffee in it, so the control is absent rather than present and inert.

- **A picker and a stepper, never two steppers.** Shots are four spaced targets, one tap to any value; quantity is − / +. Two controls that cannot be mistaken for each other, which is the whole reason for the choice (D10).

- **The voucher chip is on both lines, lit on one.** It is live because the session carries a voucher kind. On an ordinary Sunday neither line shows it.

- **The vouchered line shows what it was.** `R20.00` struck through, and `1 of 1` — on a quantity-3 line it would read `2 of 3`, so a partly-vouchered line can never look fully vouchered.

- **The footer is the money.** Total, then who pays, then Place. The fund tile carries its balance so an empty fund is visibly empty (§6.10.5).

- **Two rows in the footer, and they answer different questions.** `tell` is L28's notification target — one per order. `pays` is the tender.

- **At most two tender chips, at any number of funds.** The linked fund, and one chip standing for every open fund — `+4` says four more are behind it. Neither is lit here, so Place sends the R20 to the card.

- **The card costs no tap.** No card chip exists — it is what Place does when no fund is lit, which is why the button says so. The only tender needing a tap is the one that is not the default.

- **`⋯` holds the comp**, and nothing else today. Rare by rule, needs a reason picker, and its admin-PIN prompt must still be visible when it is reached (§17.4.1).

#### 6.2.4d Does it fit — checked, not assumed

**The order line is two rows, and that is a specification rather than a consequence.** Name and configuration and price on the first; controls on the second. One row cannot hold two controls, two chips and a price at §17.6.2's 44 px floor inside an order panel of roughly 410 px. The shot picker alone is four targets — about 200 px with its gaps — and the quantity stepper another 110.

**Vertical budget on the pinned-free iPad geometry of §17.6.4:** a line is about 80 px (28 px of text, 52 px of controls with padding), the footer about 120 px. A three-line order is therefore ~360 px of the panel's height, which leaves the menu grid and the recents grid their room and holds D3's constraint that the menu is always visible and tappable.

**Target count on the busiest realistic order:** three lines × five controls, plus the target chip, up to two fund tiles and Place — about eighteen interactive targets in the panel. Every one at 44 × 44 px with ≥ 8 px between adjacent targets (D1). **It fits, and it is close enough to the edge that a sixth per-line control would not.** That is the real reason L48 is a locked rule and not a preference, and why §15.1 carries the measurement as a gate before one is ever added.

> **The risk this layout used to carry, and no longer does**
>
> An earlier draft put shots on a − / + stepper beside the quantity stepper, and had to name its own worst problem: **two adjacent steppers on one line is exactly the hazard §6.2.2 spends a decision on.** The mitigation was to spell each value, and it was unproven; a drill was listed to test it.
>
> **The owner chose the segmented picker instead (14 Sep 2026), which removes the ambiguity rather than testing for it.** It costs about 200 px of line width, buys back a tap on every triple and quad, and makes the weekday ceiling a matter of rendering two segments instead of four. **The drill is retired because the thing it was going to measure has been designed out.**

### 6.3 Barista schedule and opening-hours broadcast

An in-app barista schedule (Louis, Thandeka and Nkuli rotate), a shift-start push to whoever is on duty, and a way for that barista to set the day's opening window and broadcast it.

The window is **the window for dropping cups off** — *not* the time by which drinks are finished. The broadcast is plain, not decorated: *"Favo is open 8:45–9:15 — Thandeka."*

**Audience is automatic.** Weekdays reach **office staff** only — congregation members are not in the building. Sundays reach **office staff + church members**. Events reach whatever their profile specifies. The app computes this; nobody assembles a recipient list.

**Mode is defaulted, not forced.** The same step shows the day's mode — Weekday, Sunday, or a named event — already selected from the date. Most days the barista does nothing further. On an exception they switch it right there, before broadcasting, in one tap.

*Status: the opening-window half is built. The rota, shift-start push, mode confirmation and audience split are new.*

### 6.4 Self-registration and The Favo

Anyone — staff or congregation — registers themselves without a barista's help and sets their **Favo**: a menu item plus any standard modifications. Editable at any time, by them.

#### At the POS: prominent, never a takeover

Once a barista looks up a matched customer, two controls appear: **Favo — [order spelled out]**, primary, one tap, places the repeat order; and **Something else**, secondary and visually lighter, which dismisses the row and focuses the menu.

- The Favo row is **inline, above the menu grid**. Never a modal, an interstitial, or a full-screen state.
- It occupies **at most a quarter of the order panel's height**, measured at §17.6.3's POS viewport.
- **The menu grid stays visible and tappable at all times.** There is no state in which the barista must dismiss something to reach the menu.
- "Something else" is a dismissal, not a navigation. It does not open another screen.
- Both controls meet the touch-target minimum of §17.6.2. *Bounded, not small.*

The point is a one-tap shortcut that costs nothing when it is not wanted — a full-screen prompt taxes every order that is not a repeat, which on a Sunday is most of them.

#### Drift prevention is a requirement

Customer-side setup (the account page) and barista-side setup (the POS) must call the **same server action and validate against the same schema** — not two implementations that happen to write to the same table.

*Status: built (`favos` table, `actions/favo.ts`). Needs wiring into the POS row, to the layout constraints above.*

### 6.5 Walk-in tracking

Someone visiting the church on a weekday who is not office staff, wanting a coffee, **is not charged** — same as staff — but is logged as a **walk-in** rather than counted against the one-per-staff-per-day entitlement. This keeps weekday consumption numbers (§7.3) honest without turning a walk-in into a registration requirement.

**No daily limit is enforced.** The staff entitlement is DB-enforced at one per day because it is tied to a specific person. A walk-in has no persistent identity to key a limit off, so it is **barista discretion, logged for visibility, not policed by the database.**

Logging captures drink category and type only — **no identity of any kind.** `walk_ins.quantity` is recorded per line, so §7.0.2's `walk_in_cups` counts walk-in cups and not the whole order's.

*Status: new.*

### 6.6 Event / Social mode

Event mode exists so that special weekends, socials and midweek gatherings run on the same system instead of falling back to paper. It is **configured per event, not inherited from Sunday** (§4.3).

#### The six switches

| Switch | Options | Why it is separate |
| --- | --- | --- |
| Menu scope | Full · coffee-only · custom subset | A dessert evening and a prayer breakfast want different menus |
| Payment posture | `free` · `standard` (normal prices) · `override` (event prices) | **Discipleship 101 is free.** A paid social is not. Neither should have to borrow the other's behaviour |
| Cup & lid | Consumed · not consumed | A free event still burns disposables. Payment and cups are unrelated facts |
| Broadcast audience | Office staff · church member · both · nobody | Wednesday-night attendees are church members on a weekday, which the weekday rule would otherwise exclude |
| Extra-shot surcharge | Charged · not charged | A paid social may want the R10 a third shot carries on a Sunday; a subsidised one may not. Inert under `payment_posture='free'` (T09, DEC-16) |
| **Voucher kinds** [the sixth, new in v7.0] | A list of kinds from T12's catalogue — `[]` for most events | **It puts the voucher where the vouchers actually are**, rather than deriving it from the day of the week (§6.9, §6.11.2). **Genuinely independent of the other five:** a paid evening with vouchers and a paid evening without are both real, and so is a free event with vouchers if HOFMI ever hands slips out at a social. Deriving it from payment posture or from the audience would be the inheritance model §4.3 discarded, arriving one switch later |

**The Discipleship 101 profile**, as a worked example: menu = coffee-only · payment = **free** · cups = **consumed** · audience = **church member** · extra-shot surcharge = not charged (inert) · voucher kinds = **none**. **This combination is reachable from neither Weekday nor Sunday** — which is exactly why the switches exist. **The Untracked Church profile is the other worked example**, and it is the one that carries the sixth switch (§6.11.2).

#### Three activation paths

**Path A — recurring template.** An admin defines the event **once**: name, recurrence (*every Wednesday*), window (*18:30–20:30*) and the six switches. From then on, date-defaulting finds it automatically, and the opening-window step reads *"Discipleship 101 · Event · free · disposables · Church Member — [Confirm]"*. The barista confirms with the same single tap as any other day. **Zero recurring admin effort, by design** — a weekly event that needs setting up every week is a weekly opportunity to forget, and the day it is forgotten the café silently charges people who should not pay.

**Path B — one-off scheduled event.** Identical, but on a specific date instead of a recurrence.

**Path C — ad-hoc, start now.** From the opening-window step, tap **Start an event**, pick a profile or set the switches directly, and **give it an end time**. An end time is mandatory.

#### Deactivation is automatic, and that is the safety-critical part

At the window's end time price overrides expire — they are **time-boxed `price_history` rows**, so reversion is a property of the data model rather than a cleanup job that can fail to run — mode reverts to the date default, and the next day defaults normally. **An event can never leak into the next day.** Backstop: an event window may not exceed 24 hours (L27). An event that silently stayed open would change the café's economics without anyone deciding to — a free event left running turns every subsequent Sunday order free.

#### Precedence, so two rules never both apply

1. A one-off event beats a recurring template on the same date.
2. An explicit event beats the date-derived mode — **including Sunday** — but overriding a Sunday requires a confirmation step, because it is unusual enough to be worth a second of friction.
3. Absent any event, the date decides: Mon–Fri → Weekday, Sun → Sunday, Sat → no session without an event.

#### Why event prices cannot just be typed into the card machine

**Because the flow runs the other way.** The app is the pricing authority; Yoco is a payment gateway that charges the amount it is handed. `createOrder` computes the total from the menu, and **that total is what the card machine is asked for** — pushed to it by `sendToTerminal`. Yoco has no concept of "a mocha costs R15 tonight"; it only ever sees a number. **The web route makes this argument stronger, not weaker:** the machine is handed a figure by FAVO's server and has no catalogue of its own to disagree with.

Three things break if the price originates at the card machine instead. **COGS and margin go wrong** — revenue is recorded per order line from the app's own prices, so a price entered only at Yoco is never attached to the item that was sold. **The audit trail loses the *why*** — `price_history` is append-only and records who changed a price, when, and for how long. **A standalone Yoco transaction has no order at all** — no order row, no stock deduction, no queue entry, so the drink effectively never happened as far as FAVO is concerned. (That is the deliberate fallback during a machine outage, and it requires manual reconciliation afterwards precisely because of this.)

**Two records, one truth (DEC-03).** An override is written in a single transaction to **both** `price_history` — the append-only source of truth, carrying the price, its effective window and `set_by_staff_id` — **and** `event_windows.price_overrides`, a read snapshot the till uses for fast lookup. The snapshot is written once at window open and **never edited independently.** Where they disagree, `price_history` wins and the discrepancy is a bug; a daily check asserts equality (§10.6). This is not a second pricing engine — it is one engine with a cache that cannot legally drift.

**Events report as their own column.** Event orders are tagged with the event id and reported as a **third column** in the rollup, alongside Weekday and Sunday — never folded into either. Discipleship 101 has weekday-like revenue (zero) and Sunday-like consumption (disposables): folding it into weekday would understate cup costs; folding it into Sunday would show a phantom loss every Wednesday.

*Status: new. A buildable spec, scheduled late in §13 on sequencing, not uncertainty.*

### 6.7 When the card machine cannot be reached

> **How this relates to §6.8**
>
> §6.8 specifies *how* card tender works. This section specifies what happens when it **cannot** work. Its central rule — **FAVO never automatically re-sends a payment** — was written before anyone had read Yoco's documentation and it survives contact with the Web POS API unchanged: Yoco documents no idempotency mechanism, so a second send must be assumed to take money a second time, and L02 leaves no remedy for a wrong charge. **Resolution is always a lookup (S4), never a retry.**

The machine goes off the wifi mid-Sunday and there are people in the queue. The café keeps serving; the system keeps the record (DEC-02).

**Detection.** The *first failed send* is the primary signal — `TERMINAL_UNREACHABLE` offers deferred mode one tap away. A background device check every 60 s is the backstop; three consecutive failures put the till into deferred mode on their own. **A barista tap remains the primary trigger**, because a machine that is online and simply not taking cards leaves every check green. Entering and leaving deferred mode is audited.

**While deferred.** Orders are created with `payment_mode='yoco_deferred'`. Stock deducts normally at `in_progress`, the order enters the queue normally, and the drink is made normally. **The order exists** — which is the whole point, because a sale that happens outside the app has no order row, no stock deduction and no COGS.

| Settlement path | When | What is captured |
| --- | --- | --- |
| A — the machine answers again | While the customer is still present | A fresh payment sent against the open order, **after a lookup confirms no earlier attempt succeeded** (T3 step 3a). Yoco's payment id recorded as normal |
| B — standalone machine used | The customer pays on the machine directly, outside FAVO | The barista marks the order settled, **capturing the machine's transaction reference** — this is what makes the standalone fallback reconcilable instead of blind |

**Write-off.** Any order still unpaid when `closeDaily()` runs is **written off**, recorded as a loss in that day's P&L, and audited. **A deferred order may never survive the day's close** — an unpaid order that rolls over to tomorrow is indistinguishable from a lost sale, and by next week nobody can reconstruct which it was.

> **What *unpaid* means, now that a fund can settle an order**
>
> **An order is settled if it holds a successful payment *or* a `donor_fund_entries` spend entry.** A fund draw deliberately writes no `payments` row (L47, §10.2.1) — so without this clause **every fund-paid order is written off at the close as a bad debt, on the day it was paid for.** `GET /api/admin/unpaid-orders` takes the same definition (REQ-166).

**Admin surface.** An unpaid-orders list, visible to the Admin role, showing every open unpaid order with its `daily_seq`, age and value.

> **Why not simply stop serving?**
>
> L01's original wording would have required exactly that. On a Sunday with 45 orders in 100 minutes, an outage that stops the till stops the service. The deferred path trades a small reconciliation burden for continuity — and because L02 forbids refunds, **the risk it must never create is over-collection**. Settlement is therefore always an explicit barista action against a specific open order, never an automatic retry that could charge twice.

### 6.8 Card tender — how FAVO takes money [rewritten in v6.0]

> **Fail closed on the money. Fail open on the coffee.**
>
> Never take money FAVO cannot account for; never stop making coffee because the accounting is uncertain. **These are separable concerns and this document separates them deliberately** — it is the sentence that resolves the hard cases in T2, T3 and T4. A customer at the counter gets their drink; the money is reconciled against Yoco's record, afterwards, by a control that runs every day.

#### 6.8.0 What FAVO integrates with, and the decision that changed

**Every real sale goes through a physical card machine, and the code as built targets Yoco *Online*.** `src/server/yoco/client.ts` at `main @ 9aefc2c` calls `payments.yoco.com/api/checkouts` and cites Yoco's *online* integration guide; its own comment notes that the checkout id doubles as a client secret for Yoco's browser SDK rendering a card form in a web page. Meanwhile all 13 card sales of Sunday 2026-08-16 ran through one physical machine on **Yoco's own POS app** — a different product from FAVO. These were two separate payment systems, and earlier drafts conflated them.

**The premise that produced the native-app decision was: a website cannot reach a physical card reader.** Yoco's in-person *Payment SDK* ships for iOS and Android only, with no web build, and Yoco's own *in-person payments* starting page lists exactly those two options and says nothing about a web route. Anyone researching it properly lands on "apps only" and stops. That is what the 2026-08-20 decision rested on, and **it is a true statement about the SDK and a false conclusion about FAVO.**

> **OPEN-12 closed, 2026-09-07 · owner decision**
>
> **Yoco also publishes a Web POS API** — it sits in the API reference rather than the in-person guide — and it is a **browser- and server-driven card-present flow against a physical terminal**: four calls that create a device, look it up, send it an amount, and report the outcome. A payment carries a caller-supplied `client_reference`, echoes it back, reports `status` as `pending | failed | successful`, carries the terminal's `model` and `serial_number`, and can be **fetched server-side by id**. Yoco's public device lineup puts the café's machine — a large touchscreen that prints slips, the **Khumo Print family** — in the supported set.
>
> **Decision: FAVO builds the Web POS route and stays a web app.** The SDK route is recorded as considered and rejected. Its one remaining advantage — FAVO running on the Khumo's own screen, one device instead of two — is **unconfirmed and probably absent**: Yoco's SDK prerequisites say a merchant needs a card machine *"to pair with your application"*, and *pair* is the word Yoco uses for a phone connecting to a reader, not for software installed on a terminal. **That reading is inference from one sentence, not a confirmed fact**, and it is a question in the Yoco email.

|   | Website route — chosen | Installed app — dropped |
| --- | --- | --- |
| Wait on Yoco before starting | None. Self-service API key | Written application, then approval |
| New skills on the team | None — an ordinary server-to-server call | Kotlin or Swift, a native build chain, a bridge plugin |
| Devices on the counter | Till device + machine, as today | Same — see the caveat above |
| Shipping a fix mid-Sunday | Web deploy, minutes | Not possible. App Review is 1–2 days per version |
| Taps per Sunday sale | 3–4 | 7–9 until it ships, then 3–4 |
| Rough elapsed build time | 1–2 weeks | 6–12+ weeks, plus permanent overhead |
| Payment credential on the device | None — the secret stays server-side | A live payment credential in the app, needing Keychain, device enrolment and rotation |
| Reconciliation grain from day one | Transaction level | Day level until the native build shipped |

> **What this removes from the document**
>
> - **Phase 0, in full.** The double-entry flow, the two-device reconciliation step, the ≈7–9 taps per Sunday sale, the *Amount matches* / *Amount wrong* / *Not sure it went through* screen, the `receipt_suffix` join key, the day-grain reconciliation and the "a person vouches for it" gap in the audit trail.
> - **The native till workstream** and its dependency on Yoco's approval clock. v5.2's §9.10 — Capacitor wrapper, custom plugin, SDK secret custody, Secure Enclave device enrolment, `pos_devices`, Apple Business Manager, the certificate that expires quietly, the review build with a stubbed tender path — is **deleted**, replaced by the much smaller §9.10 below.
> - **The `tender_mode` cutover flag** and every rule that read it.
> - **A contradiction with §8.9.** v5.2 listed "native mobile apps" as a standing non-goal while §6.8.2 commissioned one. The non-goal now holds without exception.

#### 6.8.1 The seven rules, and which are FAVO's rather than Yoco's

Each rule is either sourced to Yoco's documentation or **explicitly labelled as FAVO's own reasoning or as standard card-present practice.** The distinction matters: an unsourced claim about payments is the class of error that gets built and then discovered in production with a customer's money in it.

| # | Rule | Basis |
| --- | --- | --- |
| P1 | **Write the order before asking for money.** `orders` → `order_items` → `payments` (`pending`, carrying `client_reference`) → *then* send. Never ask a machine to charge against something not yet written | **Forced by the API and by FAVO's own reasoning.** `client_reference` is caller-supplied and must exist before the send. Charge-first-then-write-fails leaves money with no order — the only state with no automated remedy. Write-first-then-send-fails leaves an unpaid order, which §6.0.5's close already handles |
| P2 | **Resolve an unresolved outcome by asking Yoco.** Never by sending again, never by asking the customer to tap again | **Yoco:** a Web POS payment is a server-side resource with an explicit status, fetchable by id. This is what makes S4 a lookup rather than a guess |
| P3 | **One reference per tender *attempt*, derived deterministically, never reused.** `client_reference = orders.client_uuid \|\| ':' \|\| payments.attempt`, stored on `payments.client_reference` (NOT NULL, UNIQUE) **before** the send. An unresolved outcome is recovered against *its own attempt's* reference; a declined card retried on another card is a **new** attempt, so a new reference | **The derivation is FAVO's; uniqueness is not optional.** A reference reused across attempts cannot distinguish which attempt a recovered payment belongs to. It buys **recoverability, not idempotency** (OPEN-10) |
| P4 | **The amount is frozen the moment the machine is asked.** Nothing in FAVO may alter an order's total once a tender attempt is open. A changed order means the attempt is resolved first — there is no void | **Standard card-present practice**, and enforced at a named point: `beginTender` (§11.2). `createOrder`, `compOrderLine`, `applyFreeCoffee` and `cancelOrder` all reject with `TENDER_IN_PROGRESS` while an attempt is `pending` or `unresolved` |
| P5 | **Reconcile daily, in both directions.** Yoco is the source of truth; FAVO holds a claim | §6.8.3 and T10. **Now at transaction grain from day one**, because every FAVO sale carries Yoco's own payment id |
| P6 | **Card data never enters FAVO.** §11.5's *"never log or echo PAN, CVV or expiry"* is enforced at the API boundary rather than left as a rule someone must remember | **FAVO's architectural reasoning plus standard card-present practice — NOT a Yoco assurance.** ⚠ **And weaker than under the SDK route:** the Web POS payment resource is reported to carry a **masked PAN**, so the guarantee is *path-dependent rather than structural*. §9.10.2 states the boundary as a rule with a named enforcement point |
| P7 | **The Yoco secret key never reaches the browser.** Every Web POS call is made by FAVO's own server | **FAVO's rule.** This is the largest security simplification the web route buys: there is no credential on the counter tablet at all, so there is nothing to enrol, mint, cache, rotate on a device, or grep out of a build |

**Never auto-re-send a payment.** §6.7 already says this and the Web POS API makes it stronger, because nothing in Yoco's documentation promises that two payments on one reference collapse into one. **The only path to a second send is S4 step 3's test** — the payment's own status resource reading `failed`, twice, at least 60 s apart, at least 120 s after the send. **A fetch error is never a licence to send again.**

#### 6.8.2 The four calls, the one unverified step, and the test that closes it

| Call | When FAVO makes it | What it does |
| --- | --- | --- |
| Create the device | Once, at gate zero | Registers a Web POS device named `FAVO Till` and returns its id, which goes into `app_config.webpos_device_id` (§10.4). One call, send a name, get back an id |
| Look the device up | Every 60 s while a session is open, and before each send | Reports the device's state and its terminal's `model` and `serial_number`. **This is what lets FAVO see the machine at all**, and it is what §9.6.3's card-machine alert and §6.7's device check read |
| Send a payment | Once per tender attempt (T2 step 4) | Sends `orders.total_zar` and `client_reference` to the device. **The machine lights up asking for a tap.** Returns the payment's id, which FAVO persists before it does anything else |
| Fetch the payment | Polling during tender (T2 step 5), then in recovery (S4) | Returns that payment's `status` — `pending`, `successful` or `failed` — with the amount charged. **Server-side, by id.** This is the whole of FAVO's recovery story |

> **The one step Yoco does not document**
>
> **How a physical terminal is linked to a Web POS device.** Creating the device is documented. Sending it a payment is documented. Fetching the result is documented. **The step that binds FAVO's device record to the Khumo standing on the counter is not**, and it is the single genuine unknown in this chapter.
>
> **Two possibilities and both are survivable.** If it is a self-service action in Yoco's merchant portal or on the machine itself, the chain works today and the payment chapter is proven within the hour. If it needs Yoco-side enablement or partner onboarding, **that is a delay, not a reversal** — and the SDK application will already be in the queue as the fallback (§13.1).

> **The gate — roughly one to two hours of one person's time**
>
> 1. Generate an API key in Yoco's developer console for FAVO's own business account.
> 2. Create a Web POS device named `FAVO Till`.
> 3. **Link the Khumo to that device.** This is the undocumented step and the reason for the email.
> 4. Send a **R1.00** payment to it and watch whether the Khumo wakes up asking for a tap.
> 5. **Count the taps FAVO's own screen costs** while doing it, and record whether a merchant confirmation is required in FAVO's browser. §05's Sunday budget is amended by this measurement rather than by an argument.
> 6. Let it decline, then take it off the wifi mid-payment, and record what the fetch returns in each case. **§6.8.4's error paths have never been observed** and this is the cheapest moment to observe them.
>
> **If step 4 works, the app is dead and the plan saves two to three months.** §15.1 carries this as a gate row.

> **One honest caveat about the tap count**
>
> Yoco's Web POS documentation describes the payment call returning a `redirect_url` *"that can be loaded into an iFrame, window, or new tab to accept merchant input via their browser."* **If that merchant input is required on every payment, the web route costs one tap in FAVO that the push-only ideal does not** — making the Sunday sale 5 taps rather than 4, still far inside today's ~3–4 plus the whole of Yoco's own app. It does not change the decision, and it is measured at step 5 of the gate rather than assumed either way. **The 4-tap figure in §05 is the optimistic end of a two-value range and is labelled as such.**

#### 6.8.3 Reconciliation — the control, not the report

**Yoco is the source of truth. FAVO holds a claim.** T10 is therefore a **control**, and it runs **daily** — the close already runs daily, and a discrepancy found at 24 hours is far cheaper than one at seven days, because the barista may still remember the transaction and at a week nobody can.

**Both directions, every day.** *Payments FAVO holds that Yoco does not* — should be impossible, checked anyway, because it is the signature of an S4 order recorded as paid on a lookup that matched the wrong thing. *Payments Yoco holds that FAVO does not* — the unresolved state (S4), and any retail sale rung outside FAVO's menu (S7d).

> **Transaction grain from day one, and the trap that no longer exists**
>
> v5.2 had to reconcile at **day level** throughout Phase 0, because FAVO and Yoco's own app both took payments on one merchant account and a transaction-level comparison would have flagged every Yoco-app sale as a FAVO discrepancy — *an alert that is noise inside a week is a control trained away before it was ever needed.*
>
> **That coexistence ends with Phase 0.** Every FAVO card sale now carries Yoco's own payment id from the moment the send returns, so anything without one is a real exception. **T10 reconciles transaction by transaction from the first Sunday**, and the only expected asymmetry is retail (S7d) and a standalone-machine settlement (§6.7 path B), both of which are reported as named informational lines rather than mismatches. The `receipt_suffix` match ladder — three ordered steps, keyed on the last four characters of a slip a barista typed — is **deleted**.

**The fee is still imported daily, and that is a real limitation.** `payments.fee_zar` is written by `importYocoTransactions` (§11.2) from Yoco's own transaction export for that revenue day, uploaded by an Admin at `/admin/reports`. **There is no automatic fetch**, because FAVO holds no verified Yoco credential for one and this document will not assume one.

⚠ **A named, untested improvement.** Yoco's REST API is reported to expose `GET /v1/payments/` returning `processing_fees` keyed on the client reference. If that is true, **the manual upload becomes unnecessary** and the daily import becomes a server-side fetch — closing the one regression §7.0.3 records against the incumbent, which prints fee and net per transaction on the day. **It has not been verified against a live response by anyone, so nothing in this document depends on it**, and it is a question in the Yoco email rather than a plan.

**The fee is never estimated from a rate.** §7.0.4 reads the actual per-transaction figure — the grounded day's 13 transactions carry fees of R0.53 on R20 and R1.32 on R50, which is not a constant percentage. `config.expected_fee_rate_bp` exists **only to flag anomalies**, never to compute a figure.

**Where more than one FAVO payment matches one Yoco record, or none does, the record is left unmatched and listed on T10 rather than guessed at.** The unmatched rate is reported daily.

#### 6.8.4 The error paths — the largest remaining piece of this chapter

> **Read this as new and unproven**
>
> **No failed card payment has ever been observed at FAVO.** All 13 grounded transactions succeeded. The web route saves FAVO nothing at all here: declines, timeouts, a customer who walks away mid-tap, a machine that drops off the wifi and a guard against double-charging all still need specifying, and that work was owed on either route. **This subsection is that work**, and step 6 of §6.8.2's gate is where it stops being reasoning and becomes observation.

| What happens | What FAVO sees | What FAVO does | What the barista sees |
| --- | --- | --- | --- |
| **The order's net charge is R0** [new in v7.0 · DEF-C] | Nothing — `beginTender` refuses before anything is allocated | **L42: no tender begins, in any mode.** No `payments` row is created, nothing is sent to the machine, and the order completes as `payment_mode='free'`. *Reachable in v6.0 with two taps — a Sunday single-line order comped to R0 under L33 sent R0.00 to the Khumo, and Yoco's rejection arrived as a generic gateway error, so the barista saw a broken card machine rather than a comped order* | The order goes straight to the queue, as a free order does. **No card prompt at all** |
| The customer taps and it works | Fetch returns `successful` with the amount charged | `payments.status='successful'`; assert the charged amount equals `orders.total_zar`; a mismatch is recorded **at the charged amount** and flagged to T10 | The tender screen clears; the order sits in the queue |
| The card is declined | Fetch returns `failed` | `PAYMENT_DECLINED`. The order **stays in `ordered`** with its queue position and target intact; no stock deducted; tender re-attemptable as a **new attempt with a new reference** (S3, P3) | *"Card declined — try again or use another card."* Nothing is re-rung |
| The customer walks away mid-tap | Fetch returns `pending` and keeps returning it, until the terminal gives up and the fetch reads `failed` — or until FAVO's **180 s** ceiling | If `failed` arrives first: as a decline. **If the ceiling arrives first:** the payment becomes `unresolved`, S4a pushes the Admin immediately, and **the order enters the queue anyway** — *fail open on the coffee*. FAVO does not attempt to cancel the payment, because there is no documented way to | Progress state, then *"We'll confirm this one shortly"* and a small *unresolved* marker. **The barista is not asked to wait and is never asked to charge again** |
| The machine is off, asleep, or off the wifi *before* the send | The device lookup fails, or the send is rejected with a device error and **no payment id** | `TERMINAL_UNREACHABLE`. **No payment resource was created and nothing was sent**, so the attempt is closed out and the order stays unpaid and re-tenderable | *"Card machine not responding — check it's on and on the wifi, or switch to deferred"*, with `setDeferredMode` one tap away |
| The machine drops off the wifi *after* the send | Fetch returns `pending`, then fetch errors, then eventually a status | **This is the case that must never be guessed.** A fetch error is not a status. The payment stays `unresolved` and is resolved by the job of §9.6.2 when the fetch succeeds again — which may be minutes or the next morning. **Never a second send on a fetch error** | As above. The order is made and served; the money settles on the record, not at the counter |
| Yoco's API is unreachable and returns an error with no payment id | An HTTP error, no id | `GATEWAY_UNAVAILABLE`. **This is the one payment failure where sending again is safe**, because no payment resource exists to have charged anything. FAVO offers the barista a retry rather than performing one | *"Couldn't reach the card system — try again."* |
| The send call *times out* | Nothing — no error, no id | **Treated as `PAYMENT_UNKNOWN`, never as `GATEWAY_UNAVAILABLE`.** A timed-out request may have been received; a payment may exist that FAVO holds no id for. Recovery is a fetch **by `client_reference`**, and the order is served in the meantime (S4) | As the unresolved case |
| Two successful payments against one order | Two `successful` resources found in recovery | **A double charge has already happened.** The payment attaches at the first, the order is flagged `duplicate_charge` to T10 **immediately**, and the Admin is pushed with both Yoco ids and the amount. **The database also forbids the second row:** `CREATE UNIQUE INDEX ON payments (order_id) WHERE status = 'successful'` | Nothing at the counter. Under L02 the only remedy is an L33 comp, and it needs a person **today** |
| A barista double-taps **Send** | Two `beginTender` calls | Refused. `beginTender` is **serialised per order** (`SELECT … FOR UPDATE` on `orders`) and returns `TENDER_IN_PROGRESS` while an attempt is open (S7b applied to tender) | *"This order is at the card machine — finish or cancel the payment first"* |
| The charged amount differs from the order total | Fetch returns `successful` with a different figure | Recorded **at the charged amount**, never at the asked amount, and flagged to T10 as a variance. **Never silently overwritten.** FAVO has no tip concept and suppresses any tip prompt the device offers, so a tip is a variance rather than a supported flow | Nothing at the counter; the Admin sees it on T10 the next morning |

> **There is no void**
>
> Yoco documents refunds, taking its own server-assigned payment id. **No page documents voiding or cancelling an unsettled authorisation as an operation distinct from a refund.** That strengthens L02 rather than weakening it: a same-day reversal was the obvious candidate for softening *"no money returns"*, and there is no cheap reversal to soften it with. **§12.1's L33 comp remains the remedy for a wrong charge** — which is exactly why L33 is capped, attributed and reported per barista. Consequently `voided` never enters the `payments.status` enum: §10.6 forbids reports that default on an unknown value, and a state FAVO can never observe is a state FAVO would guess at.

#### 6.8.5 What this costs, stated because it is real

- **The error paths above are reasoned, not observed.** Six of the ten rows describe a failure nobody at FAVO has seen. §6.8.2's gate observes three of them for R1.00.
- **Two facts remain unconfirmed** — the device-link step, and whether the supported-model list that includes the Khumo Print family is Yoco's rather than an integrator's. Both are in one email.
- **The PCI claim is weaker than it was.** Under the SDK route FAVO could say card data never entered the process, structurally. Under the web route the payment resource is reported to carry a masked PAN, so the claim becomes a boundary FAVO must *enforce* (§9.10.2) rather than a property it inherits. That is a genuine cost of the decision and it is recorded rather than glossed.
- **The fee still arrives a morning late**, unless the REST fee route turns out to work (§6.8.3). Until then §7.5's Day summary labels its fee and net lines *"settles overnight"* rather than leaving them blank or showing zero.
- **What it does not cost:** a POS fix is still a deploy, not a release. There is no App Review on the critical path of a bug fix, no certificate to expire quietly on a Sunday morning, and no payment credential on the counter tablet.

**How to confirm the incumbent seam in 30 seconds, today.** Watch one Sunday card sale: *does the barista type the amount into the machine's keypad, or does it already appear?* If they type it, the machine is standalone and paired to Yoco's own app — which is what FAVO is replacing.

### 6.9 The Untracked hot drink voucher [new in v7.0 · DEC-13]

#### 6.9.0 What happens today, and what it costs

HOFMI runs **Untracked Church**, a Sunday evening service to which members bring people who have not been before. Every first-time visitor is handed a **paper voucher for a free hot drink**, and they redeem it at FAVO around the service.

On the Yoco machine there is no such thing as a free coffee. There is a discount function, and reaching a 100% discount on it takes **roughly ten taps**, once per visitor, while a queue builds behind them. It is the slowest transaction the café performs and it happens on the evening the café most wants to look welcoming. *The ten-tap figure is an observation rather than a measurement and is on §16.1's list to be counted properly; §6.9 is right at six taps too.*

> **What else FAVO has, and why none of it fits**
>
> **L03 does not fit.** It is weekday-only, its beneficiary is a `customers` row with `status='office_staff'`, and it is DB-enforced `UNIQUE(customer_id, day)`. A first-time visitor has no customer record and will not be given one at the counter — that is typing, which §6.2.1's budgets forbid.
>
> **L33 does not fit, and forcing it would break something.** The comp is capped at two per barista per session with an admin PIN on the third, reported per barista on §7.3.1's write-down block. That cap exists because a comp is *unplanned*: its legitimate rate is zero and any volume is a signal. A voucher's legitimate rate is set by how many new people came to church, which nobody can predict, so the cap would block real visitors — and **every voucher that flowed through the comp path would dilute the only report that makes comping visible.**
>
> **This is the structural claim the whole section rests on.** A voucher is a paper slip the church issued and the café counts back; a fund draw is money an Admin already received and recorded. In both cases the barista's tap *spends something that already exists* — which is what separates them from L33's comp, and why **neither may be built on the comp path.**

#### 6.9.1 The mechanism — one tap, one unit

**A voucher discounts exactly one unit of one order line to R0**, written to `order_items.discount_zar` with a row in `voucher_redemptions`. It is the same shape as L03's entitlement and deliberately so: one mechanism, one arithmetic, one place to be wrong.

**One unit, not the line and not the order**, because the visitor who orders two coffees is buying one for the person who brought them. That is a mixed order — an R0 line beside a paid line — and FAVO already handles that shape; §15.1's FIXTURE-B carries a walk-in line beside a paid line for exactly this reason. The remainder still goes to the card machine.

**The voucher is not a tender.** It reduces what is owed; it does not pay it. If the order's net reaches R0, **no tender begins at all** — which is L42, and which DEF-C needed anyway.

> **The naming, and it is load-bearing — owner, 14 Sep 2026**
>
> *Untracked* is **the name of the service** — the Sunday evening one people are brought to for the first time. It is *not* a description of the mechanism, although the accident is that both things are true at once: the slip carries no serial and no per-person limit.
>
> |   |   |
> | --- | --- |
> | The service | **Untracked Church** — the Sunday evening service, an event profile (§6.11.2) |
> | The service | **Untracked Church** — the Sunday evening service, an event profile (§6.11.2) |
> | The paper slip | **An Untracked hot drink voucher** |
> | The paper slip | **An Untracked hot drink voucher** |
> | The chip on the POS line | `voucher` — short, because the line has no room for five words and the session already says which kind is live |
> | The chip on the POS line | `voucher` — short, because the line has no room for five words and the session already says which kind is live |
> | In the schema | A voucher of kind `untracked_hot_drink` under T12 |
> | In the schema | A voucher of kind `untracked_hot_drink` under T12 |
>
> **"Hot drink", not "coffee", and that is load-bearing too.** The slip is good for any item on the menu — Americano, Cappuccino, Mocha, Chai Latte or Hot Chocolate. That is *not* how L03's free weekday cup works, which is restricted to `eligible_free_categories` = coffee (T06). **A voucher kind carries its own eligible categories, and this one carries all of them** — a first-time visitor handed a slip and told "not that one" at the counter is the opposite of what the evening is for.

#### 6.9.1b Two traces, because the per-line rule is what makes both work

Both come from the counter and both confirm the same thing: **the voucher attaches to a drink, never to an order.** An order-level discount would get the first one wrong and would make the second one impossible.

| Trace | What happens | What the rule has to be |
| --- | --- | --- |
| T9 · A group of new people, one order | Five new people arrive together. Rather than five orders, the barista rings **one**: 2 × Hot Chocolate, 3 × Cappuccino, each drink configured as its owner wants it, each carrying its own slip. The whole order nets R0 | **Multiple vouchers on one order, and more than one on a single line** — 2 on the hot chocolate line, 3 on the cappuccino line. This is the case L41 is written for. Under L42 the order nets R0 and **never reaches the card machine at all** |
| T10 · A member brings a friend | A church member and a newcomer order together. The newcomer's hot chocolate is vouchered; the member's cappuccino is not. The order goes to the Khumo for the cappuccino alone and the member taps | **A mixed order — an R0 line beside a paid line**, with the remainder tendered normally. §15.1's FIXTURE-B already carries this shape for the walk-in case. The notification target is the member (L28), so the push lands on the person who is registered |

> **DEF-E — T9 walks straight into a defect that was live in v6.0**
>
> **L37 said "one line per menu item, carrying a quantity." That cannot be true.** `order_items` carries `shots` and `modifications` at *line* level, applied per unit (§7.0.2) — so two cappuccinos, one with macadamia and one without, cannot share a line. And L37's repeat-tap rule said a second tap on Cappuccino *flashes the existing line and never increments*, which left **no path at all to ring the second, differently-configured drink**.
>
> It was reachable by any order containing two of the same drink made differently — which on T9's five-person order is close to certain, and which the café does every Sunday.
>
> **Fix, carried into L37.** One line per **distinct configuration** — menu item + shots + modifications. A repeat tap flashes the line whose configuration matches what is currently selected; where none matches, it adds a new line. **The barista never has to think about it:** same drink made the same way lands on one line and steps up, same drink made differently lands on its own line. *This was v6.0's defect, not the voucher's, and it is fixed whether or not §6.9 ships.*

#### What T9 costs, and the one shortcut considered

- T9 as five separate orders — what a per-order discount would force: 5 × ( item · target · voucher · Place )  — **20 taps**
- T9 as one order, voucher tapped per drink — as specified: Hot Choc → qty + → voucher ×2 → Cappuccino → qty + + → voucher ×3 → Target · none → Place  — **12 taps**
- *Voucher every drink* — considered, not built: Hot Choc → qty + → Cappuccino → qty + + → Voucher every drink → Target · none → Place  — **7 taps**

> **Decided — owner, 14 Sep 2026: *Voucher every drink* is not built**
>
> It would be a convenience over the same mechanism — one tap, one `voucher_redemptions` row per unit on every line, each individually removable afterwards, **nothing about it an order-level discount.** But **one tap would give away an entire order**, which is the mis-tap concern §6.2.2 takes seriously.
>
> **T9 at 12 taps already beats the 20 that five separate orders would cost, and nobody yet knows how often a five-person group order actually happens.** Revisit after one Untracked Church evening with a count — the same posture §6.2.3 takes toward the shot default, and for the same reason: *a tap budget argued from a guess is not a budget.*

#### 6.9.2 The control is the paper, counted at the close

> **The design decision this section turns on — L43**
>
> **The barista takes the voucher and drops it in a tin. At `closeSession` the tin is counted, and the count is entered against that session.** A mismatch against `voucher_redemptions` raises the same Admin push as an L09 stock mismatch. That is the whole control — **no serial numbers, no codes to key, no QR to scan, no camera permission on the tablet, and not one character typed during a rush.**
>
> It is the same shape as the two controls this document already trusts: §6.8.3's two-directional transaction reconciliation, and the stock count that gates the close. *A physical count against a recorded count is a control FAVO already runs every day.*

| Question | Answer, and why |
| --- | --- |
| Does an uncounted tin block the close? | **No.** `opening_sessions.voucher_slips_counted` is NULL when nobody counted, and NULL is distinguishable from zero — the same discipline §7.0.2 applies to `fee_zar`. A forgotten paper count must not strand the close, which owes write-offs and stock reconciliation downstream. |
| What does a mismatch mean? | Recorded > counted means a redemption with no slip behind it. Counted > recorded means a slip taken without ringing the drink — a stock leak, not a money leak. Both are worth a look; neither is proof of anything. |
| Does the voucher expire? | **Printed, not modelled.** Print a *valid until* date on the slip and let the barista read it. FAVO counts what is surrendered; it has no opinion on when the slip was issued. Modelling expiry requires per-voucher identity, which requires a code, which requires typing. |
| What if someone redeems two? | Two slips, two taps, two rows, two units at R0. **There is no per-person limit because there is no person** — the voucher is the bearer instrument and the tin is the count. |
| What stops a barista tapping it fifty times? | The tin, the per-barista line on §7.3.1's write-down block, and an Admin digest line when a session crosses `voucher_expected_max_per_session` (T11, default 25). **It alerts; it never blocks.** L36's reasoning governs: a lockout during a service is a worse outcome than the abuse it prevents. |

#### 6.9.2a A slip is not worth a fixed amount, and what follows from that

> **Owner decision, 14 Sep 2026**
>
> **A voucher zeroes one whole unit — its listed price, its modifications and its extra shots.** `line_discount = line_unit_price`, which is exactly what L03 does for the free weekday cup. **There is one discount arithmetic in the product** and a barista never has to explain which parts of a drink a slip covers.
>
> The considered alternative — covering the listed price but charging for shots beyond the second — would have fixed a slip's value at one menu price. It was rejected for the reason that keeps recurring in this document: *a second rule for one fact is the defect DEC-03 exists to prevent.*

**So a slip is worth between R20 and R45** — R20 because that is the cheapest thing on the menu, and R45 because a Mocha at R25 plus two chargeable shots at R10 is the most expensive drink FAVO can produce. That is fine for the paper reconciliation, which was always a *count* control and never a value one — the tin holds slips, not rands, and L43 says so.

**But it opens a gap a fixed-value slip would not have.** A barista redeeming a genuine slip can step the shots up and hand a friend R40 of coffee where R20 was intended. The tin count still balances, because the slip is real and it is in the tin. Bounded at `(T15 − 2) × extra_shot_zar` — R20 a slip today — but invisible to every control in §6.9.2.

> **The mitigation is one extra column, and it is the L33 idiom exactly**
>
> **§7.3.1's write-down block reports vouchers per barista as *both* a count and a value** — so the average value per slip is visible without anyone computing it. A barista whose slips average R38 against everyone else's R21 shows up in the same glance that makes a comp pattern visible, and for the same reason: *with three baristas rotating, a pattern nobody can locate is a pattern nobody will find.*
>
> It costs one `COUNT` beside a `SUM` that already has to be computed for `vouchers_zar`. **It is not a cap and it blocks nothing.**

#### 6.9.3 On the POS

**A chip on the order line, beside the shot picker.** It reads `voucher`, it is one tap, and tapping it again removes it — which is the undo, and it costs nothing to build because it is the same toggle. **The line strikes through to R0 and reads `m of n`**, so a partly-vouchered line can never look fully vouchered (§6.2.4c).

**It renders only where a voucher kind is in force** (L48). On a weekday it does not exist: weekday coffee is already free, so the chip would buy nothing and could only be a mis-tap. Which sessions carry which voucher kinds comes from the event profile (§6.11.2) against T12's catalogue — config, not code, the same argument T06 makes for eligible free categories.

**No confirmation step.** L37 refused repeat-tap-increments because a stray tap was *silent* — discovered when the total was wrong, after the customer paid. A stray voucher tap is not silent: the line strikes through to R0 and the order total drops, both before Place. **The visible result is the confirmation.**

#### What it costs in taps

- Sunday card sale, single shot — §05's baseline: Item → Target · none → Place  — **3 taps**
- Voucher, single shot: Item → Target · none → voucher → Place  — **4 taps**
- Voucher, double shot: Item → shots · 2 → Target · none → voucher → Place  — **5 taps**
- The same drink on Yoco today, as observed: Item → … → discount menu → … → 100% → … → apply  — **~10 taps**

**§05 carries this as its own row rather than absorbing it** — *ring-up budget, Sunday voucher order: ≤ 4 single shot, ≤ 5 double.* **A budget that absorbs every new tap is not a budget.**

#### 6.9.4 What it does to the money, and the reclassification that matters

A voucher drink costs real beans, a real cup and a real lid. It deducts stock normally at `in_progress`, carries full `line_cogs`, and books R0 of revenue. On a Sunday, twenty vouchers is roughly **R140 of COGS against no income**.

§7.0.2's profit flag reads `contribution = collected − cogs − fees`. Left alone, **a well-attended outreach service makes the Sunday P&L go red** — and §03's mission frame says Sunday only has to not lose money, so the café would be flagged as failing at the one thing it is measured on, *on the evening it did its job.*

> **The fix is a reclassification, and it is net-neutral**
>
> **Voucher COGS is a ministry cost, not an operating cost** — exactly as `free_event_cogs` already is in §7.0.2's rollup. It comes out of the session's contribution line and goes into `ministry_cost`. Because `ministry_income` is the sum of contribution over paid sessions, both sides move by the same amount and **`ministry_net` is unchanged**. **Nothing is hidden:** the day still prints `cogs_zar` whole, with `outreach_cogs` as its own line beneath it, additive and visible — the same property §7.0.2 argues for on write-offs.
>
> What changes is what the Sunday flag *means*: it measures the thing the café controls, and the cost of the welcome is reported as a decision the ministry made.

#### 6.9.4a `searchCustomer` — the contract [DEF-F]

> **Why this sits in the voucher section**
>
> It does not belong to vouchers. **It belongs to push notifications**, and it is here because this is what surfaced it — the Untracked Church evening is the session with the most unregistered people *and* the most registered members bringing them, so it is where both halves of L28 get exercised at once. **§11.4's baseline-of-record rule is overridden for this action: the contract below governs, and any divergence at `9aefc2c` is a change to be made rather than a specification to be corrected** (COL-12).

| Item | Specification of record |
| --- | --- |
| Auth | Barista · Admin (§10.7, unchanged) |
| Request | `query: string` — trimmed, **fires at 2 characters**, ignored below that. Shorter is noise on a 63-person weekday list and a low-hundreds Sunday one |
| What it matches | **Given name, surname, or phone.** Case-insensitive and accent-insensitive — `thandeka` finds *Thandeka*, `Andre` finds *André*. Prefix match on names, and on the last four digits of a phone. *A barista mid-rush types three letters, not a full legal name* |
| Response | At most **10** results: id · display name · surname · `status` · whether today's free cup is already claimed · the customer's Favo. **No email, and no full phone number** — §9.4, and the POS has no use for either |
| Ordering | Exact name match first, then most recently served, then alphabetical. *The person a barista is most likely to mean, first* |
| Two people, one name | **Surname always renders beside the given name**, and where two results still read alike the last four digits of the phone are shown. A POS that offers two identical rows is a POS that binds the wrong target half the time — **and a wrong target is a notification sent to the wrong person, which is worse than none** |
| Zero results | An empty list, **never an error**, with `no notification` offered as an explicit adjacent choice. L28 says "none" is chosen and never defaulted into — *this is the screen where that rule is either honoured or quietly broken* |
| **It never blocks** | **L35.** Debounced at ~200 ms, issued in the background, and **the menu grid stays tappable throughout**. A barista may ring the whole drink while the search is still in flight and bind the target when it lands. *Nothing on the ordering path waits on this call — the rule already existed and nothing said it applied here* |
| Offline | `OFFLINE_UNAVAILABLE`, and the target falls back to `none` — already specified in T1 step 2, restated here so the contract is in one place |
| Errors | `AUTH_REQUIRED · OFFLINE_UNAVAILABLE · VALIDATION`. **A zero-result search is not an error** |

> **Why a missing contract mattered more here than it usually does**
>
> L28 requires every order to bind a notification target, and §05 measures it at **100%**. If a registered customer is not in the recents grid and search is slow, awkward or ambiguous, **the barista falls back to `none` — and §05's criterion still passes, because a target *was* bound.** The customer simply never gets told their coffee is ready. *That is R16's exact shape: everything looks like it worked.*

#### 6.9.5 Considered and rejected

| Option | Verdict |
| --- | --- |
| Serialised vouchers, code keyed at the till | **Rejected.** Four to six digits × every visitor, during a service, is the typing §6.2.1's budgets exist to eliminate. It buys per-voucher validity, which the tin count does not need. |
| QR code, scanned by the tablet camera | **Rejected.** A camera permission, a lighting dependency and a new failure mode on the one device the café cannot lose — for a control the tin already provides. *Reopen only if vouchers are ever mailed or issued outside the building, where the tin cannot be counted.* |
| Route it through `compOrderLine` with `comp_reason='goodwill'` | **Rejected, and this is the important one.** It would hit `COMP_LIMIT` on the third visitor, and it would put twenty legitimate free drinks into the one report that exists to make illegitimate ones visible (§7.3.1). |
| A hard cap per session | **Rejected.** The legitimate number is however many new people came. A cap set below it turns a visitor away; a cap set above it is not a cap. T11 alerts instead. |
| Register the visitor at the counter to use L03 | **Rejected.** It is typing, it is a data-collection step at the worst possible moment, and under §9.4 it creates a POPIA record of someone who came to church once. |

### 6.10 The blessing fund [new in v7.0 · DEC-14]

> **DEC-14 — taken, 14 Sep 2026**
>
> **§8.2 is narrowed and the fund is built in full, counter card top-ups included.** §8.2's body is replaced by §6.10.1's narrowed prohibition; **the clause is not deleted**, and what remains banned is listed there. **A barista can read a fund's balance and tell the donor** — an earlier draft routed that question to an Admin, which is the wrong desk when the donor is standing at the counter (§6.10.5).
>
> **Why a dated owner decision was required.** §8.2 was a standing prohibition, not a task — *"if a PR, ticket or design reintroduces a top-up or stored-balance concept, it contradicts this document — flag it, don't build it"* — confirmed emphatically on 2026-07-05 and re-verified complete on 2026-08-12. **This section could not be adopted by being well-argued.** Deleting §8.2 would have removed the only thing standing between FAVO and a customer wallet, which is a different feature, rejected on its merits, and not re-argued here. *Narrowing keeps the guard and moves the line.*

#### 6.10.0 What the café actually does today

Generous members hand over a set amount — cash or EFT — and tell the baristas to give coffee away to whoever comes. Separately, a group of people have an arrangement where one of them covers everyone's coffee.

**Both happen now, both are invisible to FAVO**, and both produce exactly the defect §02 names as the café's underlying problem: **drinks are made, beans and cups are consumed, and nothing is recorded.** The money already exists; what is missing is the ledger.

#### 6.10.1 What §8.2 banned, and why this is not it

|   | Customer wallet — §8.2, banned | Blessing fund — §6.10 |
| --- | --- | --- |
| Who holds a balance | Any customer. Potentially hundreds | **Named funds, opened at the counter against a confirmed payment.** Expected count: three to five |
| Whose coffee it buys | The balance holder's own | Other people's — given away, or drawn by a named group |
| How money gets in | Customer self-service top-up, in the app | **A card payment at the counter that Yoco confirms, or a cash/EFT gift an Admin records.** The balance does not exist until the money does. **No customer ever initiates a top-up** (§6.10.3, L44) |
| Refundable | Implicitly yes — it is the customer's own money | **No, and the donor is told so at intake.** This is what makes it a gift rather than a deposit, and it is the clause L02 would otherwise collide with (L45) |
| Effect at the counter | Adds a step — which is why packs went too (§8.3) | **Removes the card step.** One tap instead of a card interaction |
| Priorities served (§03) | Neither. Which is the stated reason it was cut | Both. P1 — fewer taps for the recipient. P2 — money and COGS that are invisible today become counted |
| Liability if abandoned | Unbounded, unresolvable, owed to individuals | Bounded three ways — a ceiling, a dormancy sweep, and non-refundability (§6.10.4) |

> **The narrowed prohibition — this is §8.2's body, and it keeps its teeth**
>
> **What stays banned, permanently:**
>
> - **No customer may hold a balance in their own name.** A fund is created for a purpose, with a name, by FAVO staff.
> - **No self-service top-up, by anyone, anywhere.** Not in the customer PWA, not at the POS, not by a link, not by a QR code. *This is the clause that prevents a customer wallet being rebuilt under a warmer name — the control is on the way in, because that is the only place money can be invented.*
> - **No balance is refundable in cash, ever.** An unspent balance resolves to ministry income, never to a bank transfer.
> - **No balance is displayed to a customer as money they hold.** A donor is *told* their balance by the barista, who can see it on the fund control; nothing is pushed to them, nothing appears in the customer app, and there is no screen they can open themselves.
> - **The word "wallet" still never appears** in UI copy, tickets or code comments. §13.3's enforcement grep stands unchanged.

#### 6.10.2 Linked names, and the one thing they decide

> **There is one kind of fund, not two**
>
> **A fund may have names linked to it, or none. That single fact decides everything else about how it behaves** — who may draw, and whether the barista has to ask. **No enum, no fund type to pick at creation, no second code path.** The two stories the café actually runs fall out of the data.

|   | No names linked | Names linked |
| --- | --- | --- |
| The story | "Here is R500, give coffee to whoever comes" | "I cover these people's coffee; they order all day" — **the group who would otherwise want a tab** |
| Who may draw | Anyone the barista chooses. Barista discretion, logged — the same posture as a walk-in (§6.5) | **Only a linked person**, matched at ring-up. Anyone else is rejected with `FUND_NOT_LINKED` |
| Applied how | Explicit tap on the fund chip. There is no signal to key it off — the recipient is usually unregistered | **Auto-applied on a matched name, declined in one tap** (owner, 14 Sep 2026) — L03's posture, for L03's reason: *a standing arrangement should not cost a decision every time.* The chip arrives lit and the state is visible before Place |
| May the payer drink from it? | Only by being linked — at which point it is the column to the right | **Yes.** Linking yourself is how the group's payer covers their own coffee, and it is the arrangement they already have |
| Who sees the breakdown | The Admin, on `/admin/funds`. **There is no donor-facing statement** (§6.10.5) |   |

> **Why linking a name does not smuggle the wallet back in**
>
> A linked payer puts money in and takes coffee out, which read one way is the banned shape exactly. What makes it not that is **where the control sits**: `no customer can create or top up a fund, including their own` (L44). The fund is opened against a gift whose arrival is externally proven, and it is capped by T13. **§8.2's danger was a *self-service, universal, refundable* balance** — remove self-service and refundability and what remains is a prepayment arrangement between the café and three named people.
>
> **This is also what replaces the group tab (§8.11).** The names on the fund are the account the coffees log to; the only difference from a tab is that the money arrives before the coffee instead of after.

#### 6.10.3 Money in — a card payment at the counter, and the balance waits for it

> **The risk this section exists to close**
>
> **A barista who can type a number into a fund can create money out of nothing**, and then spend it on drinks for friends. *That is L33's theft scenario with the cap removed and the ceiling raised — R900 of exposure becomes whatever they type.* Every control in this section follows from that sentence.

> **The mechanism that closes it — owner design, 14 Sep 2026**
>
> **The barista types the amount, it goes to the Khumo, the customer taps, and the balance does not exist until Yoco confirms the payment succeeded.** The card transaction *is* the external record. A typed number with no confirmed payment behind it is worth nothing and is visible to nobody — **so the barista is not creating money, they are asking Yoco to confirm that money arrived.**
>
> This is a stronger control than an Admin-only, cash-and-EFT-only path, and it is stronger for a plain reason: *a bank reference typed in by a person is an assertion, and a settled card payment is a fact that reconciles against Yoco's own export the next morning* (T10).

#### The flow, step by step

1. **Name it, or don't.** A single step with two buttons — *For specific people* or *For anyone* — and a name field. §6.10.2's linked names are set here and nowhere else, so the arrangement is recorded once rather than remembered by whoever is on shift.
2. **Type the amount**, and **confirm it on a screen that shows the figure large**. This is the one place in the POS that earns a confirmation step, and §6.10.5 says why.
3. **`beginFundTender`** allocates the attempt and freezes the amount, exactly as `beginTender` does for an order. The fund row is created now, with a balance of zero and a `pending` top-up against it.
4. **The amount goes to the Khumo** through the same `sendToTerminal` path, the same 180-second ceiling, and the same error paths of §6.8.4. **Nothing new is invented.**
5. **The reference is minted here.** P3 derives `client_reference` from `orders.client_uuid`, and a top-up has no order — so the fund top-up mints its own `client_uuid` on the same rule (`client_uuid:attempt`, UNIQUE). *Without it, S4's recovery-by-reference has nothing to look a timed-out top-up up by, which is the one case where the money is real and FAVO holds no id.*
6. **On `successful`, and only then, the balance becomes drawable.** A `declined` top-up leaves the fund at zero. An `unresolved` one shows on the fund as *pending*, contributes nothing, and resolves through S4's lookup like any other payment — **never by sending again.**

> **Why this is not the schema change §8.11 refuses — the distinction is the whole thing**
>
> §8.11 rejects the group tab because it needs **one payment against many orders**. That breaks the one-successful-payment-per-subject index, breaks T10's transaction-grain matching, breaks P4's single-subject freeze, and forces a fee to be apportioned across N records.
>
> A fund top-up needs **one payment against exactly one subject that happens not to be an order**. **The cardinality never changes.** `payments.order_id` becomes nullable under `CHECK (num_nonnulls(order_id, fund_topup_id) = 1)`, and every safeguard in §6.8 survives untouched: one successful payment per subject, one Yoco transaction to one FAVO record, one fee on one row. **A polymorphic subject is cheap; a multi-subject payment is not.** §10.2.1's two paths to `status='successful'` are unchanged — both are still Yoco lookups.
>
> It also *improves* reconciliation. Under an Admin-only cash design a card gift appeared in Yoco's export with nothing in FAVO to match it, landing on T10's exception list every time. **Now it matches a record.**

#### Two things this flow may not do

- **A top-up may not be rung on the same card tap as an order.** "One cappuccino and R500 on the fund" would be a payment pointing at both an order and a top-up — the multi-subject shape above, arriving through the back door. **Two transactions**, and the POS says so rather than silently refusing.
- **A top-up is not on the order path.** It lives behind the fund control, not on the menu grid, because it occupies the card machine for up to 180 seconds while people wait for coffee. That is the same block as any card sale and not a new class of problem — but **§05's budgets are about the ordering path, and this is not on it.**

#### The cash and EFT path stays

A gift that arrives outside the café — an EFT, or cash handed to the Admin — is still recorded by an Admin on `/admin/funds`, naming a `funding_method` and a `reference`, audited with the Admin's id and a reason. **A top-up with no reference is a `VALIDATION` failure, not a warning.** What is banned is unchanged and it is the load-bearing half of L44: **no customer initiates a top-up, ever** — every path runs through a barista at the counter or an Admin at a desk, and every one carries an external proof.

#### Every fund carries a code, and the unnamed ones are watched

**Every fund is issued a short code at creation** — `FVO-7K2M`, four characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`: 31 symbols, no `0/O` and no `1/I/L`, about 920,000 combinations against a few dozen funds ever, generated with a uniqueness check and a retry rather than a counter. Sayable out loud and writable on a card. **Named funds are found by name and the code is the unambiguous handle behind it; unnamed funds are found by code**, which is the whole reason it exists. One mechanism, not two.

**A code is a bearer handle, and that is a decision rather than an accident.** Anyone who can quote the code can draw against the fund. For amounts bounded by T13 in a church café that is acceptable — it is the same posture as the paper voucher of §6.9 — *but it is stated so that nobody later assumes the code is a secret.*

> **The risk the card payment does not close, and where it lands — R22**
>
> A confirmed card payment proves **money arrived**. It does not prove **who the fund is for**. A barista can ring a genuine R500 top-up from a real customer, attach it to an unnamed fund, and draw it down over a month. *Yoco reconciles perfectly.* This is the separation-of-duties property an Admin-only design would have had, it is given up deliberately, and it is worth naming rather than discovering.
>
> **What closes it is the name, which is why most funds having one matters.** A fund called *Louis Meyer* with Louis linked to it is a fund Louis asks about. An unnamed fund has no owner to notice — so **an unnamed fund raises an immediate Admin push at creation, naming the barista, the amount and the code** (§9.6.3). **It does not block:** a genuinely anonymous gift is a real thing and refusing it at the counter would be worse. *It is L36's posture — alert, attribute, never lock out — and it puts the one case with no natural watcher in front of the person who can be one.*

#### 6.10.4 The accounting, and the three ways the liability is bounded

When R500 lands in a fund, it is **not revenue that day**. It is revenue R20 at a time, as coffee is drawn. That is the treatment that keeps the Sunday P&L honest: *a fund-paid cappuccino is a cappuccino someone paid for, and it should read with normal margin* — not as a giveaway on the day it is drunk and a windfall on the day it was funded.

The consequence has to be stated plainly: **an unspent balance is a liability.** The café owes coffee. That is the property §8.2 was right to fear, and it is bounded three ways rather than waved at.

| Bound | Mechanism | Why that number |
| --- | --- | --- |
| Size | `donor_fund_ceiling_zar` (T13, default **R2,000**). A top-up that would carry a fund above it is rejected | About 100 coffees. Large enough for the generosity actually observed; small enough that a forgotten fund is a rounding error, not a problem |
| Time | `donor_fund_dormancy_days` (T14, default **180**). At 150 days with no draw the Admin is alerted so the donor can be asked. At 180 the balance is **proposed for sweep** to ministry income | Long enough that a generous gift is not quietly confiscated; short enough that the balance sheet does not accumulate people who left the church two years ago |
| Treatment [DEC-15] | A top-up is **money owed in coffee, not income**, until the coffee is drawn (owner, 14 Sep 2026, **pending a read by HOFMI's bookkeeper — which gates the fund's go-live and nothing else**). Each draw recognises its own revenue at normal margin | It is the only treatment under which "how much is left in my fund" is a real figure, and the only one that does not distort a Sunday on either the funding day or the drinking day |
| Fee | The fund is credited **the full amount tendered**; Yoco's fee flows to `processing_fee` exactly as it does on a coffee sale (owner, 14 Sep 2026) | No special case in the ledger, and nobody has to explain to a donor why R500 became R486.75. **It costs about one cappuccino's margin per R500** — R13.25 at §12.2's 2.65% |
| Direction | Non-refundable, stated at intake and recorded on the fund row as an explicit acknowledgement (L45) | It is what makes this a gift rather than a deposit, and it is the only reading under which L02's no-refunds rule and a stored balance can coexist |

> **The sweep must not be a job, and §12.3 is why**
>
> §12.3's universal invariants include *"no scheduled job may initiate a payment or create revenue."* A dormancy sweep that moved a balance into `ministry_income` on a timer would be **a scheduled job creating revenue** — a direct violation, and exactly the kind of quiet contradiction this document's registers exist to catch.
>
> **So the sweep proposes; an Admin confirms.** The job writes nothing but an entry on the Admin's task list. `sweepDonorFund` is an Admin action, audited with a reason. *The invariant survives intact, and a donor's unspent gift is never reassigned by a timer without a person looking at it — which is the right outcome on its own terms.*

#### 6.10.5 Money out — a tender, not a discount

**A fund draw is a way of paying, not a way of discounting.** The drink is sold at full price: `order_net_charged` stays R20, `line_gross` is untouched, margin reads normally, and `orders.payment_mode` becomes `donor_fund`. **Only *who* paid is different.**

That distinction keeps the fund out of §7.3.1's write-down totals for discounts, out of `comps_zar`, and out of `order_discount` entirely — and it is why a fund draw does not interact with L41's one-discount-per-line rule at all. **A voucher and a fund can appear on the same order without arguing:** the voucher zeroes one line, the fund settles what is left.

> **A fund draw never touches the `payments` table**
>
> §10.2.1 states that **exactly two paths may write `status='successful'`**, and both are Yoco lookups. **A fund draw is not a Yoco payment.** Writing one into `payments` would put a row into T10's two-directional reconciliation that Yoco's export can never match, *generating a permanent exception every time someone is given a coffee* — and would make the third path §10.2.1 exists to forbid.
>
> A draw writes `orders.payment_mode='donor_fund'` and one `donor_fund_entries` row. **Nothing else.**

#### Balance is derived, and the fund row is locked for the spend

There is no stored `balance_zar` column. **The ledger is the truth and the balance is `Σ entries`**, computed at the point of use — a cached balance that can drift from its ledger is the defect §6.6 spends a whole clause preventing between `price_history` and the event-window snapshot. `drawFromDonorFund` takes `SELECT … FOR UPDATE` on the fund row before computing, the same idiom `beginTender` uses to stop two taps allocating two attempts. FAVO has one writer (§8.4), so the lock is cheap and the sum is over a few hundred rows.

#### Insufficient balance: all or nothing

A fund with less than the order's net is **shown with its balance and not tappable** — the barista sees why, rather than tapping something that refuses. **There is no split tender between a fund and a card:** a partial draw is a second tender path against one order, and §6.8's whole apparatus assumes one. Error: `FUND_INSUFFICIENT`. A fund left below the cheapest live menu item renders as *empty*, because it is.

#### A draw settles the order, and settling freezes it

**The moment a fund pays an order, that order's total is frozen exactly as P4 freezes it during a card tender.** `compOrderLine`, `redeemVoucher`, `applyFreeCoffee`, a new line and a quantity step all return `TENDER_IN_PROGRESS` against a fund-settled order. *Without it the fund pays R40 for an order that is then comped to R20 and the difference is simply gone — the same failure P4 exists to prevent, reached by a path P4 did not previously watch.*

#### Cancelling a fund-paid order returns the money to the fund

**This is not a refund and L02 is not engaged.** No money leaves FAVO — the balance never left FAVO's control, and a draw that bought nothing is a ledger entry to reverse, not a payment to unwind. `cancelOrder` writes a compensating `adjustment` entry restoring the fund; **the original `spend` entry is never edited**, because the ledger is append-only for the same reason `stock_movements` is. From `in_progress` onward the cancel already needs an admin PIN and writes compensating stock rows (§11.3, T6) — the fund reversal rides that same path and the same audit row.

**A cancelled voucher order is the other way round.** The slip was surrendered and is in the tin, so the `voucher_redemptions` row survives the cancellation and the close's paper reconciliation counts it — *otherwise the tin would never match.* But `voucher_cups` and `outreach_cogs` read only redemptions on orders that reached `in_progress`, because a drink that was never made consumed no beans and no cup. ***Counted as paper, not counted as coffee.***

#### The one place a typo is worse than a wrong drink — R23

> **Why the top-up amount gets a confirmation step and a voucher tap does not**
>
> R5000 typed where R500 was meant, and the customer taps it. **L02 leaves no remedy** — there are no refunds, and L33's comped replacement drink cannot cover R4,500. *It is the sharpest risk in this section and it is one slip away, not one conspiracy away.*
>
> **Two guards, and the second is already in the design.** The amount is confirmed on a screen that shows the figure large before anything reaches the machine; and **T13's ceiling is checked before the send**, so a figure above R2,000 never reaches the Khumo at all. §6.9.3 refused a confirmation step for the voucher chip because its result is visible and reversible before Place. **This one is neither.**
>
> **And if it happens anyway, this is the one over-charge that is partly self-remedying** — the money is still the customer's to spend, as coffee, at their own pace. That is a materially softer failure than R4,500 charged for a cappuccino, *and it is the only place in FAVO where L02's "no remedy" has any give in it at all.*

#### No donor statement, and what carries the control instead

> **Owner decision, 14 Sep 2026 — recorded because it removes a control**
>
> **There is no monthly push and no in-app statement to the donor.** One was proposed and argued to be the best control in this section — barista discretion over someone else's money watched by the person most motivated to notice. *That argument was not wrong; it was outweighed.* With three to five funds in a church this size, a push notification is machinery for a question a person can ask.
>
> **What carries the control instead:** `/admin/funds` shows every fund's balance, ledger and last draw; §7.3.1's write-down block gains a per-barista fund-draw line; and every entry is audited with the staff member who wrote it.
>
> **And the donor simply asks at the counter** (owner, 14 Sep 2026). The barista can read a fund's *balance* — it is already on the fund control — and tell them. **Balance only: the ledger, the draw history and the member list stay on the admin surface**, so a barista can answer "how much is left" and not "who has been drinking it."
>
> **What is given up, stated plainly:** the payer of a fund with linked names cannot see *who* drank what without asking an Admin — the barista can give them a number, not a breakdown. *If that becomes a weekly question, the narrowest fix is a read-only view scoped to the fund's own owner — a screen, never a push — and it is not built until someone asks twice.*

#### 6.10.6 On the POS

> **The footer never carries more than two tender chips, at any number of funds**
>
> **A linked fund is never chosen. It is determined by who the coffee is for.** The barista binds the person as the notification target — a tap L28 makes them spend anyway — and the fund follows from that person's membership. **A linked group's draw costs *zero* selection taps**, because there is nothing to select.
>
> **Every open fund collapses to one chip.** An open fund has nothing on the order to key off — the recipient is usually a stranger — so it needs an explicit tap. But it never needs a *choice*: one chip naming the fund FAVO will draw from, with `+4` after it when there are four more behind it.
>
> **So the footer holds at most two: the linked fund, and the open fund.** That is true at two funds and true at twenty, *and it is the property that makes the count stop mattering.*

> **They are a radio, not a reveal**
>
> **Both chips are shown, one is lit, and tapping the other switches.** The linked fund arrives lit. Tapping the open fund moves the order to it; tapping the lit chip turns it off and the order goes to the card. **One tap for every outcome, and no state the barista cannot see.** *A linked person can always pay their own way, and can always be blessed from an open fund; there was never a rule against either, only a needless tap and a hidden option.*
>
> **L48 is not in tension with this.** L48 hides a control that *cannot* apply — a fund chip on an order owing nothing. Both of these can apply. *Hiding an available option is a different act from hiding an impossible one, and only the second is L48's business.*

#### How FAVO picks, when there is more than one open fund

**Oldest unspent gift first, among funds that can cover the order.** One donor gave R500 in March and another R200 in August; the March money is spent first.

**The reason is not tidiness, it is that the alternative quietly wrongs a donor.** If the barista always taps whichever tile is on top, one fund drains and another sits untouched until T14's dormancy sweep takes it to ministry income — *a gift given to buy coffee, ending up as a general donation because of tile order.* Oldest-first means every gift gets used for the thing it was given for, and the sweep machinery fires far less often.

**Considered and not chosen:** largest balance first, which is easier to explain and concentrates draws on whichever fund was topped up most recently — the same failure, one step removed. **A fund that cannot cover the order is skipped rather than offered**, because there is no split tender (§6.10.5).

| At the counter | What the footer shows | Selection taps |
| --- | --- | --- |
| Stranger, any number of open funds | One chip: `Blessing fund · Louis M. · R340 · +4` | 1 |
| Stranger, no open fund can cover the order | **No chip at all** (L48). Not a chip that refuses | — |
| A linked person, ordinary case | `Thandeka's group · R180` arrives **lit**, beside the open-fund chip | **0** |
| A linked person who wants to pay today | Tap the lit chip. It goes dark, and the order goes to the card | 1 |
| A linked person, blessed from an open fund instead | Tap the open chip. It lights, the group chip goes dark | 1 |
| A specific donor says "use mine, not Louis's" | **A second tap on the already-lit chip** opens the list — every open fund, its balance and its code. *Not a long-press: §17.6 carries no long-press anywhere else in the POS, and a gesture that appears exactly once is a gesture nobody remembers with wet hands* | 2 |

#### What changes at five funds — and the honest answer is almost nothing

**The counter does not change at all.** One chip for open funds and one for the linked fund, whether there are two funds or twenty. Growth lands entirely on the override list, which is where it belongs: a screen the barista opens deliberately, on the rare occasion a specific donor is standing in front of them.

**Five funds is not five chips, and it is usually not even five open funds.** Linked funds never appear in the open list — they are reached through the person, not through a picker — so a café running two group funds and three open ones has *three* entries behind the chip, and still one chip on the footer.

**The queue drains faster than dormancy, and the arithmetic is checkable.** Five funds at R500 is R2,500 of coffee. At roughly three giveaway draws a day the whole queue cycles in about **42 days** — comfortably inside T14's 180. *The fifth donor's gift is used well before it is ever at risk of being swept, which is the property oldest-first exists to produce.*

**What a donor at the back of the queue should be told, and where.** `/admin/funds` lists the funds in draw order with each one's position and a rough depletion estimate from the last thirty days' rate. It costs one ordered query and it is the only honest answer to "has my money helped anyone yet?" — which, at five funds, someone will ask.

> **The one thing that *does* scale, and it is not the UI — R24**
>
> T13 caps each fund at R2,000. **It does not cap the total.** Five funds is up to R10,000 of coffee owed — around 500 cups — held as deferred income by a café whose Sunday target is to break even. *That is a larger obligation than anything else in this document.*
>
> **An Admin daily-digest line on total live balance across all funds**, defaulted around R5,000 — **not a block.** A block would refuse a generous person at the counter, which §6.9.2 already rules out for vouchers on the same grounds. *The alert simply means nobody discovers the number for the first time at an audit.*

> **One customer, at most one active linked fund — enforced, not assumed**
>
> If a person could be linked to two funds, the barista would face a choice mid-rush about someone else's money, with nothing on screen to decide it by. **A partial unique index on `donor_fund_members(customer_id)` over active funds** removes the question rather than answering it. *Moving someone between groups is an Admin unlinking and relinking, which is a thing that happens at a desk and not at a counter.*

- Open fund — a stranger, any number of funds live: Item → Target · none → Blessing fund → Place  — **4 taps**
- Linked fund — the group, matched from the recents grid: Item → Name · from grid → Place  — **3 taps**
- Linked person paying their own way today: Item → Name · from grid → tap the lit chip off → Place  — **4 taps**
- Open fund, overriding FAVO's pick — five funds or two, same path: Item → Target · none → Blessing fund → which one → Place  — **5 taps**

- **One control, not a row of tiles.** The footer carries a single `Blessing fund` control naming the fund FAVO will draw from; the full list is one tap deeper and exists for the override.
- **A linked-name draw costs nothing extra**, because that person is bound as the notification target anyway (L28) — the tap is already spent, and the fund keys off it.
- **No fund draw on an order with no net charge.** A weekday office-staff cup is already free; drawing a fund for it spends real money on a drink nobody was going to be charged for. Error: `FUND_UNAVAILABLE`, with the reason named.
- **A fund-paid order never reaches the card machine**, so it carries no processing fee — about **R0.53** better than the same drink on a card at §12.2's 2.65%. Small, real, and it accrues to the fund's purpose rather than to Yoco.

#### 6.10.7 Considered and rejected

| Option | Verdict |
| --- | --- |
| Revenue on receipt — book R500 as income on the day it is given | **Rejected.** Simplest, and it makes every drawn coffee read as a giveaway on the day it is drunk. The Sunday flag would go red for a drink that was paid for in full. |
| A stored `balance_zar` column | **Rejected.** A cache that can drift from its ledger, for a sum over a few hundred rows on a one-writer system. §6.6's two-records-one-truth argument applies and the cache buys nothing here. |
| Admin-only top-ups, cash and EFT only | **Superseded, 14 Sep 2026.** It refused the card path on the grounds that `beginTender` is per-order. That was true and *the conclusion did not follow*: a top-up needs a payment against *one* non-order subject, not against many, and §6.10.3's `CHECK` is the whole of the change. **A settled card payment is also a better proof than a typed bank reference.** |
| Ringing a top-up and a drink on one card tap | **Rejected.** It is §8.11's multi-subject payment arriving through the back door, for the convenience of one tap. Two transactions. |
| Split tender — fund covers what it can, card takes the rest | **Rejected.** Two tender paths against one order, in a chapter whose every safeguard assumes one. *Reopen only with evidence that funds routinely run dry mid-order.* |
| No dormancy sweep at all | **Rejected.** A balance with no resolution path becomes a permanent line item belonging to someone who has moved churches. T14 is generous and tunable; the answer to "180 days is too short" is a config change, not an unbounded liability. |
| Calling it a wallet | **Rejected.** §8.2's prohibition on the word is doing real work — *it is what makes a PR that drifts back toward the banned feature visible in review.* The POS says **Blessing fund**; the schema says `donor_funds`. |

### 6.11 Sessions, and the Untracked Church profile [new in v7.0 · reverses a v6.0 decision]

> **Owner decision, 14 Sep 2026**
>
> **A revenue day carries as many sessions as it needs.** v6.0 narrowed `opening_sessions` to `UNIQUE (session_date)` and dropped the reopening concept — *decided against a Sunday with one window, before anyone had said there is a second service.*
>
> **Untracked Church is an event profile of its own, and it carries the voucher switch.** The free slips and everyone-pays happen there and essentially nowhere else, so the behaviour belongs to that profile rather than being inferred from the day of the week.

#### 6.11.1 v6.0's objection was good, and this is the answer to it

v6.0 gave a specific reason for the narrowing, and it has to be met rather than overruled: *"`NO_SESSION` is satisfied by any row, while mode is 'the day's mode' and `deferred_since` is session-scoped — so with three rows for one Tuesday, nothing says which carries the mode or which the deferred banner reads."*

> **At most one session is open at a time**
>
> **The ambiguity was never about how many rows a day has. It was about how many are open at once.** Sessions are sequential, not concurrent: a day may hold a morning session and an evening session, and **the second cannot be opened until the first is closed.**
>
> So *the current session* is a definition, not a search: **the one open session, or none.** Mode, `deferred_since`, `voucher_kinds_active` and the barista on duty all belong to it unambiguously, and `NO_SESSION` means exactly what it meant before — *no session is open.*

| Change | Detail |
| --- | --- |
| The constraint | `UNIQUE (session_date)` → `UNIQUE (session_date, opens_at)`, plus a **partial unique index allowing at most one open session across the whole table** — `UNIQUE (tenant_id) WHERE closed_at IS NULL`. *The second is what makes "the current session" a definition* |
| How much of this is new work | **Less than it reads.** At `9aefc2c` the shipped table is already `unique(session_date, opens_at)` with `addTodaySession`, `updateTodaySession` and `getTodaySessions` (plural). v6.0 commissioned a migration to narrow it. **This is largely *not doing* part of that migration** — the one genuinely new object is the one-open-session index (§13.2, COL-14) |
| `openSession` | Rejects with `STALE_STATE` **while a session is open**, rather than while a row exists for today. *A second session on the same date is the normal path, not an exception* |
| `closeSession(id)` [new] | Ends the current session: sets `closed_at`, **prompts for that session's voucher slip count**, clears session-scoped state. **Distinct from `closeDaily()`**, which stays per revenue day and owns the write-off sweep, stock reconciliation and `daily_closes` |
| Deferred mode | Session-scoped, as v6.0 already has it — **and now genuinely so.** A card machine that was off the wifi in the morning does not carry a deferred banner into the evening; the evening session declares its own state, which is the behaviour §10.3 argued for and could not previously deliver |
| The tin count | Moves to `opening_sessions.voucher_slips_counted`, **per session**. `daily_closes` aggregates and stores no count of its own. *A morning with no vouchers and an evening with twenty-three no longer share one number that means neither* |
| T11's alert | Per session, which is what the tunable always said and could not previously mean |
| The rota | `barista_shifts` keys to **the session** rather than the date, and §6.3's shift-start push fires per session. *Louis works the morning and Nkuli works Untracked Church; without this the evening barista is never told they are on* (COL-23) |
| Order numbers | **`daily_seq` runs across the whole revenue day and is never restarted** — the evening's first order is `#38`, not `#1`. It is `UNIQUE (revenue_day, daily_seq)`, so the alternative a barista would assume breaks the constraint and collides with the morning's numbers on every settlement lookup (COL-30) |
| Reporting | Every §07 figure gains a session grain beneath the revenue day, and **contribution is computed per session and summed** (COL-10). Morning and evening are separately readable — and given §6.9.4 moves voucher COGS to `ministry_cost`, an outreach evening's economics become visible instead of averaged into a Sunday |

> **Two things this must not break**
>
> **L07 still owns the revenue day.** Sessions sit inside midnight-to-midnight SAST and never straddle it. *A session running past midnight is a session that failed to close, not a new day* — `closeSession` is forced at the day boundary and the event is audited.
>
> **The close is still once a day.** `closeDaily()` runs after the last session and owns everything it owned before: the write-off sweep (S3a), stock reconciliation (L09), `daily_closes`. **A deferred order from the morning is not written off when the morning session closes** — it has all day to be settled, which is what §6.7's settlement path assumes.

#### 6.11.2 The Untracked Church profile

A §6.6 **Path A recurring event profile**, defined once and found automatically every week — which is §6.6's own argument: *"a weekly event that needs setting up every week is a weekly opportunity to forget, and the day it is forgotten the café silently charges people who should not pay."* That sentence was written about Discipleship 101 and it describes Untracked Church exactly.

| Switch | Untracked Church | Why |
| --- | --- | --- |
| Menu scope | Full | Evening service, full menu as on a Sunday morning |
| Payment posture | `standard` | Everyone pays normal prices — the owner's words, *"everyone paying usually only happens at Untracked"* |
| Cup & lid | Consumed | Disposables, as at any service |
| Broadcast audience | Office staff + church members | Both are invited and both bring people |
| Extra-shot surcharge | Charged | A paid session; T09 applies as on a Sunday (§6.2.3) |
| **Voucher kinds** [the sixth switch] | `["untracked_hot_drink"]` | **The new one, and the reason this profile exists.** It puts the voucher where the vouchers actually are, rather than deriving it from the day of the week |

> **Where the live voucher kinds come from**
>
> The profile is the primary source, and **the session snapshots the value at open** onto `opening_sessions.voucher_kinds_active`, per §10.4's rule that config is recorded onto the row it affects. **T12 keeps the *catalogue* of kinds; the profile decides which are live.** *A Christmas or invite-a-friend voucher is a config row and a switch, not a migration.*

#### 6.11.3 What a Sunday looks like

|   | Morning | Evening — Untracked Church |
| --- | --- | --- |
| Session | Session 1, mode `sunday` | Session 2, mode `event`, window = Untracked Church |
| Opened by | The morning barista, one tap on the defaulted mode | The evening barista, one tap — **the profile is found by the session's own window**, so opening at 17:45 for an 18:00 start still matches it (COL-8) |
| Vouchers | **None.** No voucher chip renders on any line (L48) | Live. The chip is on every line |
| Payment | Card, everyone | Card, everyone — plus vouchered drinks at R0 |
| Tin counted | n/a — no vouchers, so the count is not prompted | At `closeSession`, against that session's redemptions |
| Order numbers | `#1` onward | **Continues** — `#38`, not `#1` (COL-30) |
| Reported as | Sunday | An event column (§6.6), with its voucher COGS in `ministry_cost` (§6.9.4) |
| Written off | Neither. `closeDaily()` runs **once**, after the evening session, and sweeps the whole day (L07, S3a) |   |

## 07 — Cost management · Priority 2

### 7.0 The arithmetic, worked once

> **This section governs**
>
> Priority 2's whole purpose is a number the owner can trust. Until v5.1 this document specified the *dashboards* that display those numbers and none of the arithmetic that produces them — no menu price, no ingredient cost, no recipe quantity, no worked calculation anywhere. **Every formula, price and cost input is stated here and every figure is hand-checkable.** Where §7.1–§7.5 or any implementation disagrees with the arithmetic here, this section governs.

#### 7.0.1 Menu prices

Prices are held in `menu_items.current_price_zar` and versioned through `price_history`; the values below are the live prices as at **2026-08-16**, stated so every figure in this section can be recomputed by hand. **A price change is a `price_history` row, never an edit to this table.**

| Item | Price | Notes |
| --- | --- | --- |
| Americano | **R20** |   |
| Cappuccino | **R20** | The base price, **at one *or* two shots** (DEC-16). The R10 extra-shot surcharge (T09) starts at the third and applies **from the first Sunday after this document is signed off** — it was not in force on 2026-08-16, which is why §7.0.3 shows both configurations at R20 *and why that fixture survives DEC-16 unchanged* |
| Mocha | **R25** |   |
| Hot Chocolate | **R20** |   |
| Chai Latte | **R20 — unconfirmed** | On the menu; **no sale on 2026-08-16, so no grounded price.** The dev seed carries a different figure. Confirm before go-live; §13.0's seed-verify step is the gate |
| Extra-shot surcharge | **+R10 per shot beyond the second** | T09 · Sundays and switched-on events only (L31, DEC-16). **Not in force on 2026-08-16.** *Every price above is the price at one or two shots* — a cappuccino is R20 / R20 / R30 / R40 across the picker, and the most expensive drink the menu can produce is a four-shot Mocha at **R45** |
| Macadamia | **R0** | Never an upcharge to the customer — but **not free to FAVO**, which is the point of §7.0.1b's second gap |

#### 7.0.1b Cost inputs — estimates, by decision, and the label that makes it safe [OPEN-06 closed]

> **The decision**
>
> **Put Nikao's best figures in and ship on them, so the profit indicator works end to end rather than sitting dark.** Waiting for an invoice-backed cost table before Priority 2 shows anything means the one number Priority 2 exists to produce is unavailable for as long as it takes to collect real invoices — and an unavailable number teaches nobody anything.
>
> **The condition attached, and it is not optional.** The indicator stays visibly labelled *provisional* until an invoice-backed table exists, and **that label is wired to a data-quality field on the cost table — not to a date and not to a developer remembering.** This keeps closed the risk v5.2 warns about: numbers that look authoritative before they are trustworthy.

> **The mechanism — `cost_source`**
>
> **Every ingredient lot carries `inventory_lots.cost_source`, an enum of `estimate | invoice`, NOT NULL, defaulting to `estimate`.** It is set to `invoice` only by an Admin recost through `/admin/yield`, and that transition is audited.
>
> **Any drink containing an ingredient whose `cost_source = 'estimate'` renders its margin as *provisional* and never green** — §17.6.1's `--status-warn`, never `--status-success` — with the warning and a link to the recosting screen. Any period containing such a drink renders its profit flag *provisional* the same way. The flag turns green only when every contributing lot is invoice-backed. **This replaces the `cost_estimated` boolean v5.2 commissioned** (and which was never built — verified absent from the schema), because a boolean records that a number is doubtful and an enum records *why*, which is what an Admin needs in order to fix it.
>
> **A green flag computed from estimated costs is worse than no flag, because it invites a funding decision.** That is the whole reason this condition is attached to the decision rather than left as guidance.

**The figures the app actually runs on**, extracted from `db/seed/recipes.ts` and `db/seed/lots.ts` at `9aefc2c`. They are not FAVO's real financials, and stating them here closes the *specification*, not the *numbers*.

| Drink | Recipe |
| --- | --- |
| Americano | 1 cup beans · 1 × 8oz cup — **no lid** |
| Cappuccino | 1 cup beans · 1 cup whole milk · 1 × 8oz cup · 1 lid |
| Mocha | 1 cup beans · 20 g chocolate · 1 cup whole milk · 1 × 12oz cup · 1 lid |
| Hot Chocolate | 20 g chocolate · 1 cup whole milk · 1 × 12oz cup · 1 lid |
| Chai Latte | 10 g chai · 1 cup whole milk · 1 × 8oz cup · 1 lid |

Beans and milk deduct **one cup per drink** from the open container regardless of recipe quantity — the container model, L17. *Americano drawing a cup and no lid independently confirms §7.4's lid claim, arrived at separately.*

| Item | Unit cost (¢ per base unit) | Basis | cost_source |
| --- | --- | --- | --- |
| Beans, per cup | 321.4286 | R450/kg ÷ 140 cups | estimate — **disputed, see gap 1** |
| Whole milk, per cup | 509.0909 | R28/L ÷ 5.5 cups/L | estimate |
| 8oz cup | 120.0000 | R1.20 | estimate — most trustworthy figure here |
| 12oz cup | 150.0000 | R1.50 | estimate |
| Lid | 80.0000 | R0.80 — **matches §7.4 independently** | estimate |
| Chocolate, per g | 0.1800 | R180/kg | estimate — **scale disputed, gap 3** |
| Chai, per g | 0.2000 | ~R200/kg | estimate — **scale disputed, gap 3** |
| Macadamia · oat · almond milk | **0.0000** | ⚠ **not seeded — gap 2** | missing entirely |

| Drink | Seed COGS | Yoco's implied COGS | Delta | Price | Margin (seed) |
| --- | --- | --- | --- | --- | --- |
| Americano | R4.41 | **R9.96** | **+R5.55** | R20 | 78% |
| Cappuccino | R10.31 | R12.56 | +R2.25 | R20 | 48% |
| Mocha | R10.64 | R14.05 | +R3.41 | R25 | 57% |
| Hot Chocolate | R7.43 | R7.65 | +R0.22 | R20 | 63% |
| Chai Latte | R7.11 | — | — | R20 | 64% |

Yoco's column is derived from its own gross-profit figures. **The two sources disagree by up to R5.55 a drink — 126% on Americano — and agree to 22c on Hot Chocolate**, which suggests milk, cup, lid and powder are broadly right and **the bean cost is not.** If Yoco's Americano cost is beans + cup, its bean figure is ≈R8.76/cup against the seed's R3.21. **Neither source is authoritative:** the seed is a self-declared estimate and Yoco's cost fields are whatever was typed into its catalogue, possibly including a double shot. **The margin column above is indicative only.**

#### The two defects that get fixed regardless of estimate quality

> **Both are gate-zero items, not OPEN-06 residuals**
>
> 1. **The bean cost, urgently.** The two sources differ by ~170% on the input that appears in every coffee. Nikao reconciles it against a real invoice or Yoco's implied figure and records which; the lot's `cost_source` becomes `invoice` only if a real invoice backs it.
> 2. **Three alternative milks cost `0.0000`** — oat, macadamia **and** almond, not macadamia alone. Macadamia is free *to the customer*; it is not free to FAVO, and it is FAVO's only alternative milk on the menu, so it is the **most-ordered substitution.** Under §7.0.2's refusal rule this fires immediately: **every margin figure reads UNAVAILABLE until the three milks are seeded**, which makes seeding them a gate-zero item rather than something to carry.

#### The two gaps that stay open as data questions

> **Gap 3 — the powder scale, live and unresolved**
>
> `db/seed/lots.ts`'s header converts wholesale prices wrongly by 100× (*"R450/kg → 0.4500 ¢/g"*; R450/kg is **45 ¢/g**). **For beans and milk the error is harmless**, because the recipes reference the correctly-scaled *container* items. **For chocolate and chai it is live:** the recipes bind to the *gram* items at 0.1800 ¢/g and 0.2000 ¢/g, so every powder cost in this section is understated ~100× *if* the header's rand prices are right.
>
> **The two drinks disagree about which scale is right, which is why this is a data question and not a correction.**
>
> | Drink | As seeded | At 18 ¢/g | Yoco implied | Effect of correcting |
> | --- | --- | --- | --- | --- |
> | Mocha | R10.64 | **R14.21** | R14.05 | R3.41 → **R0.16** — almost exact |
> | Hot Chocolate | R7.43 | **R10.99** | R7.65 | R0.22 → **R3.34** — moves *away* |
> | Chai Latte | R7.11 | R9.09 | — | no Yoco figure to test against |
>
> **No single chocolate price reconciles both drinks**, so something else differs — a recipe quantity, or Yoco's catalogue costs having been typed independently. **This document states both figures and adopts neither.** Correcting the scale would move the §7.0.3 fixture's `cogs_zar` from R196.36 to **R210.61** and `contribution` from R144.37 to **R130.12** — a **9.9% swing**, which is exactly why it may not be done on a guess.
>
> ⛔ **§13.4 must NOT delete "the orphaned gram/ml lots" as a class.** Only `lot_espresso_beans_001` and `lot_whole_milk_001` are orphaned. **Deleting the powder lots would remove chocolate and chai from the cost model entirely.**

> **Gap 4 — whether Yoco's cost figures include the double shot**
>
> If they do, the Americano delta shrinks and the reconciliation changes shape. It is one line in the Yoco email.

#### 7.0.2 The formulas

All money is integer cents. All quantities are in the recipe's own unit.

```
ORDER
  line_unit_price   = order_items.unit_price_zar    -- THE PRICE SNAPSHOTTED AT RING-UP, never the live
                                                   -- menu price. Integer NOT NULL at 9aefc2c; createOrder
                                                   -- already writes it from menu_items.current_price_zar
                                                   -- at the moment of the sale.
                    + line_mods_zar                -- priced modifications, PER UNIT
                    + surcharge_zar                -- extra-shot surcharge, PER UNIT (L31/T09)

  line_mods_zar     = Σ over order_items.modifications ( price_delta_zar )
                                                   -- jsonb, written at ring-up as a SNAPSHOT, so changing a
                                                   -- customisation's price later never re-prices a past order.
                                                   -- This is the term the alternative milks ride on.

  surcharge_zar     = config.extra_shot_zar × MAX(0, order_items.shots − 2)   -- PER UNIT
                        WHERE the surcharge is in force — every Sunday, and events whose
                              extra_shot switch is set (T09, DEC-16, L31)
                      ELSE 0
                      -- WAS: a flat R10 where shot = 'double'. One and two shots are the listed
                      -- price; the THIRD is the first one anybody pays for (§6.2.3).

  line_gross        = order_items.quantity × line_unit_price
  order_gross       = Σ line_gross
  order_discount    = Σ line_discount              -- free-coffee entitlement (L03) or comp (L33)
  order_net_charged = order_gross − order_discount -- what the card machine is handed;
                                                   -- stored on orders.total_zar. ONE VALUE, TWO NAMES.
  VAT               = 0 always (L30 — FAVO is not VAT registered)

COST  (per order line)
  unit_cost         = lot.cost_zar / lot.yield_units   -- cents to 4 decimal places, NOT rounded.
                                                       -- numeric(10,4) on inventory_lots.unit_cost_zar.
                                                       -- Rounding here would price any ingredient costing
                                                       -- under half a cent per base unit at ZERO — which is
                                                       -- chocolate and chai today.
  shot_factor       = order_items.shots for the COFFEE ingredient, 1 for every other ingredient
                      -- DEC-09 generalised: coffee × shots, same cup, same lid, same milk.
                      -- Declared here, and read by line_cogs and by §10.5's deduction rules.
  line_cogs         = order_items.quantity
                      × ( Σ over recipe_ingredients( recipe_qty × unit_cost × shot_factor )
                          + cup_cost + lid_cost )      -- still fractional cents
                      -- PER LOT (DEF-G): where a multi-shot line draws from two containers, the
                      -- coffee term is summed per unit drawn AT THE LOT EACH UNIT CAME FROM, never
                      -- by multiplying one lot's unit_cost. L17's auto-open completes the deduction
                      -- inside one transaction. Everything else in the formula is unchanged.
  order_cogs        = round_half_up( Σ line_cogs )     -- THE ONE ROUNDING POINT. Integer cents.

DAY  (per revenue day, midnight-to-midnight SAST, L07)
  card_gross_zar    = Σ order_net_charged  WHERE payment_mode IN ('yoco','yoco_deferred')
  fund_gross_zar    = Σ order_net_charged  WHERE payment_mode = 'donor_fund'
  gross_zar         = card_gross_zar + fund_gross_zar   -- unchanged in value on a day with no funds

  topups_settled    = Σ payments.amount_zar WHERE fund_topup_id IS NOT NULL AND status='successful'

  net_settled       = card_gross_zar + topups_settled + Σ payments.tip_zar − processing_fee
                      -- DEF-D, and it cuts BOTH ways. Was gross_zar, which over-claimed: a fund
                      -- DRAW never reaches Yoco. But a fund TOP-UP does — Yoco settles it into the
                      -- bank like any other card payment — so a figure defined on card_gross_zar
                      -- alone would UNDER-claim by the value of every top-up taken that day.
                      -- net_settled is a BANK-RECONCILIATION figure: it must equal what Yoco pays
                      -- in — every card payment, whatever its subject, and nothing that was not one.
  processing_fee    = Σ COALESCE(payments.fee_zar, 0)
                      -- BUT: if ANY settled order in the period has fee_zar IS NULL, every fee-dependent
                      -- figure renders as UNAVAILABLE, never as a number. SUM() silently skips NULLs,
                      -- which is exactly the silent zero that overstates contribution.
  cogs_zar          = Σ order_cogs
                      -- SAME REFUSAL RULE, AND IT IS NOT OPTIONAL: if ANY ingredient consumed in the
                      -- period has unit_cost_zar NULL or 0.0000, then cogs_zar, gross_margin, contribution
                      -- and every margin percentage render as UNAVAILABLE **with the offending ingredient
                      -- named**. `provisional` (§7.0.1b) is a warning about ACCURACY; it is not a licence
                      -- to compute from an absent input.
  gross_margin      = gross_zar − cogs_zar
  written_off_zar   = Σ order_net_charged where written_off_at IS NOT NULL
  collected_zar     = gross_zar − written_off_zar      -- money actually in hand
  contribution      = collected_zar − ( cogs_zar − outreach_cogs ) − processing_fee
                      -- the profit/loss flag reads THIS. Computed PER SESSION and summed (COL-10),
                      -- because a revenue day can now hold a sunday morning and an event evening.
                      -- outreach_cogs is excluded here and included in ministry_cost below: both
                      -- sides move by the same amount, so ministry_net is unchanged (§6.9.4).
  comps_zar         = Σ order_items.discount_zar where comp_reason IS NOT NULL  (L33)
  entitlement_cups  = COUNT( staff_entitlement_log rows in the period )
                      -- ONE ROW IS ONE CUP, guaranteed by L03: the entitlement zeroes exactly one unit of
                      -- one eligible line, never a line and never an order.
  walk_in_cups      = Σ walk_ins.quantity
                      -- one walk_ins row per order LINE, so this counts walk-in cups and not the order's.
                      -- Disjoint from entitlement_cups by construction; both count CUPS.
  voucher_cups      = COUNT( live voucher_redemptions rows in the period )
                      -- ONE ROW IS ONE CUP, guaranteed by L41: a voucher zeroes exactly one unit of
                      -- one line. Same guarantee, same wording, as entitlement_cups. Reversed rows
                      -- (COL-29) are excluded; rows on orders that never reached in_progress are
                      -- excluded too — counted as paper, not counted as coffee (§6.10.5).
  vouchers_zar      = Σ order_items.discount_zar WHERE the line carries a live voucher_redemptions row
  outreach_cogs     = Σ line_cogs over lines carrying a live voucher_redemptions row
                      -- rounded with its own order at the single rounding point below, never
                      -- separately, or the day's COGS and its parts stop being additive.

  fund_balance_zar  = Σ top_up − Σ spend − Σ sweep − Σ adjustment   -- per fund, CHECK ≥ 0.
                      -- a top_up entry contributes ONLY while its payment is 'successful' (§6.10.3).
  fund_liability    = Σ fund_balance_zar over active funds          -- deferred income, not revenue

ROLLUP  (per week or month, §7.2)
  ministry_cost     = weekday_cogs + free_event_cogs + outreach_cogs + Σ expenses(period)
                      -- free_event_cogs, NOT event_cogs. A PAID event day is a "paid day", so its
                      -- contribution — already net of its own COGS — enters ministry_income below.
                      -- sunday_cogs is absent for the same reason.
                      -- Σ expenses EXCLUDES card processing fees: they are already netted inside
                      -- contribution. A fee is never both an expense and a deduction.
                      -- Until logExpense (§11.2) and /admin/expenses ship, ministry_cost renders
                      -- UNAVAILABLE rather than COGS-only: a rollup reporting the ministry's cost with no
                      -- rent, utilities or wages is worse than no rollup.
  ministry_income   = Σ contribution over paid SESSIONS + Σ ADMIN-CONFIRMED sweeps
                      -- net of fees AND write-offs, NOT gross.
                      -- "paid session" = any session whose mode is `sunday`, or `event` with
                      -- payment_posture ∈ {standard, override}. It was "paid day", which a Sunday
                      -- carrying a sunday morning and an event evening satisfies TWICE, leaving the
                      -- formula unable to say which contribution it was summing (COL-10). On a
                      -- single-session day the two definitions are identical, so no existing
                      -- figure moves.
                      -- A swept dormant balance becomes ministry income ON ADMIN CONFIRMATION
                      -- (§6.10.4), never on the job that proposes it (§12.3).
  ministry_net      = ministry_income − ministry_cost
```

**`order_items.quantity` is a column of record** — integer, ≥ 1, default 1, and the surcharge, the modifications and the cup/lid all apply **per unit, not per line.** An early draft omitted the quantity term entirely, which on the grounded Sunday produces **R285.00 against a recorded R350.00**, because three of the fourteen real orders carry quantity 2. The same omission in `line_cogs` under-deducted **3 cups and 3 lids against 17 drinks — an 18% shortfall**, landing in T01's "10%+ critical" band and blocking the day's close on a day when nothing went wrong. **A comp under L33 zeroes an entire line regardless of its quantity.**

**Why `contribution` subtracts write-offs.** A written-off order was made, cost real beans and a real cup, and was never paid for. If the flag read `gross − cogs − fees` it would count money that was never collected **as profit, on precisely the day the café's collection failed** — green on the worst day. Revenue is still booked gross (L30) and the write-off is its own line beneath it, so `gross`, `written_off`, `collected`, `fees` and `contribution` are all visible and additive. The order keeps its COGS and its stock deduction, because the drink was really made.

**Rounding is applied exactly once, at `order_cogs`** — half-up, to integer cents, per order. Every day, week and month figure is a sum of those integers, so **no two reports can disagree by a rounding choice.** Ingredient unit costs are carried at `numeric(10,4)` precision.

> **Worked, because this is the one place the arithmetic must be checkable**
>
> A **R180** bag = **18 000c**, yielding **34** cups: `unit_cost = 18000 ÷ 34 = 529.4118 ¢/cup`, **stored unrounded.** A one-line order for one such drink has `line_cogs = 529.4118 ¢` and `order_cogs = round_half_up(529.4118) = **529c**` (R5.29) — rounded **once**, at the order. A two-cup order is `1058.8236 → **1059c**`, which is *not* 2 × 529 — **and that difference is the point:** rounding per unit loses a cent on every second cup, and rounding per order does not. A cent per cup is ~R0.34 across a 34-cup bag and it compounds into every COGS and margin figure in the product.

#### 7.0.3 Sunday 2026-08-16, worked end to end

**Thirteen FAVO orders**, 08:05:51–09:16:02, one barista (Thandeka), one card machine. **This day is a fixture in the test suite and it is the acceptance bar for §15.1's cost row.**

> **Thirteen, not fourteen**
>
> Yoco recorded fourteen transactions. The fourteenth — a *250ml Cups (25s)* line — is a retail item transacted outside the app's menu, and §8.7 rules it out of FAVO entirely: no FAVO order, no recipe, no stock deduction, no COGS attribution. It is retained for reconciliation only. In FAVO the day is **13 orders with `comps_zar` = R0.00**, and a test built from a fourteen-order reading would assert an order count and a comp figure the data model forbids. **This also means L33 has no in-scope grounded instance** — the comp exists because L02 leaves no remedy for a wrong charge, not because the grounding demanded one, which is why its ceilings are set low and revisited on the first month's real evidence.

| Item | Qty | Unit | Gross |
| --- | --- | --- | --- |
| Cappuccino (single) | 2 | R20 | R40.00 |
| Cappuccino (double) | 10 | R20 | R200.00 |
| Mocha | 2 | R25 | R50.00 |
| Hot Chocolate | 2 | R20 | R40.00 |
| Americano | 1 | R20 | R20.00 |
| 250ml Cups (25s) — **not a FAVO order** | 1 | R49.73 list | **R0.00** · excluded |
| **Gross charged** (13 FAVO orders) |   |   | **R350.00** |
| Processing fees (13 card transactions) |   |   | **− R9.27** |
| Net settled to the bank |   |   | **R340.73** |
| VAT · Tips · Cash |   |   | R0.00 · R0.00 · R0.00 |

`order_cogs` is rounded **once per order**, so the day's figure is the sum of thirteen integers, not a re-rounding of a total. Worked per order, in cents:

| Order | Contents | Σ line_cogs | order_cogs |
| --- | --- | --- | --- |
| #2649 #2643 #2642 #2640 #2639 | 1 × Cappuccino (double) each | 1351.9481 | **1352** ×5 |
| #2648 | 1 × Cappuccino (double) + 1 × Cappuccino (single) | 2382.4676 | **2382** |
| #2647 | 1 × Americano | 441.4286 | **441** |
| #2645 #2636 | 2 × Cappuccino (double) each | 2703.8962 | **2704** ×2 |
| #2644 #2641 | 1 × Hot Chocolate each | 742.6909 | **743** ×2 |
| #2638 | 2 × Mocha | 2128.2390 | **2128** |
| #2637 | 1 × Cappuccino (single) | 1030.5195 | **1031** |
| #2646 | 250ml Cups — not a FAVO order | — | **excluded** |

**A double shot adds one further cup of beans (321.4286 ¢) and nothing else.** Ten of the seventeen drinks were doubles, so the day carries ten extra bean charges and **no extra cup, lid or milk.**

|   |   |
| --- | --- |
| `gross_zar` | **R350.00** |
| `gross_zar` | **R350.00** |
| `cogs_zar` — Σ of the thirteen integers | **R196.36** |
| `cogs_zar` — Σ of the thirteen integers | **R196.36** |
| `gross_margin` | **R153.64** |
| `gross_margin` | **R153.64** |
| `written_off_zar` · `comps_zar` | R0.00 · R0.00 |
| `written_off_zar` · `comps_zar` | R0.00 · R0.00 |
| `collected_zar` | **R350.00** |
| `collected_zar` | **R350.00** |
| `processing_fee` | **R9.27** |
| `processing_fee` | **R9.27** |
| `contribution` | **R144.37 — 41.2% of gross** |
| `contribution` | **R144.37 — 41.2% of gross** |
| Drinks · double shots · entitlement cups · walk-in cups | **17 · 10 · 0 · 0** |
| Drinks · double shots · entitlement cups · walk-in cups | **17 · 10 · 0 · 0** |

> **Three things this fixture pins down, and one it cannot**
>
> **The one-cent disagreement is the reason the rounding rule had to be fixed first.** The grounding sheet published R196.37 / R153.63 / R144.36, rounding each *drink* to whole cents and the *bean unit* to whole cents — a mixed basis following no single stated rule. A third answer, R196.09, comes from an earlier rule that prices chocolate and chai at zero. **Three defensible answers to one day's profit, differing by up to 28c, is what an unfixed rounding rule produces.** §15.1 asserts R196.36 / R153.64 / R144.37, so **a builder who computes R144.36 has found a real disagreement and should stop, not adjust.**
>
> **One assumption, stated because the fixture is asserted to the cent.** The two Mochas and the Americano are costed **single-shot**. That is an assumption, not a reading: Yoco lists both as `(X1, X2)` with no variant sub-rows, so unlike the cappuccino **their shot count is recorded nowhere.** Costing all three as doubles gives `cogs_zar` R206.00 and `contribution` R134.73 — a **6.3% swing.** The fixture takes the single-shot reading because it is the **higher**-contribution figure and so the one that must not be flattered.
>
> **`contribution` is computable and it is not yet trustworthy.** Every cost figure rests on `cost_source='estimate'` lots, and the seed and Yoco disagree by up to R5.55 a drink. On the seed basis the Sunday cleared R144.37; on Yoco's higher cost basis it clears **R136.65 (39%) if those figures already include the double shot, or R104.55 (30%) if not** — itself one of the gaps above. **All profitable, and the spread is the measure of how much the real figures matter.** The profit flag therefore renders *provisional*, never green.
>
> **And what the fixture cannot test.** Every discretionary term in §7.0.2 — `written_off_zar`, `comps_zar`, `tip_zar`, `entitlement_cups`, `walk_in_cups` — is **zero on this day**, so a formula wrong in those terms passes it. §15.1 therefore requires a second, synthetic **FIXTURE-B**, and this is adopted in v6.0 rather than left as a proposal.

**Two figures with different uses.** `gross_charged` (R350.00) and `net_settled` (R340.73) are different numbers: revenue is booked gross per L30, and the profit/loss flag reads `contribution`, which is net of the R9.27. And the comped retail line proves that a product-level report and a transaction-level report disagree *by design* — Yoco's product view shows the cups as R49.73 earned while the transaction shows R0.00 collected. **Every FAVO figure is on the collected basis.**

#### 7.0.4 Card processing fees are an expense line

**Driver of this rule: R9.27 on R350.00 — a steady 2.649% — on 13 of the 14 transactions on the one real Sunday in the grounding.** Scaled to a 45-order Sunday that is **≈R32**, comparable to the entire lid budget (§7.4, ~R36) that this document spends a three-option decision table on — and unlike lids it is a **real cash outflow with no offsetting stock.** It was absent from the PRD entirely before v5.1.

- **Fees are taken from Yoco's actual per-transaction figure, never estimated from a rate.** The rate varies by card type and is not FAVO's to predict.
- Revenue is booked **gross** (L30); fees appear as their own line **below** it, so `gross`, `fees` and `net` are all visible in §7.1, §7.2 and §7.3. The profit indicator reads `contribution`.
- `config.expected_fee_rate_bp` (default **265** basis points, observed 2026-08-16) is used **only to flag anomalies** — never to compute a figure. The realised rate is computed only on days with **at least ten card transactions** and reported as *not applicable* otherwise, because every weekday is otherwise 0 ÷ 0. **The band is ±15 bp, set provisionally and re-derived from the first month's actual figures** — it claims no statistical basis until then; the re-derivation is the real control.
- **Yoco rounds a half-cent fee down; §7.0.2 rounds half-up.** On the grounded day the R50 line's fee is R1.32 where a half-up recomputation gives R1.33. **This is why §7.0.4 reads the actual figure and never recomputes it** — a recomputed fee disagrees with the gateway by a cent on every such line, and the gateway is right by definition, because it is the one taking the money.

> **The principle this rests on**
>
> **Yoco is the source of truth; FAVO holds a claim.** FAVO's `payments` rows are an *assertion* about money Yoco actually moved. Where the two disagree, **Yoco is right by definition.** **Reconciliation is therefore a control, not a report**, and it is the only thing that turns an unresolved payment (S4) into a fact. It runs **daily**; the weekly payout comparison remains as a second, coarser check against the bank.

### 7.1 Live COGS dashboard

> **Margin breaks out by shot count, not only by item [new in v7.0]**
>
> **One `GROUP BY`, and it is the most actionable number v7.0 produces for Priority 2.** Price is flat from one shot to two and cost is not, so **the second shot is the least profitable thing FAVO sells** — and 83% of cappuccinos took it on the grounded Sunday. A per-item margin averages that away; a per-shot-count margin shows it. **L39 applies here like anywhere else:** a per-shot figure derived from an estimated ingredient renders *provisional* and never green (§6.2.3).

Real-time revenue, COGS, expenses and margin, visible without downloading anything. **Because weekday revenue is intentionally zero, the dashboard reports by mode rather than as one blended figure** — a blended margin would be meaningless and quietly alarming. Access is gated to the **Admin role**, not a named individual. *Status: built (`GET /api/cogs/live`, `/api/cogs/stream`). Needs the per-mode split and the `cost_source` labelling.*

### 7.2 Ministry rollup view

A single combined view — weekday cost, Sunday revenue and cost, and event cost — netted together, showing what FAVO actually costs the ministry over a week or a month. **Total expense minus what Sunday brings in, in one place, assembled by the system and not by a person.**

> **"No spreadsheet" means no spreadsheet is *required***
>
> CSV and PDF export stay (`GET /api/reports/export`), and anyone who wants to slice the numbers their own way still can. What ends is *having to* build a spreadsheet before you can answer "are we losing money." *Status: new. The most important unbuilt Priority 2 item.*

### 7.3 Weekly ops summary

A short automatic weekly summary to the three baristas and the Admin role, split by mode, because the week runs under different economic rules. Delivered as a **push plus a single in-app screen** — not an emailed PDF or CSV.

| Section | Shows |
| --- | --- |
| Weekday | Staff coffees and walk-in coffees as **two separate counts**, milk used, beans used, any stockout, notable waste. Cost and consumption only — no revenue exists |
| Sunday | Revenue, COGS, and a clear profit or loss indicator — to catch a loss early, not to chase profit. **Never green while any contributing lot is an estimate** (§7.0.1b). **Margin broken out by shot count as well as by item** (§7.1), and **per session**, so a morning and an Untracked Church evening are separately readable (§6.11.1) |
| Events | Per event: attendance proxy (drinks made), consumption, cost, and revenue where the event charged |

#### 7.3.1 The write-down block — per barista, and it is the only thing that makes theft visible

Five other sections point at §7.3 for figures it did not contain: §05's only 100% criterion verifies *"three named per-barista figures in that week's summary"*; §6.0.5 needs a write-off line and a per-barista count; S2a names the missing write-off line as one of three reasons the deferred-mode channel was invisible; L33 requires every comp reported per barista. **The table had three rows.**

| Row | Content |
| --- | --- |
| Comps | Per barista: count and `comps_zar` |
| Deferred write-offs | Per barista: count and `written_off_zar`, split by reason (`unresolved_at_close` separately) |
| Abandoned orders | Per barista: count. *This is the only figure distinguishing a real abandonment from a barista taking the cup* |
| **Vouchers** [new in v7.0] | Per barista: **count *and* value** — `voucher_cups` beside `vouchers_zar`, so **the average value per slip is readable without anyone computing it.** A slip is worth between R20 and R45 depending on the drink and its shots, so a barista whose slips average R38 against everyone else's R21 shows up in the same glance that makes a comp pattern visible (§6.9.2a). **It is not a cap and it blocks nothing.** Also carries the session's slip count beside the recorded count, and **the count of days the tin was not counted at all** (R25) |
| **Fund draws** [new in v7.0] | Per barista: count and value drawn. **A fund draw moves goods without taking money, by a named barista** — the same class of act as a comp, and R22's only standing report (§6.10.3) |
| Unresolved payments | Count still open, and the oldest age |
| Reconciliation | Days closed, days blocked on L09, and every `unresolved_at_close` write-off still open on T10 |

**Zero prints as `0`, never omitted.** An absent line is indistinguishable from a clean week, and the whole purpose of these rows is that someone other than the author sees them.

### 7.4 Cups, lids and stock counts

**Yes, FAVO does stock counts.** `stock_takes` and `stock_take_lines` are built, with `runStockTake(kind)` supporting `full` and `spot` counts — *opening/daily/weekly are cadences, not enum values, and would be rejected* — and variance computed and stored on close. Variance bands are T01.

**Cups and lids are already modelled per recipe, and they already differ by drink.** An Americano draws a cup and **no lid**; a Cappuccino draws a cup **and** a lid. So "just the cup?" is item-dependent and correct today for the drink, not a blanket rule.

What the recipe *cannot* capture is a customer declining a lid at the counter. Three options were weighed:

| Option | Verdict |
| --- | --- |
| A POS toggle so the barista marks "no lid" | **Rejected.** It costs a tap on every Sunday order — 45 taps to track an R0.80 item. That is precisely the friction Priority 1 exists to remove |
| Stop deducting lids; treat them as a counted consumable | Rejected — loses the per-drink cost signal that makes COGS meaningful |
| **Deduct per recipe; true up at stock take** | **Chosen.** |

Lids deduct per the recipe. Declines are not captured, so lid stock will drift *positive* — the count will show more lids than expected, never fewer. Because that drift is structural rather than a symptom of waste or theft, **lids carry their own wider variance band (T08)** so the noise does not pollute the overall variance signal Priority 2 depends on. The economics justify the imprecision: a lid is R0.80, and a 45-order Sunday puts at most ~R36 through this line — modelling it precisely would cost more barista time each week than the entire lid budget. **Cups, by contrast, are 1:1 with a drink and reliable.**

### 7.5 Day close, and how it differs from a standard POS

**The benchmark.** Every mainstream POS — including Yoco's own POS app, the incumbent FAVO replaces — ends the day with an **operator-initiated close and a report**: tender totals, transaction count, discounts, voids, deferred, and a discrepancy figure. The operator reads it before leaving.

**FAVO's departure, and the reason.** FAVO's close is an unattended job (§6.0.5) and there is **no cash-up**, because there is no cash: the grounded Sunday was 13 card transactions with no drawer, no float and no counting. A cash-up ritual with nothing to count is pure friction, and Priority 1 governs. **That part of the departure is deliberate.**

**What was not deliberate** is that the barista who traded thirteen orders could not see a total anywhere, and the Admin received nothing unless something was wrong. **A close that only ever speaks up on failure gives nobody a reason to trust it on the days it stays quiet.**

So FAVO provides a **Day summary screen** — on the POS, available at any time, and surfaced at the end of the opening window. It is a **read**, not an action: nothing is confirmed, nothing is submitted, no tap is required to end the day. `/pos/today` and `/pos/history` are this screen and its history.

| Line | Source |
| --- | --- |
| Order count · gross charged | gross_zar |
| Written off · collected | written_off_zar · collected_zar |
| Card fees · net settled | Σ payments.fee_zar · net_settled — labelled **"settles overnight"** until the import runs, never blank and never R0.00 |
| COGS · contribution *(the profit/loss flag)* | cogs_zar · contribution — **provisional while any lot is an estimate** |
| Tender totals — **card and fund, split** | card_gross_zar · fund_gross_zar. **A fund draw is a tender, so it belongs in a tender total** (L47, COL-25) |
| Discounts — **entitlement, comp and voucher, split** | entitlement_cups · comps_zar · voucher_cups + vouchers_zar. **On an Untracked Church evening this is the line that dominates**, and it is the screen the barista reads at the end of the night |
| Voucher slips — **counted against recorded** | opening_sessions.voucher_slips_counted vs voucher_redemptions_recorded, **per session**. **An uncounted tin renders UNAVAILABLE, never zero** (L43) — so the tin is reconciled on the screen where the close happens |
| Entitlement cups · walk-in cups · comps | three separate figures, per §05 |
| Deferred: open · settled · written off | orders.settled_at / written_off_at |
| Reconciliation status | L09 gate result, with the variance band |

> **A regression against the incumbent, recorded rather than glossed**
>
> Yoco's own app prints **fee and net per transaction, on the day.** FAVO's Day summary shows gross on the day, and card fees and net settled read *"settles overnight"* until the next morning's import. **So on the single figure Priority 2 exists to produce, the barista and the Admin are worse off than they are today.** The web route does not fix this on its own — **the untested REST fee route of §6.8.3 would**, and it is a question in the Yoco email precisely because closing this gap is worth one email.

## 08 — Non-goals

Explicitly not being built, so scope stays honest. **Renumbered in v6.0** — v5.2's subsections ran 8.1–8.7, then 8.10, then 8.9, then 8.8, which is the kind of small disorder that makes a reader wonder what else moved. **v7.0 adds §8.11, the group tab**, and moves the bare v4 list to §8.12 so the new non-goal has a section of its own rather than a comma in a list — *which is the same reasoning that promoted cash and native apps out of that list in v6.0.*

### 8.1 Loyalty programme — removed

No points, no earn, no redemption, no liability. Registration exists for notifications and The Favo, not rewards. This is a **removal of shipped, working code**: loyalty earn, multi-unit redemption, the redesigned loyalty page and the in-cart redemption UI are all live on `main`. §13.3 covers the deletion; §14 covers the risk.

**No wind-down.** Outstanding point balances are not converted, credited or compensated. Points cease to exist at removal.

### 8.2 Customer stored-value wallet — removed, and stays removed [narrowed in v7.0 · DEC-14]

Confirmed emphatically by Nikao on 2026-07-05: no customer top-up flow anywhere, no spend-from-balance payment method for a customer's own coffee, no balance displayed under any label. **The word "wallet" does not appear in new UI copy, tickets or code comments.**

**Verified complete as of 2026-08-12 — no work remains.** The schema is clean and the enforcement grep returns zero across `src/` and `db/`. This clause stays in the PRD as a **standing prohibition**, not a task.

**DEC-14 (14 Sep 2026) narrows this clause; it does not delete it.** §6.10's blessing fund is a named, non-refundable balance that pays for *other people's* coffee, opened by FAVO staff against money whose arrival is externally proven. *Deleting §8.2 would have removed the only thing standing between FAVO and a customer wallet* — which is a different feature, rejected on its merits and not re-argued. **The guard stays; the line moves.**

> **Standing prohibition, as narrowed — this is the clause of record**
>
> **What stays banned, permanently:**
>
> - **No customer may hold a balance in their own name.**
> - **No self-service top-up, by anyone, anywhere** — not in the customer PWA, not at the POS, not by a link, not by a QR code (L44). *The control is on the way in, because that is the only place money can be invented.*
> - **No balance is refundable in cash, ever** (L45).
> - **No balance is displayed to a customer as money they hold** (L46). A donor is told their balance by a barista; there is no screen they can open and no push they receive.
> - **The word "wallet" never appears** in UI copy, tickets or code comments. §13.3's enforcement grep stands unchanged.
>
> If a PR, ticket or design reintroduces **a customer-held, self-service or refundable** stored-balance concept, it contradicts this document — **flag it, don't build it**, and read §6.10.1 first.

### 8.3 Coffee packs — removed

Pre-paid 10-drink packs with 90-day expiry are cut. They served neither priority: they do not improve cost visibility, and they add a step at the counter rather than removing one. Packs were in scope under v4 and are built (22 files).

### 8.4 Offline counter mode — trimmed, not kept and not deleted

**Not a launch gate.** An earlier draft argued offline did not matter because the café runs on a generator and the espresso machine needs power — no power, no coffee, no orders to lose. **That reasoning conflates a power outage with a network outage.** They are different events with different frequencies, and the common one is the network: a brief connectivity blip, during which the espresso machine is running fine and customers are still ordering. That is the case the outbox code actually protects against, and the case the generator argument says nothing about. *Credit to Mia for the correction.*

So the question is not "does offline matter" but **"how much offline machinery does a one-tablet café with brief network blips actually need?"**

| Option | Verdict |
| --- | --- |
| Keep all 23 files, add a CI regression test on the outbox path | Better than the original plan, but still carries reconciliation machinery for a scenario that cannot arise |
| **Trim to outbox + idempotent retry; delete the conflict-reconciliation layer; add the CI test** | **Chosen.** |
| Delete offline entirely | Rejected — gives up real protection against the most likely failure mode |

**Why the conflict layer specifically goes.** `sync_conflicts` implements last-write-wins resolution for genuinely conflicting concurrent edits. FAVO has **one POS tablet** — one writer. Conflicting concurrent edits are not a scenario that occurs, so the reconciliation logic, the table, its actions and the admin resolution surface are solving a problem the deployment does not have. **Untested code for an impossible case is pure liability.**

**What stays, and why it is already safe.** The outbox queues orders locally and replays them on reconnect. The replay-safety primitive **already exists**: `outbox_log.client_uuid` is a POS-generated UUID with a `UNIQUE` constraint, so a replayed order is rejected as a duplicate rather than double-created. That is idempotency, not conflict resolution — and idempotency is the property a single-writer retry path actually needs.

Offline imposes **no requirement on the host** — it runs entirely in the browser.

> **Not a launch gate, but an audit gate (DEC-12)**
>
> Network drops at the office are **roughly monthly** during café hours. But none of this code has been exercised against an actual disconnection. **The offline path does not ship on trust.** Until the audit passes, **offline is disabled in production rather than shipped unverified** — a queue that silently fails to replay is worse than a till that plainly stops, because the barista believes the orders are safe.
>
> **The audit, delivered in §13.4:** (1) the **scope statement** — *order creation only*; `transitionOrder`, stock adjustments, entitlement claims, walk-in logging, broadcasts **and all tender** require a connection and fail visibly without one. (2) The **entitlement seam** — two offline claims for the same person both look valid on the tablet and one fails on replay with the coffee already handed over; ruling: the second order replays as a normal order with the entitlement not applied, is flagged on the admin exception list, and is written off the way a deferred order is. **Never silently dropped.** (3) A **physical drill** on the actual device on the actual network. (4) The **CI regression test**, run on every PR. (5) **Connection-drop logging from day one**, so "monthly-ish" becomes a measured number.

### 8.5 Customer-facing order status for guests and walk-ins — out of scope

**Order-ready notifications are for registered customers only.** Nothing shows an unregistered person the progress of their order. Specifically not being built, in any form: no guest notification path — no counter QR, no short link, no "notify me when it's ready" flow, no ephemeral pairing token; **no customer-facing order-status or queue page** — the live queue exists for the barista on the POS and is not exposed to customers, guests or walk-ins in any form, under any URL; and no walk-in order tracking.

**Someone who wants to be told their coffee is ready registers.** That is a one-time, self-service step (§6.4). Everyone else collects at the counter, exactly as they do today — which is not a regression, because it is the current behaviour. Earlier drafts explored a guest QR paired to push, and a guest-facing live order-status page reading off the queue event stream. **Both are withdrawn.** They expanded the notification surface to people the system holds no relationship with, and the second exposed the POS queue — a barista tool — to the public. The iOS constraint in §6.1 independently undermined the first.

> **Standing prohibition**
>
> If a ticket, design or PR proposes a guest notification flow, a QR at the counter, or any customer-visible order-status or queue view, it contradicts this document — flag it, don't build it.

### 8.6 Receipts — not built

**FAVO prints and sends no receipt of its own.** Card customers receive the terminal's slip from the Khumo; weekday coffee and free events involve no transaction to receipt at all. Specifically not being built: no thermal printer, no printer drivers, no cash-drawer triggering, no emailed receipt, no pushed digital receipt. This removes an entire integration class — **and its failure states, which on a POS are the expensive part** — from the build (DEC-06).

### 8.7 Retail sales of beans, cups or merchandise — out of scope

FAVO models a **menu of drinks**, not a retail catalogue. The grounded Sunday shows one non-drink line — *250ml Cups (25s)*, R49.73 list, comped in full — transacted through Yoco **outside the app's menu**. Bean bags, cups and merchandise are sold, when they are sold, as Yoco line items with no FAVO order, no recipe, no stock deduction and no COGS attribution. **Consequence, stated so nobody has to guess:** a Yoco product report will contain lines FAVO has never heard of, and any reconciliation (T10, §7.0.4) must match on **transactions**, not on product totals (S7d).

### 8.8 Cash — refused, and this is a rule rather than an omission

**FAVO takes no cash, keeps no float and has no drawer.** A barista who is offered cash **rings the order `payment_mode='yoco_deferred'` with the reason `cash_offered`**, and it is settled by card or written off at the close like any other deferred order. **It never becomes an untracked tender.**

> **The basis for refusing cash is thin and is stated as such**
>
> One grounded trading day, card-only. **"No cash was taken on 16 August" is not "the café does not take cash."** A customer at a church café on a Sunday will hand over a R50 note, and v5.2 specified no behaviour at all for that moment. **And it is the one hole neither direction of T10 can see**, because a cash sale generates no Yoco transaction to reconcile against — money in the café and in no record, with no control that can detect it. **If a barista reports being offered cash more than once in the first month, this non-goal reopens.**

### 8.9 Native mobile applications — and this now holds without exception

> **A contradiction v6.0 resolves**
>
> **FAVO ships no native application on any platform.** v5.2 carried "native mobile apps" in its list of standing non-goals *while §6.8.2 and §9.10 commissioned a native iOS POS* — two normative passages in one document, both in force. **OPEN-12's decision resolves it in favour of the non-goal.** There is no Capacitor wrapper, no custom native plugin, no Apple Developer organisation enrolment, no Apple Business Manager custom app, no signing certificate with an owner and an expiry date, and no review build with a stubbed tender path. **The POS is the same installable PWA the customer installs.**
>
> If a ticket or PR proposes wrapping FAVO natively, it contradicts this document — flag it, don't build it, and read §6.8.0 first.

### 8.10 Discord — removed entirely

No Discord webhook, no `#favo-ops` channel, no ops pings. **The integration is deleted from the codebase, not merely left unconfigured.** Discord entered FAVO through the HOFMI build-team convention, not through anything the café asked for. **It was never relevant to the café.** The baristas coordinate on WhatsApp; the organisation runs on Google Workspace. A `#favo-ops` Discord is an engineering channel café staff have no reason to watch — so the rule that `closeDaily()` "pages Admin via Discord" was, in practice, paging a room with nobody in it. **A gate whose alert nobody reads is not a gate.**

> **Sequencing constraint — this one matters**
>
> `closeDaily()`'s *only* current alert is the Discord ping. Deleting it before the replacement exists leaves daily reconciliation computing a variance, writing an audit row, and **telling nobody** — a silent regression on a rule meant to gate the day's close. **The in-app admin alert and Web Push (L09) must land before or with the deletion, never after.** §13.5 sequences this.

### 8.11 The group tab — considered, and recommended against [new in v7.0]

The ask: a group where one person pays for everyone, all of them order through the day, and the payer settles at the end of the day. Build an account the coffees log to — or ask them to prepay and use a fund instead.

> **Recommendation, adopted — Nikao, 14 Sep 2026**
>
> **Don't build the tab. Give them a fund with their names linked to it, and let them top it up as often as they like** (§6.10.2). The two arrangements differ in exactly one respect — *whether the money moves the day before the coffee or the day after* — and that one difference is where all of the risk, and all of the build, lives.

#### 8.11.1 What is already there, and what is not

About eighty percent of a tab exists already, which is what makes this worth examining rather than dismissing. Orders that complete without payment are specified: `payment_mode='yoco_deferred'`, `settleDeferredOrder`, the admin unpaid-orders list and `closeDaily()`'s settle-or-write-off step are all in §13.1 and being built now.

> **The missing twenty percent is the part FAVO cannot afford**
>
> **A tab settles many orders on one card tap. FAVO has no concept of a payment against more than one order**, and acquiring one means changing the table where a mistake takes money twice:
>
> - `payments.order_id` is `NOT NULL` — a junction table replaces it.
> - The DB unique index enforcing **one successful payment per order** no longer expresses the constraint it exists to express.
> - **T10 reconciles at transaction grain** (§12.2) and is *not tunable — a control, not a setting*. One Yoco transaction against eight FAVO orders has to be matched some new way.
> - P4 freezes *one* order's total at `beginTender`. Eight orders would each need freezing, together, while any of them can still be comped or have a line added.
> - Every §7.0.2 day figure groups by order, and the fee would need apportioning across eight of them to keep per-order margin meaningful.
>
> **Settling each order individually against its own card tap avoids all of that and is worse than what they do today:** eight taps on the machine instead of one.
>
> *This is the distinction §6.10.3 turns on. A fund top-up needs one payment against exactly one subject that happens not to be an order — the cardinality never changes. **A polymorphic subject is cheap; a multi-subject payment is not.***

#### 8.11.2 The second reason, which is not technical

**A tab creates debt inside a church.** §6.7 writes off **any order still unpaid when `closeDaily()` runs**, and the rule is deliberate: an unpaid order that rolls to tomorrow is indistinguishable from a lost sale by next week. So a payer who leaves early, or is ill, or simply forgets, turns eight coffees into **a named bad debt on an admin screen** — and someone has to have that conversation. *The fund makes that situation structurally impossible: the exposure is never more than what was already given.*

#### 8.11.3 What the group gives up, stated honestly

| What they lose | What answers it |
| --- | --- |
| They pay before they drink rather than after | Real, and it is the whole cost. For a group that already does this every day, one R500 top-up a month is less handling than a settlement every evening |
| They might overfund | Bounded by T13's ceiling, and the balance can be read back to them at the counter any time. They can top up R100 at a time if they prefer — *a daily top-up is a tab with the cash moving one day earlier* |
| "Logged to an account" — knowing who drank what | **Kept, with one caveat.** Names are linked to the fund and draws are gated on them, so the coffees do log to an account (§6.10.2). The caveat is that the breakdown lives on the Admin screen — *the payer asks rather than sees* (§6.10.5) |

> **What would reopen this**
>
> **Not an argument — evidence.** If after a month on a group fund the payer is topping up daily and complaining about the prepayment, that is the case this decision currently lacks, and **a month of `donor_fund_entries` is exactly the record needed to make it.** Reopen then, with the numbers.

### 8.12 Unchanged from v4

Customer self-ordering (in-person only) · dine-in or pre-orders · EFT and instant-EFT · tipping · multi-language · kitchen display screen · supplier composite rating · operating-hours enforcement as an order gate · multi-location · multi-currency · email, WhatsApp and calendar integrations. *Cash and native apps have been promoted out of this list into §8.8 and §8.9, because a bare comma-separated non-goal is exactly the silence that let both of them be contradicted elsewhere.*

## 09 — Hosting and infrastructure

*Prepared by Transformate, 2026-08-07. Adopted, and it is the chapter that came through two review runs without a correction.*

### 9.1 Hosting model — the critical constraint

> **Non-negotiable**
>
> The application **MUST** run as a continuously-running server process. It **MUST NOT** be deployed on serverless or function-style hosting.

The live order queue on the barista tablet holds an **open, long-lived connection for the whole shift**, fed by Postgres `LISTEN/NOTIFY` over SSE (`GET /api/queue/stream`, 30 s heartbeat). Serverless platforms terminate such connections after a short idle window. **This is exactly what broke the previous hosting setup** — a diagnosed failure, not a theoretical risk.

Three hard requirements follow. Any option failing **any one** is disqualified:

1. **Always-on runtime** — a container or VM running continuously. No cold starts, no per-request lifecycle.
2. **Direct database connection** — PostgreSQL over a *direct* session connection, not a serverless/pooler-only path. Several serverless-Postgres products (Neon among them) do not support `LISTEN/NOTIFY` at all and are not candidates regardless of other merits.
3. **Co-location** — application and database in the **same location**. Every page makes several DB round trips, so app↔DB latency matters far more than user↔app latency.

### 9.2 Target architecture

| Concern | Provision |
| --- | --- |
| Runtime | Always-on VM on Transformate infrastructure; the Next.js server runs continuously |
| Database | PostgreSQL **co-located on the same host**, direct connection |
| Public access / TLS | HTTPS via Cloudflare; a **stable public URL**, required for the PWA and Web Push |
| Card payments | **Server-to-server calls to Yoco's Web POS API from FAVO's own runtime** (§6.8). **No inbound webhook is subscribed** and none is required — FAVO fetches payment status rather than being told |
| Live order queue | Long-lived connection validated **end-to-end through the edge before go-live** (§9.8) |
| Timezone | `Africa/Johannesburg` on the container — all day-close and wall-clock logic depends on it |
| Resources | 512 MB working set, 768 MB burst. One instance. Traffic is tiny (§9.9) |

**Two code simplifications this unlocks:** `db/index.ts` sets `prepare: false` for PgBouncer compatibility — on a direct connection that workaround is removed and prepared statements are re-enabled; and the two-connection-string arrangement (pooled 6543 for queries, session-mode 5432 for the queue stream) **collapses to one**, removing a standing source of misconfiguration.

### 9.3 Domain, DNS and TLS — resolved

**`favo.hofmi.net`.** Free, unused, and keeps FAVO under the HOFMI umbrella. A dedicated `.co.za` can be added later — the public base URL is a single config value.

**`favo.hofmi.org` was a wrong TLD, not a lost domain.** `hofmi.org` has never been registered — NXDOMAIN, not on public DNS at all. The domain HOFMI owns is `hofmi.net`: apex A records serve the existing website, Google Workspace MX carries the email, DNS is managed at **Xneelo**. Every `favo.hofmi.org` reference in the repo is a typo — §13.6.

**The mechanism, confirmed.** Attaching `favo.hofmi.net` **does not require moving the `hofmi.net` zone.** It is **Cloudflare for SaaS custom hostnames**: Transformate adds `favo.hofmi.net` as a custom hostname on *their* Cloudflare zone, FAVO adds a CNAME for `favo` plus one validation record at Xneelo, and Cloudflare issues and renews the certificate. **This is not an Enterprise-only capability** — custom hostnames are available on Free, Pro and Business plans with 100 included. FAVO needs one.

> **Where the earlier doubt came from, so it is not re-raised**
>
> `docs/HOSTING_BRIEF.md` §6 concluded that partial/CNAME onboarding is Enterprise-only. That conclusion was about a **different product**: onboarding *our own zone* to Cloudflare in partial setup, which is indeed Enterprise and would require the nameservers for `hofmi.net` to change. What Transformate described is the SaaS-provider direction — their zone, our hostname — which carries none of that exposure. **The zone stays at Xneelo; Google Workspace MX is never touched; there is no zone migration in this plan.**

**Verification is a DNS check, not a conversation** — run before and after the change, and it must show only the intended difference:

```
dig +short MX hofmi.net && dig +short NS hofmi.net && dig +short favo.hofmi.net
```

**Acceptance:** MX unchanged, NS still Xneelo, `favo.hofmi.net` resolving, certificate valid. Anything else is a stop.

### 9.4 Data, retention and POPIA

**Stored:** menu, orders, payments (**a reference and an amount only — no card data**), stock and inventory, and a permanent append-only audit log of every change.

**Personal data:** customer name, email, phone, order history, hashed passwords; hashed staff PINs. **No card details are stored or seen** — see §9.10.2 for the one field the web route makes this a rule about rather than a property.

**Retention:** financial records kept **≥ 5 years** for tax. Backups are sized for retention, not data volume.

**`donor_fund_members` follows the customer, not the fund.** It links a named customer to a financial record, so it carries *the customer's own* retention period and is deleted with the customer. **A fund outliving its members keeps the ledger and loses the names** — the money history is a financial record, the linkage is personal data, and they do not have the same lifetime (§6.10.2).

**Backups (DEC-05):** **RPO ≤ 5 minutes**, via continuous WAL archiving to encrypted off-site storage — *not* nightly dumps. **RTO ≤ 4 hours**, measured from decision-to-restore to the café transacting again; the café runs on paper in the interim. Nightly full base backups are retained per the ≥ 5-year rule.

**A restore is rehearsed before go-live (§13.0) and re-rehearsed quarterly.** This is a payments and tax-record system — a backup that has never been restored is not a backup, and a nightly-only schedule would put an entire Sunday's takings inside the loss window. **A failed rehearsal is an immediate alert (§9.6.3), not a note in a report.**

**Residency: EU.** POPIA-compliant given the documented safeguards and the privacy policy already in place. ⚠ **The four-hour recovery promise has no contractually responsible party until OPEN-08 is answered** (§16.2), and Sunday is the only paid trading day.

### 9.5 Authentication and access control

**Two independent auth systems.** **FAVO staff** — PIN login on the tablet, two roles: *barista* (orders, and comps under L33) and *admin/owner* (menu, prices, stock, reports, audit log). **Customers** — email + password, and they may only ever access their own data.

**Password reset by emailed link.** `/reset-password` exists and was specified nowhere before v5.1. Rate limits are §9.5.3.

**Magic-link sign-in is not supported.** The `magic_link_tokens` table exists and is **removed in §10.1**, which lists it. If magic-link sign-in is wanted instead, it needs a rule here and its own rate limits — password reset and magic-link issuance are the classic account-takeover vectors, and §9.4 commits to POPIA safeguards over exactly this data.

**Authorization is enforced on the server**, not only in the interface. UI checks are advisory. An **optional network-level lock** on the admin and till surfaces via Cloudflare Access is defence in depth, not a substitute for RBAC.

#### 9.5.1 Session lifetime, idle lock and shift change

> **Why this had to be specified at all**
>
> This document makes per-barista attribution a **100% success criterion** (§05), the basis of L33's per-barista comp ceiling and of §7.3.1's write-down block — and until v5.2 it never said how long a PIN session lasts. At `9aefc2c`, `auth.ts:100` is `session: { strategy: "jwt" }` **with no `maxAge`**, so the NextAuth default applies: **30 days.** On a shared till that is not a session, it is a permanently unlocked drawer — **every comp, write-off and abandoned order for a month attributes to whoever last typed a PIN** — and §05's insider-loss drill would still pass, because that drill is one barista doing all the actions.

| Control | Value | Why |
| --- | --- | --- |
| Absolute session lifetime | **12 hours**, then re-auth | Longer than any single shift, shorter than a day. A session can never span two trading days |
| Idle lock — **outside** the opening window | **5 minutes** of no interaction → the POS locks to the PIN screen | A till left on the counter after hours is not an open account |
| Idle lock — **during** the opening window | **None.** The till does not idle-lock while a session is open and trading | **New in v6.0, and it reconciles a contradiction.** OPEN-03's decision is that the till is *never auto-signed-out during trading hours*; §9.5.1 as written idle-locked it after five minutes. Five minutes is a real cost on a slow weekday and a live hazard mid-rush. **Attribution is preserved by *Hand over* and the 12-hour ceiling instead** |
| What the lock preserves | **Everything.** The order in progress, the queue, the customer match, an open tender | An idle lock that loses work is an idle lock that gets disabled |
| Shift change | **Explicit *Hand over* control**, ending the session and returning to the PIN screen without touching orders in flight | Baristas overlap. Waiting for a timeout on a Sunday morning means the next hour's actions attribute to the person who went home. **With no idle lock during trading, this control is now load-bearing rather than a convenience** — §05's training bar covers it |
| Admin PIN overrides | **Single-action.** One action authorised; no admin session started, and the barista's is not extended | An override that lasts is an override nobody remembers granting |
| Customer sessions | Unchanged — Supabase Auth's own cookie lifetime | They carry no till authority. Different system, different risk |

> **The trade-off, named**
>
> Removing the in-window idle lock means **a till left unattended *during* an opening window is unlocked.** That is accepted on two grounds: a barista is present for the whole window by definition — the window *is* the period someone is at the counter — and the 12-hour absolute ceiling means no session survives to the next day regardless. **If a barista reports leaving the counter unattended during a window, this reopens**, and the cheaper fix would be a lock tied to leaving the till idle for 15 minutes rather than 5, not a return to 5.

#### 9.5.2 Identity providers, named

**Two, and only one was ever written down.** Staff run on **Auth.js (NextAuth) with a JWT session**. **Customers run on Supabase Auth** — `customer-auth.ts` calls `supabase.auth.signUp`, and Supabase owns password hashing, session cookies and the reset emails. **That is a third-party identity provider on the critical path of every customer login**, and §9.6.1's dependency register had no identity-provider row at all — while §13.0 abandons the Supabase *database* instance, which reads, wrongly, as abandoning Supabase. It is in the register, and its outage behaviour is stated there.

#### 9.5.3 Rate limiting [OPEN-03 closed]

> **The threat model is a small café, not a bank**
>
> **A lockout during the Sunday rush is a worse outcome than the abuse it prevents.** The limits below are set generously on customer accounts, tightly on the one control that guards money, and **not at all on the till.**

| Surface | Limit | On breach | Why |
| --- | --- | --- | --- |
| Customer login — per account | **10 failed attempts per 15 min** | A **15-minute cooldown**, then the counter resets | Generous enough that a person mistyping their own password is never locked out of a coffee order |
| Customer login — per IP | **30 attempts per 15 min** | Cooldown, audited | The whole office shares one IP, so a per-IP limit tight enough to stop credential stuffing would lock out the building |
| Registration and password reset | **30 per IP per 15 min** | Cooldown, audited | Same reasoning. These are the account-takeover vectors §9.5 names, so the breach is audited even though the limit is loose |
| **Admin PIN** | **5 attempts** | A **5-minute cooldown and an immediate Admin alert** | **Tight, because this one guards order cancellation after making starts, the comp override and every config write.** Five digits of entropy and a shared tablet is a combination that has to be defended |
| **Barista till session** | **Never rate-limited** | — | **And never auto-signed-out during trading hours** (§9.5.1). A barista locked out of the till at 08:10 with nine people queuing is a worse outcome than any attack this would prevent |

> **Do not let a framework default undo this**
>
> **The till-session exemption is called out explicitly so it is not "hardened" away later by someone applying a middleware default.** Any change to it is a PRD amendment. Every breach of every limit above writes an `audit_log` row with `action='reject'` and a reason (§10.3.2) — and **never the attempted value.**
>
> *There is no rate limit on `loginWithPin` at `9aefc2c`* — `checkRateLimit` exists and `customer-auth.ts` uses it; the PIN path does not. The customer-side limits above are therefore work to be built, and the till exemption is work *not* to be built, which is the cheaper half.

### 9.6 Integrations

- **Yoco — Web POS API** (§6.8), called **server-to-server from FAVO's runtime**, **plus a daily import of Yoco's transaction export** for the per-transaction fee (§6.8.3). **FAVO subscribes to no payment webhook and requires no public payment endpoint.** Yoco does publish `payment-created` and `payment-refunded` webhook events with an HMAC signature header — **FAVO subscribes to none, and nothing in this document may be built on one.** §9.2's stable public URL is still required, for the PWA and Web Push.
- **Web Push** — order-ready notifications, opening broadcasts, shift-start pushes, low-stock alerts, the card-machine alert and the weekly summary. **This is the notification system of record for everyone who runs or uses the café.**
- **Seven scheduled jobs** — low-stock check, end-of-day close, weekly P&L, unconfirmed-payment reconciliation, the `collected` sweep, the daily Yoco transaction import, and the **donor-fund dormancy check** (§6.10.4). On the new host these run as **server-side timers**, not platform cron functions. Each one's schedule, missed-run behaviour and audience are in §9.6.2, which is the register of record.
- **No Discord** — removed entirely (§8.10). No email, WhatsApp or calendar integrations.

#### 9.6.1 Dependency register — what a person sees when each one is down

v5.0 named around ten third-party dependencies and specified user-visible behaviour for **two**. **A named failure with no user-visible behaviour is a gap, not a risk accepted.**

| Dependency | Detection | Timeout / retry | What the barista or customer sees |
| --- | --- | --- | --- |
| Yoco Web POS API | A send or fetch that errors | Send 10 s; fetch 5 s ×2; poll ceiling 180 s (S2) | `GATEWAY_UNAVAILABLE` where nothing was sent — *"try again"*. Otherwise deferred-mode banner; orders continue; settlement is an explicit action later |
| **The card machine** (Khumo, over wifi) | **The first failed send is the signal**, plus a device lookup every 60 s (§6.7). **FAVO can now see the machine** — which it could not under the Phase 0 design | As above | `TERMINAL_UNREACHABLE` offers deferred mode, one tap away. **And the barista's own device is alerted within 2 minutes** (§9.6.3) — because FAVO now depends on *reaching* the machine, so it can fail silently while someone stands beside it |
| Web Push / VAPID | Send failure | 3 attempts, exponential | R10 — the queue board is the primary signal; the customer asks at the counter. **Never a subscribed state the device cannot honour** (L29) |
| Supabase Auth (customer identity) | Sign-up / sign-in / reset call fails | 5 s, 2 retries, then fail closed | **Customers** cannot register, log in or reset a password: *"Sign-in is unavailable right now — you can still order at the counter."* **The café is unaffected** — ordering is barista-driven and in-person (L05). **Staff PIN login is a different system and keeps working** |
| Postgres (co-located) | Connection failure | 5 s, 3 retries | POS shows *"Can't reach the till system"*; the offline outbox accepts **order creation only** (§8.4); everything else `OFFLINE_UNAVAILABLE` |
| Cloudflare (TLS / edge) | Site unreachable | — | The app is unreachable. **Paper for the day**, per §14's catastrophic plan. Nothing in the app can report this, which is why the alert is external |
| Xneelo (DNS) | Resolution failure | — | As Cloudflare. `favo.hofmi.net` stops resolving; HOFMI email is untouched by construction (R2) |
| Infisical (secrets) | Fetch failure at boot | Fail closed on boot | A **running** app is unaffected — secrets are read at start. A **restart** during an outage fails to boot and the previous container keeps serving. Deploys are blocked, trading is not |
| GitHub / CI | Pipeline failure | — | **No user-visible effect.** Deploys are blocked; the running app is unaffected. Listed so nobody treats a red pipeline as an outage |
| Transformate observability | Metric gap | — | **No user-visible effect**, but L09's alert rides Web Push, not this. A gap here means *nobody is watching*, which is an admin-facing alert of its own |
| Scheduled jobs (six) | Missed window | Catch-up on startup, recorded as a catch-up | A missed close surfaces as the §6.0.5 banner at the next opening window and repeats at 06:00 |

#### 9.6.2 The scheduled-job register [OPEN-02 closed]

Seven jobs run. All seven are below. **A job absent from this table does not exist**, and adding one means adding a row. They run as **server-side timers on one instance** — which is the important constraint: a restart inside a job's window means the run **simply does not happen**, silently, and nothing downstream can tell a missed run from a run that found nothing.

| # | Job | Schedule (SAST) | Missed-run behaviour | Who is told |
| --- | --- | --- | --- | --- |
| 1 | checkLowStock | **every 15 min** (T05); per-item ping cooldown default 60 min | **Skip.** The next run sees the same stock level and alerts then. **No catch-up**, because a catch-up would re-send the same alert | Nobody. A 15-minute delay on a low-stock ping has no consequence — **the one job where a missed run is genuinely harmless**, stated so it is not treated as a gap |
| 2 | closeDaily() | **00:05**, closing the **completed** revenue day — **not 23:55**, which cannot satisfy §10.6's deferred-order invariant for an order rung up at 23:57 (L04 guarantees one is possible) | **Catch-up on startup, once**, for every unclosed completed revenue day, oldest first, each recorded with `was_catch_up = true` and **naming the revenue day it closed**. **Idempotent**: a second run against a closed day rewrites nothing and creates no second close record | **Loudest of the six.** A revenue day with no `daily_closes` row by **06:00** raises the §6.0.5 banner at the next opening window **and** an Admin push, repeated each morning until closed. **L09's gate cannot fire on a job that never ran**, so the absence of the close is itself the alert |
| 3 | generateWeeklyPnL() | **Monday 06:00** | **Catch-up on startup**, once, for any complete week with no report. Idempotent per `(year, week)` | Admin push carries *"for week ending …"* — so a late report is never mistaken for the current one |
| 4 | **Unconfirmed-payment reconciliation** | **every 15 min** | **Skip, and the ageing does not reset.** Each run ages every `pending`/`unresolved` payment from `payments.at`, not from the last run, so a gap cannot reset a clock | The **30-minute** unresolved threshold is measured on payment age, so a missed run **delays** the Admin push by up to 15 minutes and never cancels it. S4a's immediate push at the moment of `unresolved` is a separate path and does not depend on this job |
| 5 | The `collected` sweep (S7) | **every 5 min**, moving `ready` orders to `collected` +20 min after `completed_at` | **Skip.** Ageing is computed from `completed_at`, so the next run sweeps everything eligible | Nobody. §7.5's Day summary and §05's order-to-cup metric both read `completed_at`, never `collected` |
| 6 | importYocoTransactions(revenue_day) | **06:00**, for the completed revenue day, against the export an Admin has uploaded | **Catch-up on startup** for any completed revenue day with no import. **Idempotent** on `(revenue_day, yoco payment id)`. It **never writes `payments.status`** — it annotates revenue, it cannot create it | **Second loudest.** No import for a completed day by **09:00** → Admin push naming the day. Under §7.0.2's refusal rule an un-imported day renders `processing_fee`, `net_settled` and `contribution` **UNAVAILABLE**, and **a missing upload is indistinguishable from a broken report unless someone is told** |
| 7 | **Donor-fund dormancy check** [new in v7.0] | **Daily, 06:30.** At **T14 minus 30 days** with no draw it alerts; at **T14** it **adds an item to the Admin's task list and writes nothing else** | **Skip, not caught up.** Dormancy is a threshold in days and a day late changes nothing, so a catch-up run would produce a duplicate Admin task for no gain — the same disposition `checkLowStock` carries | **Nobody, on a normal run** — it writes an Admin task and *the task is the notification.* This matters because §12.3 forbids a job creating revenue, and **a job that also pushed would be one step from looking like it had acted**. `sweepDonorFund` is an Admin action (§6.10.4) |

> **Job 4 changes shape in v6.0, and this fixes a real contradiction**
>
> v5.2 specified this job as **strictly read-only and forbidden from calling Yoco at all** — not out of caution, but because `getIntegratorTransactions` was an *iOS SDK method* and a server-side timer cannot call one. The job could only age payments and push the Admin; the actual lookup had to run on the device. That was a workaround for a platform limitation, and the workaround left the recovery path dependent on a barista having the app open.
>
> **The Web POS fetch is a server-side call, so the job can now perform the lookup itself.** Job 4 fetches the status of every `pending` and `unresolved` payment, attaches any that Yoco reports `successful`, and pushes the Admin on anything older than 30 minutes. **It still never initiates a payment, never re-sends one, and never creates revenue** — attaching a payment Yoco confirms exists is a read followed by a record, not a charge. **Recovery no longer depends on anyone standing at the till.**

**Three rules that hold for all seven**, so no row has to repeat them. **(1) A catch-up is recorded as a catch-up** — an `audit_log` row with `actor_kind='system'`, the fact that it was late, and the period it covered; a figure produced by a late run must be traceable to one. **(2) No job may initiate a payment or create revenue** — only the two writers §10.2.1 names may set `payments.status='successful'`, and neither ever calls the send endpoint. This is §6.7's never-auto-retry rule expressed as a property of the schedule. **(3) A job that fails raises, never retries silently** — an exception is one Admin push naming the job and the period, and the next scheduled run is the retry.

#### 9.6.3 Alerting [OPEN-04 closed]

> **The rule**
>
> **Alert on anything that could lose money or data, and route it to whoever can fix it.**

| Immediate | Threshold | Goes to | Named action |
| --- | --- | --- | --- |
| FAVO unreachable | **more than 2 minutes** | Nikao | *"The app is down. Check the host, then Cloudflare."* |
| **The card machine unreachable from FAVO** | **during trading hours**, within 2 minutes | **The barista's own device, and Nikao** | *"FAVO can't reach the card machine. Check it's on and on the wifi, or switch the till to deferred."* |
| A backup or restore rehearsal that fails | any failure | Nikao | *"The restore rehearsal failed. Do not treat the backup as verified."* |
| Any order still unsettled at close | any | Nikao | The §6.0.5 write-off approval queue, with the count and value |
| Two unresolved payments in one session | 2 | Nikao | S4a's escalation — the signature of a failing machine rather than one unlucky transaction |
| A stock reconciliation mismatch | T01 / T08 bands | Nikao | L09's alert, naming expected vs counted |
| Admin PIN cooldown triggered | 5 failed attempts | Nikao | §9.5.3 |
| **An unnamed blessing fund is created** [new in v7.0] | any | Nikao | *"A fund was opened with no name — [barista], [amount], [code]."* **R22's only timely control**: a named fund has an owner who asks about it and an unnamed one has nobody to notice. **It never blocks** — a genuinely anonymous gift is a real thing (§6.10.3) |

| Daily digest | Threshold | Goes to |
| --- | --- | --- |
| Storage | **above 80%** | Nikao |
| Queue stream disconnected | > 60 s, as a count for the day | Nikao — the barista already sees the banner in the moment (S6) |
| **Vouchers — one line, not two** [new in v7.0] | A slip-count variance at `closeSession`, **and** a session crossing T11's expected maximum | Nikao. **Both concern the same session's vouchers, so they collapse to one digest line** — which is de-duplication applied rather than promised. Both are reconciliation results read the next morning, not things to act on at 20:40 |
| **Total live fund balance** [new in v7.0] | Above **~R5,000** across all active funds | Nikao — R24. **A number that moves in weeks, so a digest line and never a block**: a block would refuse a generous person at the counter, which §6.9.2 already rules out for vouchers on the same grounds |

> **Why three of v7.0's four new alerts are digest and only one is immediate — COL-24**
>
> OPEN-04 was closed with the words *"de-duplication as a requirement — alerts people learn to swipe away are worse than no alerts,"* and this list already carried seven immediate conditions to one person on one channel. **Adding four more immediates would have been the outcome OPEN-04 was closed to prevent.**
>
> **Immediate:** an unnamed fund created — it names a barista and an amount, and it is the only timely control on R22. **Daily digest:** the voucher variance and T11's session count *as one line*, and total fund liability. *An alert that can wait until morning and is read in the morning is a report, and it should be filed as one.*

> **Routing is by who can act, not by seniority**
>
> **The card-machine alert goes to the barista's own device as well as to Nikao.** They are standing next to it and can restart it or fix the wifi; Nikao cannot. Everything else goes to Nikao, by push and email, **on one channel**.
>
> **That alert is genuinely new, and it exists because of the web route.** Previously a barista noticed a dead machine instantly, because they were tapping on it directly. **Now FAVO depends on *reaching* it over wifi, so it can fail silently while someone stands beside it.** This is the one operational cost the Web POS decision adds, and it is answered here rather than discovered on a Sunday.

> **De-duplication is a requirement, not a nicety**
>
> Because the immediate list above is the broader of the two options that were on the table, **every immediate alert must be de-duplicated and actionable — one notification per incident, not one per minute.** A card machine off the wifi for an hour is *one* alert plus a resolution notice, not sixty. **Alerts people learn to swipe away are worse than no alerts**, and an alert that names no action is not an alert. §15.1 carries a drill that asserts the de-duplication.
>
> **Discord is removed only after this has fired in a test**, as §8.10 requires.

### 9.7 Deployment and environments

- **Source:** private GitHub repository; ~900 automated tests on every change.
- **CI/CD:** merge to `main` → tests run → **automatic deploy**. No manual uploads. **A POS fix is a deploy, not a release** — which is one of the things §6.8.0's decision preserves.
- **Environments:** a separate **staging** environment alongside production, and Yoco's own test credentials against it, so the failure paths of §6.8.4 can be exercised before they take real money.
- **Secrets:** managed vault (Infisical). Never committed. Roughly 15 variables move off Vercel. **The Yoco secret key lives here and only here** (§9.10.2).

### 9.8 Operations

- **Monitoring:** uptime and health checks (`GET /api/healthz`) on Transformate's fleet observability engine.
- **Pre-go-live validation:** the live-queue long-lived connection is **explicitly tested end-to-end, through the edge**, because it is the previous failure point. **A local test that bypasses Cloudflare does not satisfy this.**
- **Calendared operational items with an owner:** the quarterly restore rehearsal, and the monthly re-derivation of `expected_fee_rate_bp` (§7.0.4). *v5.2's list also carried an Apple signing certificate expiry — deleted with the native route, and it was the largest silent-expiry hazard in the plan.*

### 9.9 Scale — context for sizing

Low traffic. Peak is **~45 orders in 100 minutes** on a Sunday; low-hundreds of customer accounts over time; thousands of records per year; the database stays well under a few GB for years. Infrastructure is sized accordingly — **deliberately small.**

### 9.10 The card machine, the Yoco key, and the PCI boundary [rewritten in v6.0]

v5.2's §9.10 was five subsections on native distribution, Capacitor, a custom plugin, a Secure-Enclave device enrolment, key minting, Keychain caching, a 7-day stale-credential rule, Apple Business Manager, a certificate with an owner, a review build with a stubbed tender path, and a cutover flag. **All of it is deleted.** What remains is three short things.

#### 9.10.1 The device

**One Web POS device, named `FAVO Till`, created once at gate zero.**  Its id lives in `app_config.webpos_device_id` (§10.4) — Admin-writable and audited, not an environment variable, so a replacement machine does not need a redeploy. The device's terminal **model** and **serial number** come back from the device lookup, which is how OPEN-11(a) gets settled *from Yoco's own record* rather than from a third-party list. **A second device can be created and switched to without touching code**, which is the whole of what v5.2's per-device cutover flag was for.

#### 9.10.2 Where the Yoco secret lives, and the one field that must never be stored

> **The largest security simplification the decision buys**
>
> **The Yoco secret key never leaves the server.** It lives in Infisical, is read at boot, and is used only by FAVO's own runtime to make the four calls of §6.8.2. **It is never present in the web layer** — not in JS, not in `localStorage`, not in an env var inlined at build time, not in a network response the browser can read.
>
> Under the SDK route the credential had to reach a device: v5.2 specified a server mint endpoint, a Secure-Enclave keypair, a `pos_devices` enrolment table, a nonce signature, a rule that the mint endpoint must reject a WebView session cookie, a 7-day authoritative cache, and a rotation procedure with an owner. **None of that exists now, because there is nothing on the tablet to protect.** Rotation is a secret rotation in Infisical and a restart.

> **The PCI boundary is now a rule with an enforcement point, not a property**
>
> **The cardholder still interacts only with a certified card machine**, and FAVO still sends an amount and a reference and receives a result. **But the Web POS payment resource is reported to carry a masked PAN**, which means §11.5's *"never log or echo PAN, CVV or expiry"* stops being structurally guaranteed and becomes something FAVO must enforce. **This is a real cost of the OPEN-12 decision and it is recorded rather than glossed.**
>
> **The enforcement point:** one server-side adapter parses Yoco's payment response, and **it returns only the fields §10.3.3 stores.** Every other field — the masked PAN above all — is dropped at that boundary and never reaches a log, a database column, an error tracker or a client. **The adapter is the only place in the codebase that touches the raw response**, and §15.1 carries a unit test asserting that a response containing a masked PAN produces no stored or logged copy of it.
>
> **The classic accidental leak, named because it is how this goes wrong in practice:** crash reporters and error trackers that capture full request and response bodies. Any such tool added to FAVO must have request-body and response-body capture **off by default**, and must never be initialised around the payment adapter.
>
> **Attribution, because this is exactly where an unsourced claim would be dangerous.** This is **FAVO's architectural reasoning plus standard card-present practice — it is NOT a statement Yoco makes.** No page in Yoco's documentation addresses PCI scope. Anyone seeking a formal scope determination must get it from Yoco or an assessor.

#### 9.10.3 Distribution

**There is none to arrange.** The POS is the installed PWA on the counter tablet, updated by an ordinary web deploy. No organisation enrolment, no private listing, no signing certificate, no per-version review, and **nothing that expires quietly on a morning when nine people are queuing.**

## 10 — Data model

Schema in `db/schema.ts` (Drizzle), migrations in `drizzle/`. The audit log is append-only, trigger-enforced, forever.

> **The count**
>
> **Current: 35 tables**, verified against `drizzle/meta/0031_snapshot.json` at `9aefc2c`. **After v7.0: 35 − 7 removed + 9 added = 37.** *v6.0 stated 33 on 35 − 7 + 5; v7.0 adds four — `voucher_redemptions`, `donor_funds`, `donor_fund_entries` and `donor_fund_members`.*
>
> v5.2 said 34, on 35 − 7 + 6. **The sixth addition was `pos_devices`**, the device-enrolment table v5.2's §9.10.2 needed so a native app could authenticate itself before being handed a payment credential. **There is no credential on any device now, so the table is not created.** *(v5.0 said 35 − 4 + 4 = 35 and v5.1 said 35 − 5 + 4 = 34, both undercounting, because three tables were dispositioned in prose that the §10 arithmetic never read. The count is stated here, once, where the arithmetic reads it.)*

### 10.1 Tables and columns removed

| Table / column | Reason, and the completion gate |
| --- | --- |
| loyalty_transactions | §8.1 — hard delete, no historical retention |
| customers.loyalty_points | §8.1 *(a column, not a table — the arithmetic above counts tables only)* |
| coffee_packs | §8.3 |
| pack_redemptions | §8.3 |
| sync_conflicts | §8.4 — conflict reconciliation for a multi-writer scenario a one-tablet café cannot produce. `outbox_log.conflict_id` drops with it. **Footprint: six files** — `actions/sync-conflicts.ts` (deleted), four that §13.4 *retains and must edit* (`api/sync/orders/route.ts`, `server/sync/apply-outbox.ts`, `hooks/useOfflineOutbox.ts`, `crons/retry-deferred-payments.ts`), **plus `db/schema.ts` and `db/enums.ts`**, which declare the table, both enums and the column. **Each retained file must be edited, not just kept.** Gate: `grep -rIn 'sync_conflicts\\|syncConflicts' src/ db/` returns zero |
| pending_charges | **§8.3 — removed with the coffee packs, not repurposed.** At `9aefc2c` this is the *coffee-pack purchase queue*: `charge_kind`'s only value is `coffee_pack`, it keys on `customer_id NOT NULL` with no `order_id`, and it has no last-checked column — so it is **not** the unconfirmed-payment queue §9.6 once described. The job queries `payments` directly. Gate: `grep -rIn 'pending_charges\\|pendingCharges' src/ db/` returns zero |
| magic_link_tokens | **§9.5 — magic-link sign-in is not supported.** The table exists and has no supported flow writing to it. Gate: `grep -rIn 'magic_link_tokens\\|magicLinkTokens' src/ db/` returns zero |
| refunds + the refund_status enum | **L02 — FAVO does not process refunds.** Removed with `requestRefund` / `approveRefund` (§11.1). Both are already hard-stubbed no-ops at `9aefc2c`, so **there is no live refund path** — what remains is deletion of the stubs, the table, the enum, the `refunded` value inside `payment_status`, and `docs/API.md` line 23, which still documents a live Yoco refund and is the only place a reader would think otherwise. Gate: `grep -rIn 'refund' src/ db/ drizzle/` returns zero outside the migration that drops it |

Removal is a forward migration with a `down` script, executed only after a verified backup (§13.3).

### 10.2 Tables added

| Table | Purpose | Key columns |
| --- | --- | --- |
| walk_ins | Weekday non-staff visitors, for consumption reporting. **No identity of any kind.** `quantity` is per row because one row is written per order line — without it §7.0.2's `walk_in_cups` had to sum the whole *order*'s quantities, counting a paid line as a walk-in cup | id · order_id · menu_item_id · quantity (int NOT NULL default 1, CHECK ≥ 1) · category · logged_by_staff_id · at |
| barista_shifts | The rota. Who is on duty on which date | id · staff_id · shift_date · notified_at |
| event_profiles | Reusable event definition, one-off or recurring | id · name · recurrence (null = one-off) · default_start · default_end · menu_scope · payment_posture · consumes_cup_lid · audience · extra_shot_surcharge · **voucher_kinds (text[] NOT NULL default '{}')** · active |
| event_windows | A concrete occurrence. **Switches are snapshotted at open**, so editing a profile never rewrites history | id · event_profile_id (null = ad-hoc) · name · starts_at · ends_at (NOT NULL) · menu_scope · payment_posture · consumes_cup_lid · audience · extra_shot_surcharge · **voucher_kinds (text[] NOT NULL default '{}')** · price_overrides (jsonb) · created_by_staff_id |
| voucher_redemptions [new in v7.0] | One row per redeemed voucher. **One row is one cup**, guaranteed by L41 the same way `staff_entitlement_log` is by L03. **Reversed, never deleted** (COL-29): counts and values read live rows | id · order_item_id · session_id · voucher_kind · discount_zar · redeemed_by_staff_id · at · reversed_at (NULL) · reversed_by_staff_id (NULL) |
| donor_funds [new in v7.0] | The fund itself. **No balance column — the ledger is the truth** (§6.10.5) | id · code (text NOT NULL, UNIQUE) · display_name (NULL = unnamed) · donor_customer_id (NULL) · non_refundable_ack_by (NOT NULL) · active · created_by_staff_id · at |
| donor_fund_entries [new in v7.0] | **Append-only ledger.** Every movement, in or out. A `top_up` entry contributes to the balance **only while its payment is `successful`** — a pending or unresolved one is visible on the fund and worth zero | id · fund_id · kind (top_up \| spend \| sweep \| adjustment) · amount_zar · order_id (NULL) · payment_id (NULL) · funding_method (card \| cash \| eft) · reference · recorded_by_staff_id · reason · at |
| donor_fund_members [new in v7.0] | The linked names. **Empty means barista discretion; non-empty gates every draw on the list** (§6.10.2) — *there is no fund-type column, because this table is the switch.* **Partial unique index on `customer_id` over active funds**, so one person has at most one live linked fund and the counter never faces a choice | fund_id · customer_id · added_by_staff_id · at · PRIMARY KEY (fund_id, customer_id) |
| daily_closes | **The close record.** L09's gate blocks on it, T4 and T8 both depend on it, and **it did not exist**. Also the resume point that makes a crash mid-sweep recoverable rather than skipped | revenue_day (PK) · written_off_count · written_off_zar · reconciliation_status · blocked_reason · closed_at · was_catch_up |

> **Why two event tables**
>
> A recurrence needs a template; reporting needs a concrete occurrence to attribute orders to. Snapshotting the six switches onto the window is the same reasoning as `price_history` — **the record of what actually happened must not change when someone edits the template next month.**

#### 10.2.1 Exactly two paths may write `status='successful'`

> **Down from three, and simpler for it**
>
> **(1) `recordTenderResult`** — a poll that read `successful` from the payment's own status resource (T2 step 6). **(2) The S4 recovery lookup** — the same fetch, run later, attaching a payment Yoco confirms exists; it runs in job 4 (§9.6.2) or on demand from the deferred-settlement screen.
>
> **And no others.** v5.2 named three, the third being `confirmExternalTender` — a barista attesting that the amount on Yoco's own app matched. **That path is gone with Phase 0, and with it the only place in this document where a human assertion created revenue.** `importYocoTransactions` is not one of the two: it annotates revenue and cannot create it.

### 10.3 Columns added to existing tables

| Table | Column | Purpose |
| --- | --- | --- |
| customers | status (enum office_staff \| church_member) | Audience targeting (§6.3) and free-coffee eligibility (L03). Set at self-registration. **The value is `office_staff`, not `staff`** — the bare word collides with the `staff` table (§1.1) |
| opening_sessions | mode (enum weekday \| sunday \| event) · event_window_id | The day's mode, defaulted from the date, confirmed by the barista; and the event in force |
| opening_sessions | deferred_since · deferred_reason · deferred_by_staff_id · deferred_entered_by (enum manual \| health_check) | **Deferred mode had nowhere to live.** `deferred_since IS NOT NULL` *is* the deferred state, and `deferred_entered_by` is what makes §6.0.4's asymmetric exit implementable. **Session-scoped: it does not survive the close** — an outage still running at 00:05 is re-declared at the next opening window. A till-level flag that silently outlives its outage is R6 applied to money |
| order_items | quantity — ALREADY EXISTS; add CHECK (quantity >= 1) only | ⛔ **`order_items.quantity` is `integer NOT NULL DEFAULT 1` at `9aefc2c`** — exactly the shape v5.2 commissioned as new *under the wrong name (`qty`)*, which would have created a duplicate column beside the one every §7.0.2 formula reads. **The only outstanding change is the CHECK** |
| order_items | discount_zar (int NOT NULL default 0) · comp_reason (enum, NULL) | L33 read `line_discount` and `comps_zar` filtered on a reason — **neither column existed and the "fixed list" was never enumerated.** The enum is `wrong_drink \| wrong_charge \| spillage \| staff_error \| goodwill \| donation`, and it is the definition of record |
| order_items | **shots** (int NOT NULL default 1, `CHECK BETWEEN 1 AND T15`) | The live catalogue encodes the shot count **in the product name** (`Americano (X1, X2)`). **An order whose shot count lives only in a string cannot be priced**, and DEC-09's coffee multiplier cannot be deducted. **The shot count is a column, never part of a name** (§6.2.3). *v6.0 specified this as `shot`, an enum of `single \| double`; **an enum with two values cannot hold four**, and DEC-16 needs four. §13.0 starts on a clean database, so there is nothing to backfill — but every read of it changes with it: the recipe multiplier, `surcharge_zar`, and the POS line* |
| order_items | `CHECK (discount_zar <= quantity * unit_price_zar)` [new in v7.0] | **DEF-A's floor: a line can never be discounted past its own value.** Nothing in v6.0 said at most one discount *mechanism* may apply to a line, so an L03 entitlement and an L33 comp could both write `discount_zar` — the comp zeroing the whole line regardless of quantity — and `comps_zar` would report it all as a comp while `entitlement_cups` still counted the row (L41) |
| opening_sessions | voucher_slips_counted (int NULL) · voucher_redemptions_recorded (int NOT NULL) [new in v7.0] | §6.9.2's paper reconciliation, **per session** (§6.11.1) — a morning with no vouchers and an evening with twenty-three must not share one number. **NULL means nobody counted and is distinguishable from zero** (L43). `daily_closes` aggregates the day's sessions and stores no count of its own |
| opening_sessions | voucher_kinds_active (text[] NOT NULL default '{}') · closed_at [new in v7.0] | **Snapshotted at open** from the session's event window against T12's catalogue, so changing config never rewrites what a past session allowed — §10.4's rule, applied. `closed_at` is what `closeSession` sets and what the **one-open-session partial unique index** is defined over (§6.11.1) |
| orders | payment_mode gains **`donor_fund`** [new in v7.0] | A fund draw is a tender, so it belongs in the tender enum and every §07 per-mode query splits on it (L47). ⛔ **§10.6 requires a report meeting an unknown payment mode to fail loudly** — so **the enum addition and the report updates ship in one migration**, and §15.1 asserts the failure before the value exists (COL-7) |
| payments | order_id → NULL-able · **fund_topup_id** (new) · `CHECK (num_nonnulls(order_id, fund_topup_id) = 1)` [new in v7.0] | **A payment points at exactly one subject, which may now be a fund top-up rather than an order.** The cardinality is unchanged — *this is the distinction that makes §6.10.3 cheap and §8.11's tab expensive.* **It needs a second partial unique index** on `(fund_topup_id) WHERE status='successful'`: NULLs are distinct in Postgres, so the existing order index leaves top-ups entirely unguarded (COL-5) |
| barista_shifts | keys to the **session** rather than the date [new in v7.0] | `session_id`, or `shift_date + slot`. **A Sunday now has two sessions and two baristas**, and §6.3's shift-start push fires per session — *without it the evening barista is never told they are on* (COL-23) |
| orders | daily_seq (int NOT NULL, UNIQUE (revenue_day, daily_seq)) | **A deferred order could not be identified later.** Settlement is per-order, most Sunday customers are unregistered so `customer_id` is null (L28), and L32 means there is no FAVO receipt — "the number on the cup" corresponded to no column. Allocated inside the `createOrder` transaction; shown in the queue, written on the cup, shown on the settlement screen |
| orders | notification_target (enum customer \| none) | L28 — bound at ring-up, never null. **The target customer is `orders.customer_id`** |
| orders | payment_mode → NOT NULL, backfilling NULLs to 'yoco' | The column is nullable today and NULL means `'yoco'` by convention, which silently mis-buckets every per-mode query in §07 |
| orders | CHECK ((notification_target = 'customer') = (customer_id IS NOT NULL)) | Closes the silent-failure gap in §05's verification. Without it a row can claim it will notify someone and carry no customer — R16's exact failure shape: **everything looks like it worked** |
| orders | revenue_day (date NOT NULL, from the server clock) · client_uuid (text NOT NULL, UNIQUE) | `daily_seq` is "per revenue day" and there was no such column for it to be per. `client_uuid` is S7b's online idempotency key **and the root of every tender reference** (P3) |
| orders | event_window_id · settled_at · settlement_ref · written_off_at | Event attribution (§6.6); when a deferred order was settled; the standalone machine's reference, which is what makes the outage fallback reconcilable; and the close's write-off. `settled_at` and `written_off_at` are mutually exclusive |
| audit_log | actor_kind (enum staff \| system) · on_behalf_of_staff_id; rename entity_kind → entity; split actor_id/actor_role into actor_staff_id + actor_kind | §10.3.2 is the target shape. `on_behalf_of_staff_id` is what T6's admin-PIN override records and it does not exist today. *The `webhook` value v5.2 put in `actor_kind` is dropped — FAVO subscribes to no webhook (§9.6), so it would be a value nothing can ever write* |
| waste_log | order_id (NULL → orders); waste_category gains 'abandoned' | T6 step 2b writes both, so without them **the normal single-barista abandonment path was unimplementable** |
| inventory_lots | **cost_source** (enum estimate \| invoice, NOT NULL, default estimate) | ⛔ **The field §7.0.1b's *provisional* label reads.** Set to `invoice` only by an Admin recost through `/admin/yield`; the transition is audited. **This replaces the `cost_estimated` boolean v5.2 commissioned and which was never built** — verified absent from the schema and from the snapshot. `db/seed/lots.ts` records the fact in an *audit-reason string*, which no report can query. §15.1 asserts the flag renders `provisional`; without this column that assertion has nothing to read |
| price_history | set_by_staff_id (text NOT NULL → staff) · reason (text NULL) | ⛔ **§6.6 states the dependency in terms** — *"without which the audit-trail argument for this table does not hold"* — **and v5.2's §10.3 did not add it.** Without it a price change records what changed and not who changed it, and §6.6's whole argument for keeping prices in the app rather than on the card machine is false as specified |
| pending_charges | **No migration — the table is removed (§10.1)** | ⛔ v5.2 commissioned columns on a table §10.1 drops behind a zero-grep gate; the migration and the gate could not both pass |

#### 10.3.1 Repointing the free-coffee entitlement (L03)

The entitlement currently keys off the wrong table. Corrective migration — and note §13.0: **FAVO starts on a clean database, so this is a schema correction with no rows to move.**

| Change | Detail |
| --- | --- |
| staff_entitlement_log.staff_id → customer_id | FK to `customers`, not `staff`. This is the **beneficiary** — an office staff member |
| applied_by_staff_id | **Unchanged.** Still FK to `staff` — the barista who applied it. **Both facts matter and they are different people** |
| UNIQUE(staff_id, day) → UNIQUE(customer_id, day) | The daily cap now applies per office staff member, which is what L03 always meant |
| Application check | Reject unless the beneficiary is `status='office_staff'`. A church member does not get free weekday coffee |

**Table name.** `staff_entitlement_log` is now a misnomer. Renaming it is cosmetic and touches every query, so it stays; the column rename carries the meaning. Flagged here so the name is not read as authoritative.

> **Design note — why `opening_sessions.mode` and not a parallel table**
>
> §6.3 requires mode confirmation to be *the same step* as setting the opening window, never a separate, easy-to-forget action. A parallel table invites exactly the drift the requirement exists to prevent: two rows disagreeing about what kind of day it is. **One row, one confirmation, one source of truth.** `opening_sessions` already carries the date, window, barista and broadcast record — mode belongs with it.
>
> ⛔ **The constraint does *not* narrow to `UNIQUE (session_date)`, and v6.0 was wrong to say it does.** A revenue day carries as many sessions as it needs: `UNIQUE (session_date, opens_at)` — *which is what already ships at `9aefc2c`* — plus a **partial unique index allowing at most one open session across the whole table**. **That index is what makes "the current session" a definition rather than a search**, which is the objection v6.0 raised and the answer §6.11.1 gives. One row *open*, one confirmation, one source of truth.

#### 10.3.2 `audit_log` — the field list

The document required *"every mutation calls `writeAudit()`"* and made 100% audit coverage a §05 criterion, while never stating the table's shape. **A builder could not create it.** Four columns differ from what exists today.

| Column | Type | Note |
| --- | --- | --- |
| id | text, PK |   |
| at | timestamptz NOT NULL | Wall-clock semantics `Africa/Johannesburg` |
| actor_staff_id | text NULL → staff | **The person who performed the action.** NULL only for system actors — and §6.0.5 requires the close to set it to the barista who took the order |
| actor_kind | enum staff \| system NOT NULL | Distinguishes a barista from `closeDaily()` |
| on_behalf_of_staff_id | text NULL → staff | **The overriding admin**, where an admin PIN authorised a barista's action (§6.0.7). Previously unrecorded |
| entity · entity_id | text NOT NULL | Table name and row id |
| action | text NOT NULL | `insert \| update \| delete_attempt \| transition \| override \| reject` |
| before / after | jsonb NULL | Changed fields only, never whole rows. **Never a PAN, masked or otherwise** (§9.10.2) |
| reason | text NULL | Required for `override`, `reject` and every comp (L33) |

**Denials are audited.** A rejected action is not a mutation, and §12.1 has ineligible-category claims *"rejected at the application layer before the DB is touched"*, which reads as *not* audited. **They are audited**, with `action='reject'` and a reason. R14's entire mitigation is anomaly detection on entitlement claims; if failed claims are not recorded, that mitigation cannot work. **Readers: Admin only, read-only.** `audit_log` stays INSERT-only even for Admin, is append-only forever, and is not disableable by any role. Baristas have no read access.

#### 10.3.3 `payments` — the field list [rewritten in v6.0]

**What exists today** (eight columns): `id · tenant_id · order_id · yoco_checkout_id · yoco_payment_id · amount_zar · status · webhook_received_at`. **There is no `fee_zar`**, which every money figure in §07 reads. The table below is the **target shape**, and every row marked *new* is a migration this document is commissioning.

**One row per payment *attempt*, not per order.** S3 makes tender re-attemptable and §7.0.4 needs the fee and status history, both of which the current one-row-per-order shape destroys.

| Column | Type | Note |
| --- | --- | --- |
| id | text, PK |   |
| order_id | text **NULL** → orders *(migrated in v7.0)* | **Nullable only so that a payment's subject may be a fund top-up instead**, under the CHECK below. It is *not* a step toward a payment against many orders — §8.11 refuses that, and this change is what makes the refusal affordable |
| fund_topup_id | text NULL → donor_fund_entries *(new)* | **The other subject a payment may point at** (§6.10.3). `CHECK (num_nonnulls(order_id, fund_topup_id) = 1)` — **exactly one, always.** A second partial unique index on `(fund_topup_id) WHERE status='successful'` carries §10.6's invariant across to top-ups, which the order index does not do because Postgres treats NULLs as distinct (COL-5) |
| attempt | integer NOT NULL *(new)* | 1, 2, 3 … per order. S3 re-attempts add rows; they never overwrite |
| status | enum *(migrated)* | Today `pending \| successful \| failed \| refunded \| deferred`. **Target: `pending \| successful \| declined \| unresolved`.** `unresolved` is the value S4's whole mechanism turns on and it does not exist yet; `failed` becomes `declined`; **`refunded` is dropped with L02**; **`voided` is never added** — there is no void (§6.8.4) |
| client_reference | text NOT NULL, **UNIQUE** *(new)* | **`client_uuid:attempt`** (P3) — the reference FAVO sends to Yoco, written **before** the send, echoed back on the payment resource. It is the key a payment is recovered by when a send timed out and FAVO holds no id. NOT NULL rather than best-effort *because* that recovery depends on it. *This replaces v5.2's `receipt_reference` — same derivation, renamed to the field Yoco's Web POS API actually calls it* |
| yoco_payment_id | text NULL, **UNIQUE** | **Yoco's own payment id, returned by the send call** and persisted **immediately, before any outcome is known** (T2 step 4). It is the key every fetch and every T10 match uses. **NULL only in the window between `beginTender` and the send returning**, and after a send that timed out — which is exactly why `client_reference` is the second key. *Two keys on two different reads is stronger evidence than one key read twice.* *v5.2 also called this "the webhook idempotency key" — there is no webhook* |
| webpos_device_id | text NOT NULL *(new)* | **Which machine took this money** (§9.10.1). Read once from config at `beginTender` and written here, so **changing the configured device never rewrites history** and T10 can reconcile per device. *This replaces v5.2's `reader_id` and its `tender_source` — the second of which existed only to record which of two phases took the money, and there is one route now* |
| amount_zar | integer NOT NULL | What was sent to the machine, equal to `orders.total_zar` and frozen from that moment (P4) |
| charged_amount_zar | integer NULL *(new)* | **What the machine actually charged.** Distinct from `amount_zar` because it can differ. **Reconciliation compares this**, never `amount_zar`. NULL until an outcome is known |
| fee_zar | integer NULL *(new)* | **Yoco's actual fee**, from the daily import (§6.8.3). **NULL until the import runs, and NULL rather than 0 whenever it is unknown.** A silent zero overstates `contribution` on every card sale |
| tip_zar | integer NOT NULL default 0 *(new)* | Tipping is a non-goal and FAVO suppresses any prompt the machine offers. The column stays because the rail carries it and a single tipped transaction would otherwise break `net_settled = gross − fees`: Yoco settles **gross + tip − fee** |
| receipt_no | text NULL | As received from Yoco at import. **The only identifier the customer holds** — L32 leaves them the terminal slip, and L02 makes identifying a wrong charge from that slip the precondition of its only remedy |
| settlement_ref | text NULL | §6.7 path B's standalone-machine reference |
| sent_at · last_checked_at · at | timestamptz *(new: the first two)* | `sent_at` is what S4's 120-second condition and S2's 180-second ceiling are measured from. `last_checked_at` is job 4's only write besides an attach |

> **Four fields that must never be stored, and one that must never be defaulted**
>
> **Never stored:** the masked PAN, the card scheme's own token, the cardholder name, and any raw copy of Yoco's response body. §9.10.2's adapter drops them at the boundary. **The only payment fields that may leave FAVO's payment adapter are the ones in the table above.**
>
> **Never defaulted:** `payment_mode` after settlement. `orders.payment_mode` **stays `yoco_deferred` forever**; `settled_at` and `written_off_at` disambiguate the three outcomes. It is a record of *how the order was taken*, not of how it ended — so **every §07 figure that groups by mode must split `yoco_deferred` by those two timestamps.**

### 10.4 Config, not constants

**One `app_config` table**, keyed `(tenant_id, key)`, values typed as `jsonb`, **every write audited with `before`/`after` and a reason**, Admin-only. v5.2 described "config" in four sections and declared no store, so three different rules each implied a different home — an env var, a constant and a table.

| Key | Type | Default | Why it is not a constant |
| --- | --- | --- | --- |
| eligible_free_categories | text[] | ["coffee"] | T06 — the list must change without a code change (L03) |
| **extra_shot_zar** | integer cents | 1000 (R10) | T09, read by §7.0.2's `surcharge_zar` as `× MAX(0, shots − 2)`. It has an **effective date** — the first Sunday after sign-off — and a change is a `price_history`-class event, not a silent edit. *Renamed from `double_shot_surcharge_zar` in v7.0, and the rename is worth the churn for the reason v6.0 gave at `applyFreeCoffee`: **the old name is what would keep the old rule alive in the code*** |
| **max_shots_per_line** · **max_shots_weekday** | integer | 4 · **2** | T15. **The picker renders only the segments the mode allows; the DB CHECK enforces the outer ceiling** (§6.2.3c) |
| **sunday_windows** | list of windows | [07:50–09:30] + the Untracked Church window from its profile | T03. **A list, not one window** — a single window excluded the evening service from every §05 Sunday measurement (COL-22) |
| **voucher_kinds** | jsonb | [{ kind: "untracked_hot_drink", categories: ALL }] | T12 — **the catalogue**. Each kind names the modes it is valid in and the categories it covers; **the event profile decides which are live** and the session snapshots that at open (§6.11.2) |
| **voucher_expected_max_per_session** | integer | 25 | T11 — **alert only, never a block** (§6.9.2). *The default is a guess and it is a config value precisely so one evening's tally can replace it without a deploy* |
| **donor_fund_ceiling_zar** | integer cents | 200000 (R2,000) | T13, **checked before anything reaches the machine** (§6.10.3, R23) |
| **donor_fund_dormancy_days** | integer | 180, alerting at 150 | T14. **The sweep it triggers is a proposal an Admin confirms, never a job's write** (§12.3) |
| **webpos_device_id** | text | — *set at gate zero* | **§9.10.1.** Replacing the card machine, or switching to a second one, must not need a redeploy. Read **once per tender** by `beginTender` and written onto `payments.webpos_device_id` at that moment. **Never re-read mid-tender**, so a change while a card is in the machine cannot alter how that payment is recorded. *Reporting reads the payment row, never this key — a report that read config would rewrite history the moment config moved* |
| writeoff_alert_zar | integer cents | 10000 (R100) | S2a's write-off volume threshold |
| expected_fee_rate_bp | integer | 265 | §7.0.4 — **anomaly flagging only, never computation**, and re-derived monthly from actuals |
| low_stock_ping_cooldown_min | integer | 60 | T05 — a fixed cooldown cannot be tuned without a deploy |

**Read once, at the point of use, never cached across a request.** Anything read from config is recorded onto the row it affects at the moment it is used (`payments.webpos_device_id`, `order_items.unit_price_zar`, the event window's snapshotted switches), so **changing config never rewrites history** — the same rule `price_history` and `event_windows` already follow. *`tender_mode` is deleted: it existed to switch between two tender routes, and there is one.*

### 10.5 Recipe deduction — three changes in one pass

1. **Cup and lid excluded on weekday orders** (reusable mugs), included on Sunday, and **per the event's switch** on event orders (L24).
2. **Deduction becomes mode-aware**, reading the mode from the day's `opening_sessions` row.
3. **A line deducts `shots` × the base recipe's coffee** — and nothing else: same cup, same lid, same milk (DEC-09, generalised), implemented as **a recipe-level multiplier keyed on `order_items.shots`** (§6.2.3). *The mechanism v6.0 chose survived a change to the fact it encodes, which is a point in its favour.* `shot_factor` is declared in §7.0.2 and read here.
4. **A deduction may span two containers, and it must** [DEF-G]. L17 models *"one coffee = one cup from the OPEN container"*, so a single deduction never spanned two. **A four-shot drink deducts four cups, and if the open bag holds two the line draws from two lots.** The deduction completes inside one transaction, auto-opening the next sealed container exactly as L17 already promises — *the promise existed, it just was not written for a deduction of more than one.* **And `line_cogs` costs the coffee term per unit drawn, at the lot each unit actually came from** (§7.0.2), rather than multiplying one lot's `unit_cost` — which is fixed at open and never re-read, so two bags bought at different prices would otherwise produce one line costed entirely at the first bag's rate. *This was reachable in v6.0 with a double; a quad reaches it four times as often.*

⛔ **Corrected: `deductForOrder()` is ALREADY modification-aware.** Migration `0027_at145_customisation_inventory_effects.sql` shipped that fix, and §14 R8 says so in this same document — so v5.2 contradicted itself and scheduled a shipped fix again, in a section insisting these changes *"must be fixed together."* **What remains commissioned here is mode-awareness and the shot multiplier.** These land on the same function and **must be fixed together**: fixing (1) without (3) produces a deduction path that is mode-correct and ingredient-wrong — harder to spot than being wrong in both.

> **`Extra Shot` must be deleted when `shot` lands**
>
> `db/seed/customisations.ts` seeds a live customisation — **`Extra Shot`, `priceDeltaZar: 1000` (R10), adding one cup of beans** — which already charges the same R10 and already deducts the same extra cup. **So a double shot has two pricing paths in the shipped system**, and they differ in three ways that matter: `Extra Shot` is **repeatable** (the seed's own comment: *"Extra Shot ×3 deducts 3× as many beans"*), it is priced in **every mode** rather than Sundays-only (L31), and it is an optional modification rather than a structured column, so it can silently be omitted — which is the whole reason `shot` exists.
>
> **Disposition:** `order_items.shots` is the column of record; **`Extra Shot` is deleted from `menu_customisations` in the same migration**, and the R10 moves to `config.extra_shot_zar`. **Keeping both would be two prices for one fact** — the exact defect DEC-03 exists to prevent for event prices. *A first-class column added beside a live mechanism that does the same job is not a fix; it is a second source of truth.*
>
> ⛔ **Two halves of v6.0's disposition were wrong and are corrected here** (COL-15). *"The repeatable stepper becomes a two-state toggle"* — it becomes a **four-value picker** (§6.2.3c), because DEC-16 prices a third and fourth shot. And **repeatability was not the defect.** The seed's own comment — *"Extra Shot ×3 deducts 3× as many beans"* — described the café's *actual* pricing, and v6.0 replaced it with a two-value enum that could not express a triple. **The structural case for deleting the row stands entirely**: two pricing paths for one fact is DEC-03's defect, and `order_items.shots` is the right column of record. *But the fact `Extra Shot` encoded was real, and this section should say so rather than filing repeatability as an error.*

> **A consequence worth seeing**
>
> On a weekday a staff member's one free coffee may be a double — **and no more than a double, because T15 caps weekday shots at 2** (owner, 14 Sep 2026): nobody pays on a weekday, so a third shot is beans given away with no pricing question to settle, and charging for one would need a card step L19 says does not exist on a weekday. *The cost that cap bounds is about R6,600 a year if five office staff a day took a triple — 5 extra shots × ~250 weekdays × R5.29.* So **the entitlement caps cups, not beans** — bean cost per staff coffee is variable by design. That is correct, and it is why the weekly summary reports beans used and not only cups served.

### 10.6 Invariants

- **Never DELETE or UPDATE rows** in `stock_movements`, `audit_log`, `price_history` or `donor_fund_entries`, and **never delete a `voucher_redemptions` row** — a removed voucher writes `reversed_at` and `reversed_by_staff_id`, and the counts read live rows (COL-29). *A voucher redemption is what the tin count is reconciled against and it carries a value between R20 and R45; a cancelled fund draw is money to put back. Both are the same class of fact as a stock movement.* Void with a follow-up INSERT. Trigger-enforced on `audit_log` (migrations 0021 and 0025, including the TRUNCATE guard). **No policy or trigger protects `stock_movements` or `price_history` today** — §13 adds them; until then the rule is a convention, not a guarantee.
- **Money is integer cents** in `_zar`-suffixed columns. Never `numeric` — **with exactly one deliberate exception, retained on purpose: `inventory_lots.unit_cost_zar` is `numeric(10,4)`**, holding cents to four decimal places, because an ingredient can legitimately cost a fraction of a cent per base unit. *v5.2 called this column "one live exception that must be migrated" and commissioned a migration to integer cents — which would have rounded chocolate and chai to zero and deleted them from the cost model. **The column is right and the rule was wrong.** An invariant that would destroy data if enforced is worse than an invariant with a stated exception.*
- **Event price overrides are written in one transaction to both** `price_history` (source of truth, append-only) and `event_windows.price_overrides` (read snapshot). Where they disagree, `price_history` wins and the discrepancy is a bug. A daily check asserts equality (DEC-03).
- **A payment subject has at most one successful payment, and the database enforces it.** **Two partial unique indexes, because there are two kinds of subject** (COL-5): `CREATE UNIQUE INDEX ON payments (fund_topup_id) WHERE status = 'successful';` carries this across to fund top-ups, and without it they are *entirely unguarded* — Postgres treats NULLs as distinct, so two successful payments against one top-up would not collide. `CREATE UNIQUE INDEX ON payments (order_id) WHERE status = 'successful';` — **`ALREADY_RESOLVED` is the message; this index is the guarantee.** `yoco_payment_id`'s UNIQUE constraint does not cover it, because that column is NULL in the window before a send returns and after one times out. **This is S7b applied to tender** — the same double tap, on the side where the second row is a second charge.
- **A `yoco_deferred` order never survives the day's close.** `closeDaily()` **writes off** every one still unpaid. **The close never settles.** **An order is *unpaid* if it holds neither a successful payment nor a `donor_fund_entries` spend entry** — without that second clause every fund-paid order is written off as a bad debt on the day it was paid for (L47, §6.7).
- **At most one `opening_sessions` row is open at a time**, enforced by a partial unique index over `closed_at IS NULL`. *That is what makes "the current session" a definition and not a search* (§6.11.1), and it is why a revenue day may carry as many sessions as it needs without `mode`, `deferred_since` or `voucher_kinds_active` becoming ambiguous.
- Storage in `timestamp with time zone`; all wall-clock semantics in `Africa/Johannesburg`.
- **`orders.payment_mode` is never null**, and any report grouping by payment mode **fails loudly on an unknown value; it never defaults.**
- **A bound notification target always names a reachable customer.** The CHECK of §10.3. `orders.customer_id` is nullable today with no constraint tying it to the target, so a row can claim `notification_target='customer'` and carry no customer.
- **A margin figure is never green while an input is an estimate**, and never a number while an input is absent (§7.0.2's refusal rule, §7.0.1b's label). These are different failures with different remedies and must not be conflated.

### 10.7 The permission matrix

§10.7 in v5.1 named **tables**, not actions; §9.5 named two roles and no actions; §11's *Auth* column was filled in for some rows and absent for others. **A capable reader synthesises the answer — and a builder who synthesises a permission is a builder who guesses.** This table is the specification of record. **Where it disagrees with an *Auth* cell in §11, this table wins.**

|   |   |
| --- | --- |
| Public | No session at all |
| Public | No session at all |
| Customer | Supabase Auth session (§9.5.2). **Never any till authority** |
| Customer | Supabase Auth session (§9.5.2). **Never any till authority** |
| Barista | Staff PIN session, `staff.role='barista'` |
| Barista | Staff PIN session, `staff.role='barista'` |
| Admin | Staff PIN session, `staff.role='admin'` — the owner is an Admin |
| Admin | Staff PIN session, `staff.role='admin'` — the owner is an Admin |
| System | A server-side timer (§9.6.2). **No session, and no route to one** |
| System | A server-side timer (§9.6.2). **No session, and no route to one** |

**✔** allowed · **✖** denied · **PIN** allowed only with a single-action admin PIN override (§6.0.7, audited to `on_behalf_of_staff_id`) · **own** limited to the caller's own rows.

| Action / endpoint | Public | Customer | Barista | Admin | System |
| --- | --- | --- | --- | --- | --- |
| loginWithPin(pin) | ✔ | ✔ | ✔ | ✔ | ✖ |
| GET /api/healthz | ✔ | ✔ | ✔ | ✔ | ✔ |
| Customer register · log in · password reset | ✔ | ✔ | ✖ | ✖ | ✖ |
| POST /api/push/subscribe · DELETE | ✖ | ✔ own | ✔ | ✔ | ✖ |
| Set / edit The Favo | ✖ | ✔ own | ✔ | ✔ | ✖ |
| Order history (customer PWA) | ✖ | ✔ own | ✖ | ✖ | ✖ |
| openSession · setDayMode · broadcastOpeningWindow | ✖ | ✖ | ✔ | ✔ | ✖ |
| **closeSession** | ✖ | ✖ | ✔ | ✔ | ✔ *— forced at an event window's expiry, and at the day boundary (§6.11.1)* |
| searchCustomer · createOrder · transitionOrder | ✖ | ✖ | ✔ | ✔ | ✖ |
| cancelOrder — while ordered | ✖ | ✖ | ✔ | ✔ | ✖ |
| cancelOrder — from in_progress on | ✖ | ✖ | **PIN** | ✔ | ✖ |
| applyFreeCoffee · logWalkIn · logWaste | ✖ | ✖ | ✔ | ✔ | ✖ |
| compOrderLine — 1st and 2nd in a session | ✖ | ✖ | ✔ | ✔ | ✖ |
| compOrderLine — 3rd in a session | ✖ | ✖ | **PIN** | ✔ | ✖ |
| redeemVoucher · removeVoucher | ✖ | ✖ | ✔ | ✔ | ✖ |
| recordVoucherCount | ✖ | ✖ | ✔ | ✔ | ✖ |
| **createDonorFund** | ✖ | ✖ | ✔ | ✔ | ✖ |
| Read a fund's **balance** (the fund control) | ✖ | ✖ | ✔ | ✔ | ✖ |
| Read a fund's **ledger, draws and member list** | ✖ | ✖ | ✖ | ✔ | ✖ |
| beginFundTender *(the counter card top-up)* | ✖ | ✖ | ✔ | ✔ | ✖ |
| topUpDonorFund *(cash / EFT, off the POS)* | ✖ | ✖ | ✖ | ✔ | ✖ |
| drawFromDonorFund | ✖ | ✖ | ✔ | ✔ | ✖ |
| addFundName · removeFundName | ✖ | ✖ | ✖ | ✔ | ✖ |
| sweepDonorFund | ✖ | ✖ | ✖ | ✔ | ✖ *— §12.3: a job may propose, never write* |
| GET /api/admin/donor-funds | ✖ | ✖ | ✖ | ✔ | ✖ |
| beginTender · sendToTerminal · pollTenderResult · recordTenderResult | ✖ | ✖ | ✔ | ✔ | ✖ |
| resolveTenderByLookup | ✖ | ✖ | ✔ | ✔ | ✔ *(job 4)* |
| setDeferredMode — on | ✖ | ✖ | ✔ | ✔ | ✔ *(device check)* |
| setDeferredMode — off, when entered by check | ✖ | ✖ | ✖ | ✔ | ✔ |
| setDeferredMode — off, when entered manually | ✖ | ✖ | ✔ | ✔ | ✖ |
| settleDeferredOrder | ✖ | ✖ | ✔ | ✔ | ✖ |
| Write off a deferred order by hand, before the close | ✖ | ✖ | **PIN** | ✔ | ✔ *(closeDaily)* |
| openContainer · closeContainer · listOpenContainers | ✖ | ✖ | ✔ | ✔ | ✖ |
| GET /api/queue/stream | ✖ | ✖ | ✔ | ✔ | ✖ |
| POS Day summary · history | ✖ | ✖ | ✔ | ✔ | ✖ |
| openEventWindow · closeEventWindow | ✖ | ✖ | ✔ | ✔ | ✔ *(auto-close at ends_at)* |
| createEventProfile · updateEventProfile | ✖ | ✖ | ✖ | ✔ | ✖ |
| setEligibleCategories · setMenuItemPrice · runStockTake · logExpense | ✖ | ✖ | ✖ | ✔ | ✖ |
| Recost a lot / set cost_source = 'invoice' | ✖ | ✖ | ✖ | ✔ | ✖ |
| Approve a write-off in the §6.0.5 queue · approveMonthlyPnL · approve purchases | ✖ | ✖ | ✖ | ✔ | ✖ |
| Staff & PINs · barista rota · stock-alert recipients | ✖ | ✖ | ✖ | ✔ | ✖ |
| app_config writes — incl. webpos_device_id | ✖ | ✖ | ✖ | ✔ | ✖ |
| GET /api/cogs/live · /api/cogs/stream · getMinistryRollup · /api/reports/export | ✖ | ✖ | ✖ | ✔ | ✖ |
| GET /api/admin/unpaid-orders · /api/admin/audit-coverage · /admin/write-downs | ✖ | ✖ | ✖ | ✔ | ✖ |
| Read audit_log | ✖ | ✖ | ✖ | ✔ **read only** | ✔ **insert only** |
| Update or delete audit_log | ✖ | ✖ | ✖ | ✖ | ✖ |
| closeDaily() · generateWeeklyPnL() · checkLowStock() · the collected sweep · importYocoTransactions | ✖ | ✖ | ✖ | ✖ *(may not invoke)* | ✔ |
| Upload the Yoco export the import reads | ✖ | ✖ | ✖ | ✔ | ✖ |
| requestRefund · approveRefund · redeemLoyalty · topUpWallet · purchasePack · confirmExternalTender · POST /api/payments/yoco/webhook | ✖ | ✖ | ✖ | ✖ | ✖ **— removed** |

**Four properties this table asserts, each previously only implied.** **(1) No Admin may run a timer.** An Admin who could invoke the close by hand could close a day twice. The live `/api/crons/*` endpoints are removed or gated to the internal caller in §13.4. **(2) An admin PIN override is single-action and recorded.** It never starts an admin session and always writes `on_behalf_of_staff_id`. **(3) A denial is audited** — `action='reject'` with a reason, including every ineligible-category entitlement attempt, which R14's anomaly detection depends on. **(4) Nothing in the Customer column can reach money, stock, or another person's row.** Ordering is in-person and barista-driven (L05), and this is where that rule is enforceable rather than stated.

> **Two further properties, asserted by v7.0's rows**
>
> **Nothing in the Customer column reaches a fund** — not its balance, not its ledger, not a top-up. *That is L44 made enforceable rather than stated*, and it is the same argument §10.7 already makes for L05.
>
> **A barista can create a fund, fund it, draw from it and read its balance. They cannot rename it, re-link its names, sweep it, or read its ledger.** Owner decision, 14 Sep 2026: *the counter handles transactions and the desk handles the entity.* This is thinner separation of duties than an Admin-creates design, chosen so a generous person at the counter is served on the spot — **and R22 is the price, recorded at Low/High with its mitigations rather than argued away.**
>
> **`createDonorFund` is the first entity-creating action a barista may call.** Every other one in this table — `createEventProfile`, `logExpense`, `setMenuItemPrice`, recosting a lot — is Admin-only. *That is a deliberate departure, not a contradiction, and it is named here so a reviewer reading the matrix does not take it for an oversight and quietly "correct" it.*

**`resolveTenderByLookup` is the one row with both a human and a system caller**, and that is deliberate: it is a read against Yoco followed by a record of what Yoco said. It can be triggered by a barista from the settlement screen or by job 4 on a schedule, and in neither case can it initiate a payment.

## 11 — API surface

Server Actions for mutations (`src/server/actions/*`). Route handlers for queries. SSE for the live queue. **All ordering and tender flows are barista-only.**

### 11.1 Removed

| Action | Note |
| --- | --- |
| redeemLoyalty · loyalty earn on payment · GET /api/admin/loyalty-liability | §8.1 |
| topUpWallet | §8.2 — **already removed.** Listed for the record; no work remains |
| purchasePack | §8.3 |
| actions/sync-conflicts.ts + the admin conflict-resolution surface | §8.4 — the reconciliation layer goes; the outbox and its idempotent retry stay |
| requestRefund · approveRefund + the refund admin surface | **L02.** Both exist and are already hard-stubbed no-ops. **The remedy for a wrong charge is a comped replacement drink under L33, never a reversal.** The `refunds` table and enum drop with them (§10.1) |
| POST /api/payments/yoco/webhook | **Removed with the Online flow.** FAVO fetches payment status server-side and subscribes to no webhook (§6.8, §9.6), so this endpoint confirms payments that no longer exist. *It is a live, publicly reachable, payment-mutating endpoint with no remaining caller* — §13.4 enumerates its footprint and §10.1's grep gate must return zero. **Retired, not re-pointed** (§13.0) |
| **confirmExternalTender · markTenderUnknown · recordTenderHandle** | **New removals in v6.0.** All three existed only for Phase 0 or for the iOS SDK's two-identifier recovery. `confirmExternalTender` was the barista attesting an amount matched — the one path where a human assertion created revenue (§10.2.1). `markTenderUnknown` was the *"not sure it went through"* button, which exists because FAVO could not see the machine; it can. `recordTenderHandle` persisted the SDK's synchronous transaction id; the send call now returns Yoco's payment id and `sendToTerminal` writes it |

### 11.2 Added

| Action | Auth | Behaviour |
| --- | --- | --- |
| openSession(opensAt) | barista | **Creates the `opening_sessions` row for today** and returns its id, which `setDayMode` and `broadcastOpeningWindow` consume. ⛔ **v5.2 had no action that created this row** — absent from every §11 table, in a document whose headline clause is that silence is not delegation, while `NO_SESSION` *"blocks all ordering."* **As many sessions as a revenue day needs, and at most one open at a time** (§6.11.1): `UNIQUE (session_date, opens_at)` plus a partial unique index over `closed_at IS NULL`. **Rejects with `STALE_STATE` while a session is open**, not while a row exists for today — *a second session on the same date is the normal path, not an exception.* Snapshots `voucher_kinds_active` from the session's event window (§6.11.2). Errors: `AUTH_REQUIRED`, `STALE_STATE` |
| setDayMode(sessionId, mode, eventWindowId?) | barista | Sets `opening_sessions.mode`. Called from the opening-window step, defaulted from the date. Audited |
| broadcastOpeningWindow(sessionId) | barista | Push to the audience computed from mode: office staff on weekdays, office staff + church members on Sundays, the profile's audience on events. **Never a hand-picked list** |
| logWalkIn(orderId, menuItemId, quantity) | barista | Inserts `walk_ins`. **Never charges. Never touches `staff_entitlement_log`** |
| setEligibleCategories(list) | admin | Config change for the free-item entitlement. Audited (T06) |
| createEventProfile · updateEventProfile | admin | The reusable template — recurrence + **six** switches (§6.6, §10.2) |
| openEventWindow(profileId?, input) · closeEventWindow(id) | barista / admin | Opens an occurrence, snapshotting the switches. **Requires `ends_at`**; rejects windows > 24 h (L27). `closeEventWindow` is an **early** close; expiry at `ends_at` is automatic regardless |
| getMinistryRollup(from, to) | admin | Weekday cost + Sunday revenue and cost + event columns, netted (§7.2). **In v7.0 `ministry_cost` gains `outreach_cogs` and `ministry_income` gains Admin-confirmed sweeps**, and contribution is summed **per paid session** rather than per paid day (§7.0.2, COL-10) |
| logExpense(category, amount_zar, incurred_at, note?) | **admin** | Records an operating expense — rent, utilities, wages, consumables. ⛔ **The `expenses` table exists and its only writer is a demo seed.** §13.0 starts clean, so without this `ministry_cost`'s expense term is **permanently zero** and §7.2's rollup reports FAVO's cost as COGS only. Surfaced at `/admin/expenses` |
| setDeferredMode(sessionId, on, reason) | barista | Puts the till into, or out of, deferred mode. Writes `opening_sessions.deferred_*`, records `deferred_entered_by='manual'`, and **fires S2a's Admin push.** Audited with the reason. *Introduced in §6.0.4 in v5.1 and never added to this table, so it had no auth, no return contract and no audit obligation* |
| settleDeferredOrder(orderId, ref?) | barista | Settles an open unpaid order — by attaching a payment a lookup recovered, by sending a fresh one, or by recording the standalone machine's reference. **Queries Yoco before it sends** (T3 3a). Rejects an order already settled or written off. Audited |
| GET /api/admin/unpaid-orders | admin | Every **unpaid** order — `yoco_deferred`, plus any `yoco` order with no successful payment (S3a) — with its `daily_seq`, **age** and **value**. *Defining it over `yoco_deferred` alone hid the S3/S4 orphans from the only list an Admin reads* |
| **beginTender(orderId)** | barista | ⛔ **Allocates the tender attempt, and nothing in v5.2's §11 did.** P1 and P3 both require a `payments` row carrying the reference to exist **before** the send, and no action created it — so the one step the whole double-charge apparatus rests on had no name, no auth and no error contract. **Behaviour:** reads `orders.client_uuid`; takes `attempt = MAX(attempt) + 1` or 1; inserts `payments` with `status='pending'`, `client_reference = client_uuid \|\| ':' \|\| attempt`, `amount_zar = orders.total_zar`, `webpos_device_id` from config **read once, here**, and `at`; writes `audit_log`; returns `{ attempt, client_reference, amount_zar }`. **From this moment `orders.total_zar` is frozen** — this is P4's enforcement point, enforced rather than described: `createOrder`, `compOrderLine`, `applyFreeCoffee` and `cancelOrder` all reject with `TENDER_IN_PROGRESS` while an attempt is `pending` or `unresolved`. **Serialised per order** (`SELECT … FOR UPDATE`), so two taps cannot allocate two attempts. **Amended in v7.0:** it **rejects an order whose net charge is R0** (L42, DEF-C) — nothing is sent, no `payments` row is created, and the order completes as `payment_mode='free'` — and **rejects an order already settled from a fund**. Its `TENDER_IN_PROGRESS` freeze list gains `redeemVoucher`, `removeVoucher` and `drawFromDonorFund`. Errors: `AUTH_REQUIRED` · `NO_SESSION` · `STALE_STATE` · `ALREADY_RESOLVED` · `TENDER_IN_PROGRESS` · `VALIDATION` |
| **sendToTerminal(orderId, attempt)** *(new)* | barista | Sends `amount_zar` and `client_reference` to the configured Web POS device (§6.8.2). **Writes Yoco's returned payment id onto `payments.yoco_payment_id` and `sent_at` immediately, before any outcome is known.** 10 s timeout. **Never called twice for one attempt** — a second call for the same `(orderId, attempt)` is a `VALIDATION` failure, never a re-send. Errors: `TERMINAL_UNREACHABLE` · `GATEWAY_UNAVAILABLE` (error with no id — nothing sent) · `PAYMENT_UNKNOWN` (timeout — an id may exist that FAVO does not hold, so recovery is by `client_reference`) · `STALE_STATE` |
| **pollTenderResult(orderId, attempt)** *(new)* | barista | Fetches the payment's status resource on S2's schedule and writes `last_checked_at`. Returns the status unchanged; **it never interprets an error as a status.** At the **180 s** ceiling it writes `status='unresolved'`, fires S4a's push, and returns `PAYMENT_UNKNOWN` |
| recordTenderResult(orderId, attempt, result) | barista | Records a terminal outcome. `successful` → `status='successful'`, `charged_amount_zar`, `tip_zar`; `failed` → `status='declined'`. **Asserts `charged_amount_zar == orders.total_zar`** — both integer cents, **no factor** — and a mismatch is **recorded at the charged amount** and flagged to T10, never overwritten. **Idempotent on `(orderId, attempt)`**, so a retried submission of the same result cannot create a second payment row. *v5.2 asserted a × 100 conversion, which would have failed on every transaction and flagged every card sale to T10 as a variance* |
| **resolveTenderByLookup(orderId)** *(new)* | barista · **system** | **S4's recovery, and the action that makes recovery independent of anyone standing at the till.** Fetches the status of every `pending` and `unresolved` attempt on the order, by `yoco_payment_id` where FAVO holds one and by `client_reference` where it does not. Attaches a `successful` result; records a `failed` one against S4 step 3's two-negative test; leaves everything else `unresolved`. **Two successful results is a `duplicate_charge` flag and an immediate Admin push** (§6.8.4). **It never sends a payment.** Callable by a barista from the settlement screen, and by job 4 on a schedule |
| importYocoTransactions(revenue_day) | system | ⛔ **Where the input comes from, which v5.2 never said.** **Yoco's own transaction export for that revenue day, uploaded by an Admin at `/admin/reports`**. **There is no automatic fetch**, because FAVO holds no verified Yoco credential for one (§6.8.3 records the untested REST alternative). Ingests one revenue day and writes `payments.fee_zar`, `receipt_no`, `tip_zar`. **06:00 SAST, catch-up on startup, idempotent on `(revenue_day, yoco payment id)`.** Matches on `yoco_payment_id`, falling back to `client_reference`; **ambiguous or unmatched rows go to T10's exception list and are never guessed.** Writes an `audit_log` row with `actor_kind='system'`. **It never writes `payments.status`** — it annotates revenue, it cannot create it. Pushes the Admin at 09:00 if no export has been uploaded |
| **closeSession(sessionId)** [new in v7.0] | barista · admin · **system** | Ends the current session: sets `closed_at`, **prompts for that session's voucher slip count**, and clears session-scoped state. **Distinct from `closeDaily()`**, which stays per revenue day. Called by the system when an event window expires (L27, COL-11) and forced at the day boundary — *a session running past midnight is a session that failed to close, not a new day* (L07). Audited |
| **redeemVoucher(orderItemId, kind)** [new in v7.0] | barista | Writes `discount_zar = line_unit_price` for **one unit** — listed price, modifications and extra-shot surcharge together (§6.9.2a) — and one `voucher_redemptions` row. **Rejects**: a line already carrying a *different* discount mechanism (L41); a line already carrying `quantity` redemptions; a kind not in the session's `voucher_kinds_active`; **a line with no net charge to remove** — a free event or a weekday cup, where a voucher buys nothing and can only be a mis-tap; and any call while a tender is open or the order is fund-settled (P4). Audited. Errors: `VOUCHER_NOT_IN_MODE · TENDER_IN_PROGRESS · VALIDATION` |
| **removeVoucher(orderItemId)** [new in v7.0] | barista | The undo, and the same tap. **Writes a reversal, never a delete** (COL-29) — sets `reversed_at` and `reversed_by_staff_id` on the redemption and restores the line. **Counts and values read live rows only.** Audited. Rejected once a tender is open or the order is fund-settled |
| **recordVoucherCount(sessionId, counted)** [new in v7.0] | barista · admin | Writes `opening_sessions.voucher_slips_counted` — **keyed to the session, not the day** (§6.11.1). Prompted by `closeSession`. A variance raises the L09 admin push as a digest line. **Never blocks the close** (L43) |
| **createDonorFund(input)** [new in v7.0] | barista · admin | Issues the fund's code, records the non-refundability acknowledgement (L45), and takes §6.10.2's one question — *for specific people* or *for anyone* — which sets the linked names. A display name is optional; **creating an unnamed fund fires an immediate Admin push naming the barista, the amount and the code, and never blocks** (R22). Names are editable afterwards by an Admin only — `addFundName` / `removeFundName`, audited |
| **beginFundTender(fundId, amount)** [new in v7.0] | barista | The POS card path. Allocates the attempt, freezes the amount, writes a `pending` `top_up` entry and a `payments` row keyed on `fund_topup_id`, **minting its own `client_uuid`** on P3's rule so a timed-out top-up is recoverable by reference. **Serialised per fund** (`SELECT … FOR UPDATE`), so two taps cannot open two attempts. **Rejects an amount above T13 before anything reaches the machine.** From here the existing `sendToTerminal` · `pollTenderResult` · `recordTenderResult` · `resolveTenderByLookup` chain runs unchanged, including every error path and the 180 s ceiling. **In deferred mode it returns `TERMINAL_UNREACHABLE` and writes nothing** — *there is no deferred top-up: unlike a coffee, a gift can wait.* Errors: §6.0.1's payment set, plus `VALIDATION` |
| **topUpDonorFund(fundId, amount, method, reference)** [new in v7.0] | **admin** | The cash and EFT path, off the POS. Rejects a top-up carrying the fund above T13, and **a missing reference — a `VALIDATION` failure, not a warning.** Audited with the Admin's id and a reason |
| **drawFromDonorFund(orderId, fundId)** [new in v7.0] | barista | Locks the fund row, computes the balance from the ledger, **audits**, writes a `spend` entry and `orders.payment_mode='donor_fund'`. **Never writes to `payments`** (§10.2.1, L47). **Freezes the order's total exactly as P4 freezes it during a card tender.** Rejects an order with no net charge, an insufficient balance, and — where the fund has linked names — an order bound to anyone not on the list. Errors: `FUND_INSUFFICIENT · FUND_UNAVAILABLE · FUND_NOT_LINKED · TENDER_IN_PROGRESS` |
| **sweepDonorFund(fundId, reason)** [new in v7.0] | **admin** | Moves a dormant balance to ministry income. **An Admin action, never a job** — §12.3 forbids a scheduled job creating revenue, so job 7 writes an Admin task and nothing else (§6.10.4). Audited with a reason |
| **GET /api/admin/donor-funds** [new in v7.0] | admin | Every fund with its balance, last draw, member list and the period's entries, **listed in draw order with each one's queue position and a depletion estimate** from the last thirty days' rate — rendered `UNAVAILABLE` rather than guessed while fewer than thirty days of draws exist (§6.10.6) |
| compOrderLine(orderItemId, reason) | barista | Comps one order line to R0 under L33. Writes `discount_zar` and `comp_reason`; `reason` NOT NULL and from L33's closed list. **Rejects** a second line on the same order, a value above `min(line_gross − discount_zar, (highest live menu price + (T15 − 2) × extra_shot_zar) × quantity)`, **a line already carrying a voucher or an entitlement** (L41), or a third comp in one session without an admin PIN — `COMP_LIMIT`. Audited with the reason. *Both ceiling terms changed in v7.0: the first because a line must never be discounted past its own **remaining** value (DEF-B), the second because there is no double-shot surcharge any more (COL-2)* |

> **Several sessions a day — v7.0 reverses v6.0's narrowing, and answers its objection**
>
> v6.0 narrowed this to `UNIQUE (session_date)` and dropped the reopening concept, for a good reason: *"`NO_SESSION` is satisfied by any row, while mode is 'the day's mode' and `deferred_since` is session-scoped — so with three rows for one Tuesday, nothing says which carries the mode or which the deferred banner reads."*
>
> **The ambiguity was never about how many rows a day has. It was about how many are open at once** (§6.11.1). Sessions are sequential: **at most one is open at a time**, so *the current session* is a definition, not a search, and `NO_SESSION` means exactly what it meant before. **The shipped constraint at `9aefc2c` — `unique(session_date, opens_at)`, with `addTodaySession`/`getTodaySessions` — is retained**, and the one genuinely new object is the one-open-session index. *This is largely not doing part of a migration v6.0 commissioned, and §13.2's clause commissioning it is struck (COL-14).*

### 11.3 Amended

| Action | Change |
| --- | --- |
| searchCustomer(query) | Stops returning `loyalty_points`. Returns `status` and the customer's Favo. ⛔ **Its full contract is §6.9.4a and that contract governs** — what it matches, the minimum query length, the result cap and ordering, how two people with one name are told apart, what a zero-result search does, and **that it never blocks the order path** (L35). *v6.0 left this action in §11.3 with an amendment note and no contract, so §11.4's baseline-of-record rule pointed at the shipped code: any divergence at `9aefc2c` is now **a change to be made, not a specification to be corrected** (DEF-F, COL-12). Read it against the code once before the build, so the size of the change is known rather than discovered.* |
| createOrder(input) | **Mode-aware.** **Requires a `notification_target`** (L28). On weekday mode — and on events with `payment_posture='free'` — creates with `payment_mode='free'` and **never begins a tender**. Tags `event_window_id` when an event is in force. **Applies the extra-shot surcharge** where it applies — `extra_shot_zar × MAX(0, shots − 2)` per unit — landing the amount on the `order_items` line so revenue stays attributable (T09, DEC-16). **Accepts a per-line `shots`**, which the segmented picker of §6.2.3c sets, and **opens a new line where the configuration does not match an existing one** (L37, DEF-E). **Creates with `payment_mode='yoco_deferred'` when the till is deferred**, subject to S7a. Mints `client_uuid`, `revenue_day` and `daily_seq` in the same transaction. **Accepts a per-line `quantity`**, which the stepper of §6.2.2 sets |
| transitionOrder(id, toState) | `in_progress` deduction becomes mode-, event- and `shots`-aware, **and may span two containers inside one transaction** (§10.5, DEF-G). `ready` fires push to the registered customer and no-ops for target `none`, and sets `completed_at`. Loyalty accrual removed |
| applyStaffDiscount → **applyFreeCoffee(orderId, beneficiaryCustomerId)** | **Signature change.** The beneficiary becomes a `customers.id` with `status='office_staff'`, not a `staff.id` (§10.3.1, L03). Rejects church members and FAVO-staff ids. Eligible categories from config (T06). **Discounts one unit, never the line and never the order** — the shipped `applyStaffDiscount` sets `orders.total_zar = 0`, zeroing the entire order. **The rename is worth the churn: the old name is what made the bug invisible** |
| cancelOrder(id) | A barista may cancel while the order is in `ordered`. From `in_progress` onward it **requires an admin PIN** and writes compensating `stock_movement` rows; originals are never edited. **L02 still applies:** cancelling a paid order corrects stock and the record, it does not return money. Audited either way, naming the overriding admin (DEC-10) |
| closeDaily() | ⛔ **Its definition of *unpaid* must exclude a fund-paid order.** The sweep writes off every order with no successful payment, and a fund draw deliberately writes no `payments` row (L47) — so without this, *every fund-paid order is written off at the close as a bad debt, on the day it was paid for.* **An order is settled if it holds a successful payment *or* a `donor_fund_entries` spend entry**, and `GET /api/admin/unpaid-orders` takes the same definition. It also **carries the day's voucher variance into `daily_closes`** by aggregating its sessions, and surfaces it on §7.3.1 — **without blocking on it** (L43). Write-off first and unconditionally — **every unpaid order, never a `free` one** (S3a) — then reconcile. On mismatch, blocks **only the close record** and raises an in-app admin alert plus Web Push. **It never settles.** Writes `daily_closes`, and raises the write-off approval queue of §6.0.5 |
| GET /api/cogs/live · /api/cogs/stream | Both need the **per-mode split** (§7.1) and the `cost_source` labelling. `/api/cogs/stream` has no baseline spec anywhere, so its contract is §11.4's: admin auth, SSE, the same `id:`/`Last-Event-ID` contract as the queue stream |
| generateWeeklyPnL() | Needs the mode split, the walk-in count, the event section, the push + in-app screen, **a per-barista line for all five discretionary acts — comps, write-offs, abandoned orders, *voucher redemptions as a count and a value*, and fund draws** (§7.3.1, §05) — a deferred/write-off row for every mode, **margin broken out by shot count** (§7.1), and **`outreach_cogs` shown beneath `cogs_zar`** rather than folded into it (§6.9.4). Its formulas are §7.0.2's |
| runStockTake | Variance computation must honour the **T08 lid band** (§7.4) |
| setMenuItemPrice(id, priceZar) → **setMenuItemPrice(id, priceZar, reason?)** | ⛔ **It cannot stay unchanged and it would fail on the first use.** §10.3 adds `price_history.set_by_staff_id` **NOT NULL**, and the shipped action inserts a `price_history` row **without an actor**: every price change would violate NOT NULL and the write would fail. Admin only; closes the current row (`effective_until = now`), inserts the new one carrying `set_by_staff_id` from the session and `reason`. Errors: `VALIDATION` · `NOT_FOUND` · `NO_CHANGE`. **The change takes effect for *future* orders only** — lines snapshot at ring-up, so no past order re-prices |

### 11.4 Unchanged — and specified, not delegated

> **The circle this closes**
>
> Nine actions delegated their entire specification to `docs/API.md` — **51 lines, one sentence each, no request shape, no response shape, no error codes** — while §13.6 instructs the builder to rewrite `docs/API.md` **from this PRD.** **The circle contained no specification anywhere in it.**
>
> **It is broken in two places.** First, **the baseline of record for unchanged behaviour is the pinned code at `main @ 9aefc2c`, not `docs/API.md`** — the code is what actually runs, and every contract below was read out of it rather than inferred. Second, **§13.6's rewrite of `docs/API.md` must be generated from §11, never consulted by it.** *"Unchanged" now means: unchanged against the behaviour stated below.*

**Conventions apply to every row** (§11.5): `"use server"`, Zod at entry, tagged-union returns `{ok:true,data} | {ok:false,code,message}` — **they never throw for auth or validation** — `writeAudit()` on every mutation, RBAC server-side, roles per §10.7. `AUTH_REQUIRED` and `FORBIDDEN` are therefore **implicit on every authenticated row** and are not repeated. *In the code these arrive as `UNAUTHORIZED` / `FORBIDDEN`; `UNAUTHORIZED` is renamed `AUTH_REQUIRED` for consistency with §6.0.1's register — a one-word rename, listed in §13.6.*

| Action | Auth | Request → Response | Errors | Rules that bind it |
| --- | --- | --- | --- | --- |
| loginWithPin(pin) | **public** | `pin: string`, 4–6 digits → `{ staffId, name, role }` | `INVALID_PIN_FORMAT` · `INVALID_CREDENTIALS` · `AUTH_ERROR` | **The PIN is never logged, echoed or audited** — a failed attempt writes `action='login_failed'` with a reason and **no attempted value**. **Both branches audit.** **Not rate-limited for a till session**, and rate-limited for a PIN entered as an admin override at 5 attempts (§9.5.3). The session it mints obeys §9.5.1 |
| logWaste(input) | barista · admin | `{ category: expired\|damaged\|spilled\|overproduction\|other\|abandoned, inventoryLotId?, quantity ≥ 1, reason, orderId? }` → `{ wasteLogId }` | `VALIDATION` · `NOT_FOUND` · `INVALID_LOT_STATE` | Writes `waste_log` **and** `stock_movements(kind='waste')` **atomically** — one transaction, never two. `abandoned` and `order_id` are §10.3's additions, and T6 step 2b writes both |
| openContainer(itemId) | barista · admin | `inventoryItemId` → `{}` | `CONFLICT` (one already open) · `NOT_FOUND` (no sealed container) | Opens the **FIFO-oldest sealed** container (L17). **Serialised per item by a Postgres advisory lock**, so two POS taps cannot open two containers. `unit_cost` is fixed at open and never re-read |
| closeContainer(lotId) | barista · admin | `lotId` → `{}` | `NOT_FOUND` · `CONFLICT` | Leftover cups are written off with a **COGS-neutral adjustment** — the cost was booked at open, so booking it again would double-count it |
| listOpenContainers() | barista · admin | — → `{ containers: [...] }` | — | Drives the POS open-containers card. **Read-only, so it has no audit obligation** — the one row here where that is true, stated so its absence is not read as an omission |
| checkLowStock() | **system only** | — → `{ checkedItems, pushAttempts }` | raises; never retries silently | §9.6.2 job 1. Recipients from `stock_alert_recipients`. **A missed run is skipped, not caught up.** ⚠ *`docs/API.md` lists this as an action; it is a job, and §10.7 gives it no human caller* |
| approveMonthlyPnL(reportId) | **admin** | `reportId` → `{}` | `NOT_FOUND` · `CONFLICT` (already closed or signed) | Sets `admin_sig` and closes the report **immediately and irreversibly.** DB CHECK enforces `status='closed'` ⇒ `admin_sig` present. Formulas are §7.0.2's |
| GET /api/queue/stream | barista · admin | **SSE.** `event: state_change` → `{orderId, state, at}` · `event: heartbeat` → `{at}` · each carrying an `id:` | `401` with no session — **and only 401; there is no anonymous read** (L23) | Heartbeat **every 30 s**; `maxDuration` 60 s per invocation, so **the client reconnects roughly every minute by design** and the reconnect path is the normal path. Catch-up on `Last-Event-ID` is S6, and it is what makes a reconnect lossless |
| GET /api/reports/export | **admin** | `?format=csv\|pdf` · `?kind=sales\|cogs\|inventory\|monthly_pnl` · `?from` · `?to` → 200, streamed | `403` · `400` bad format, kind or dates | **Every successful export writes an audit row** — an export is a data egress and §9.4's POPIA commitments apply to it. **Fee-dependent columns render UNAVAILABLE, never zero**, on any day whose import has not run, and **estimated costs are labelled in the export, not only on the dashboard** (§7.0.1b) |
| POST /api/push/subscribe · DELETE | barista · admin · **customer (own)** | `{ customerId?, subscription }` → `{ ok: true }` | `401` · `400` invalid JSON or malformed subscription | ⛔ **A customer's own session always wins over a `customerId` in the body** — otherwise one customer could overwrite another's subscription. Audited on both verbs. **L29: never store a subscription the device cannot honour** |

**Three endpoints had no baseline specification anywhere** — not in `docs/API.md`, `docs/BUSINESS_RULES.md`, `docs/DATA_MODEL.md` or `docs/HANDOVER_LOOSE_ENDS.md` — while §05 and §9.8 depend on two of them. This is now their spec of record. `GET /api/healthz`: no auth, `200 {ok:true, db:"up", ts}` or `503 {ok:false, db:"down"}`, liveness only, no PII, **never a 500** — this is §9.8's monitoring contract. `GET /api/admin/audit-coverage`: admin, `200 {mutations, audited, coverage_pct, gaps:[...]}` — **§05's 100% criterion reads this.** `/api/cogs/stream`: admin, SSE, the same contract as the queue stream.

### 11.5 Conventions

- `"use server"` on all actions. Zod validation at entry.
- Tagged-union returns. **They never throw for auth or validation — always check `res.ok`.**
- **Every mutation calls `writeAudit()`. Failure to audit fails the transaction.** Every *refusal* audits too, with `action='reject'`
- RBAC server-side via `getSession()`. UI is advisory.
- State transitions use `SELECT … FOR UPDATE`.
- **Every externally-keyed write is idempotent on that key, and where no such key exists FAVO never retries.** Yoco documents no idempotency mechanism for a payment send, so a card payment is resolved by lookup and never repeated (S4, OPEN-10).
- **Never log or echo a PAN — masked or otherwise — a CVV or an expiry.** §9.10.2's adapter is the enforcement point, not this bullet.

## 12 — Business rules

### 12.1 Locked — require a PRD amendment to change

L01–L34 carry forward from v5.2. **L35–L40 are new in v6.0** and carry the decisions that closed OPEN-01, OPEN-03, OPEN-13, D.5 and OPEN-06, plus the payment boundary the web route makes a rule rather than a property. **L41–L48 are new in v7.0** and carry the voucher, the blessing fund and the three discount defects they surfaced. **L19, L31, L33, L37 and L38 are amended**, and **L18 and L21 each gain one clause** — every one of them is marked below. **Retired rule numbers — do not reuse:** `L06` (loyalty) and `L16` (wallet and coffee packs). The numbers stay burned so an old reference fails loudly instead of silently matching a new rule.

**L01** — **Payment is required where payment applies.** On Sunday orders and on events with a paid posture, an order without a successful payment record is never completed. **On a standard weekday order, and on any event with `payment_posture='free'`, there is no payment step at all** — the order is created with `payment_mode='free'`.

**Exceptions:** `yoco_deferred` (DEC-02) — during a machine outage an order may be completed without a payment record, and **must be settled or written off before that day's close succeeds**; and a fully comped order, which carries `payment_mode='free'` in any mode (S7c). A declined payment **pauses** an order, it does not cancel it (S3).

**L01 is now enforceable in software on every route.** v5.2 had to record that in Phase 0 *"a human attests"* and that L01 was not enforceable — **that exception is gone with Phase 0.** A successful payment record is a status Yoco reported, never a barista's assertion.

**L02** — **No refunds.** FAVO does not process refunds. **Rationale, recorded because L02 is load-bearing:** a refund needs a reversal path through the terminal, an approval role, and a reconciliation against Yoco's payout, and the café's exposure is one drink at ~R20. *Considered and rejected:* a full-refund action for admins — retains the entire failure class for R20 of exposure; a same-day void window — same machinery, narrower, **and there is no void to build it on** (§6.8.4).

**The remedy for a wrong charge is a comped replacement drink (L33), visible in the Day summary, never a reversal.** §6.7 calls over-collection *"the risk it must never create"* precisely because L02 leaves no remedy — which is why the comp exists.

**L03** — **Free weekday coffee: one cup per office staff member per weekday.** The beneficiary is an **office staff member** — a `customers` row with `status='office_staff'` — *not* a FAVO staff member.

**The entitlement is applied automatically** when the mode is weekday, the matched customer is `office_staff`, and the item is in the eligible-category list — **the barista taps only to *decline* it.** A dedicated claim screen is for exceptions, never the normal path. *v5.0 had the barista apply it manually on a separate screen, which made a free weekday cup cost ~7 interactions and a typed name for a drink nobody pays for, 63 times a day — while §7.4 rejected a lid toggle for costing one tap on 45 Sunday orders. The same arithmetic has to apply to both.*

**One cup means one unit, and this needed saying.** The entitlement zeroes **exactly one unit of one eligible line** — `line_discount = line_unit_price`, applied once — **never a whole line and never a whole order.** Enforced at the DB by `UNIQUE(customer_id, day)` **and** in `applyFreeCoffee` by discounting one unit rather than the line.

**"Weekday" requires both `mode='weekday'` and the date falling Mon–Fri in SAST** — a double condition that can never disagree, because a Saturday session cannot be opened without an event. The redundancy is a guard, not an oversight. **Baristas are eligible via their own `customers` row** (DEC-11). Ineligible-category attempts are rejected at the application layer **and audited** (§10.3.2).

⛔ **Not correctly implemented today, and the gap is material.** `staff_entitlement_log.staff_id` is a foreign key to the **staff** table, so the entitlement can only be granted to one of the ~3 FAVO staff. **The ~63 office staff the benefit exists for cannot receive it at all.** Fix in §13.2; risk R15; migration in §10.3.1.

**L04** — **Operating hours are display-only.** The system never rejects an order based on time of day.

**L05** — **Ordering is in-person only.** Baristas create all orders. Customers have no write access to `orders`.

**L07** — **Midnight SAST is the revenue-day boundary.**

**L08** — **Every inventory adjustment writes an audit row.** Trigger-enforced.

**L09** — **Stock reconciles with sales before daily close.** `closeDaily()` blocks the close record on a mismatch and **raises an in-app admin alert plus Web Push to the Admin role. No other channel carries this alert** — v4 made Discord the paging channel, and the replacement must land before the deletion so the alert is never lost (§8.10).

**L10** — **Emergency purchases require admin approval.** DB CHECK.

**L11** — **Monthly P&L requires Admin sign-off to close.** DB CHECK.

**L12** — **The audit log is append-only.** UPDATE and DELETE trigger-denied forever. Not disableable by any role.

**L13** — **FAVO data is tenant-isolated to `hofmi`.** RLS-enforced.

**L15** — **The barista taps Done to mark an order ready.** One person owns the full order lifecycle. **Done must be the most prominent action on the active-order view.**

**L17** — **Milk and beans use the container model.** Tracked as bottles and bags (cups), not ml and g. One coffee = one cup from the OPEN container; at most one open container per item; open and close on the POS, auto-opening the next sealed container so coffee never stalls.

**L18 [amended in v7.0]** — **Mode is derived from the calendar date's day-of-week in `Africa/Johannesburg`, never from a counter or rolling schedule**, and is confirmed in the opening-window step. Mon–Fri → Weekday; Sun → Sunday; **Sat → no default and no selectable mode**; **any *session* whose window overlaps an event window → Event.** Never a separate action. Always overridable in one tap, before the broadcast is sent.

**The word is *session*, and it is doing work** (COL-8). A revenue day can carry two sessions, so a default computed against the *day* would give a Sunday morning Untracked Church's event mode — wrong payment posture, wrong reporting column, wrong audience. And a default computed against `now` would fail the other way: a barista opening the evening session at 17:45 for an 18:00 service finds no window in force and gets `sunday` instead, *which they would override every single week — exactly the failure §6.6 built recurrence to prevent.* **A session's default is computed against that session's own window, by overlap.**

**L19 [amended in v7.0]** — **Card payment is used on Sundays and on paid events only.** **No *order*** on a standard weekday or at a free event carries a payment step, and **no such order ever sends anything to the card machine.**

**Scoped to orders, which is what it always meant** (COL-1). **A blessing-fund top-up is not an order** and may be taken on any day the café is open — *it is a gift arriving, not a drink being sold*, and §6.10.3's whole argument is that the two are different subjects on one payment rail. *Without this scoping, L19 and §6.10.3 are simply both in force and contradictory.*

**L20** — **Walk-ins are logged but never charged, and never counted against the staff entitlement.** No daily limit is enforced — barista discretion, logged for visibility.

**L21 [clarified in v7.0]** — **Cost, expense and summary visibility is role-based.** Visible to the Admin role, never tied to a named individual.

**A fund's *balance* is not one of those figures, and a barista may read it** (COL-13). L21's subject is cost, expense and margin — *figures that say how the business is doing.* A fund balance is a **tender availability check**, the same class of fact as whether the card machine is reachable, and the barista needs it both to avoid offering a draw that will fail and to answer a donor standing in front of them (DEC-14). **The ledger, the draw history and the member list stay Admin-only**, which is where L21's actual subject lives.

**L22** — **Broadcast audience is computed, never hand-picked.** Derived from `customers.status`, never from the `staff` table.

**L23** — **Order status is never exposed to a customer, guest or walk-in.** The live queue is a barista tool on the POS. There is no customer-facing order-status or queue view, and no guest notification path (§8.5).

**This binds the customer's own account too:** Order history shows only orders in `collected`, `cancelled` **or `ready`** — an order appears as soon as it is Done, so the history is never empty for the 20 minutes the sweep takes, and never permanently empty if the sweep misses. **What is withheld is the *state*, not the order's existence:** `orders.state` is never returned to a customer-scoped read of an in-flight order. §05's verification extends to: an authenticated customer's own history must not expose the state of an order still in `ordered` or `in_progress`.

**L24** — **Cup and lid deduction follows the mode.** Excluded on weekday orders; included on Sunday orders; **per the event's `consumes_cup_lid` switch** on event orders.

**L25** — **An event carries its own payment posture.** `free`, `standard`, or `override`. **Event mode does not inherit Sunday's payment behaviour.** A free event sends nothing to the machine and shows no card prompt.

**L26** — **Cup/lid consumption is a per-event switch, independent of payment posture.** A free event may still consume disposables. *Discipleship 101 is the reference case.*

**L27** — **Every event window has an end time, may not exceed 24 hours, and closes automatically.** On close, mode reverts to the date default and price overrides expire. **An event can never leak into the next day.**

**L28** — **Every order binds a notification target at ring-up** — a registered customer, or explicit none — **before the drink is made.** Order creation cannot complete without one. **"None" is chosen, never defaulted into.**

**L29** — **Web Push on iPhone and iPad requires the PWA to be installed to the Home Screen.** Registration and onboarding must include an install step with explicit iOS instructions. **A customer who registers on an iPhone without installing must not be left believing notifications will arrive** — the app states the requirement rather than failing silently (§6.1).

**L30** — **FAVO is not VAT registered.** All prices are VAT-free. No output VAT is computed, split or reported; revenue in the P&L is the full amount charged. **Reopen this rule if annual turnover approaches the R1m registration threshold** — registration changes every Sunday price and every margin figure, and is not a change that can be made quietly (DEC-01).

**L31 [amended in v7.0 · DEC-16]** — **Shots are a count, not a pair.** Any order line carries **1 to T15 shots**, in any mode. **The first two are the listed price; every shot beyond the second costs `config.extra_shot_zar`** (T09) on every Sunday and on events whose switch is set, and **nothing on weekdays**, where nobody pays and T15 caps the line at two. The coffee deduction is **`shots` × the base recipe's coffee and nothing else** (DEC-09, generalised), via the recipe-level multiplier of §6.2.3.

**L32** — **FAVO issues no receipt.** Card customers get the terminal's slip; nothing else is printed, emailed or pushed (§8.6, DEC-06).

**L33** — **A barista may comp a single order line to R0**, with a reason from the closed list `wrong_drink · wrong_charge · spillage · staff_error · goodwill · donation` — the same six values as the `comp_reason` enum, **which is the definition of record** — **at most once per order**, and **never above `min(line_gross − discount_zar, (highest live menu price + (T15 − 2) × extra_shot_zar) × quantity)`.** *A ceiling of "the highest live menu price" is R25 — below the R45 line a comp most needs to remedy once T09 is in force, and far below a quantity-2 line. A remedy that cannot cover the thing it exists to remedy is not a remedy.*

**Both terms were restated in v7.0, and each fixes a real defect.** The first reads `line_gross − discount_zar` because `line_gross` is quantity × unit price and knows nothing about an entitlement already applied — *a line could be discounted past its own value* (DEF-B), and this makes L41's DB CHECK unreachable rather than merely enforced. The second replaces a *double-shot surcharge* that no longer exists (COL-2): the most expensive drink the menu can produce is now a four-shot Mocha at **R45**, which is what the clause was always reaching for. **Everything else in L33 — the closed reason list, two per barista per session, the admin PIN on the third, the per-barista reporting — is unchanged.**

**At most two comps per barista per session; a third requires an admin PIN.** Every comp is reported **per barista** on §7.3.1's weekly summary and on the ministry rollup, and a session exceeding the ceiling raises the same admin push as an L09 stock mismatch — **independently of stock reconciliation, which a comp never disturbs.**

**Why bounded rather than trusted.** Unbounded, "once per order" across a 45-order Sunday is **R900 of goods at list price** — R1,350 once T09 lands on the 83%-double best seller. And it was invisible: `comps_zar` appeared on one surface, the Day summary, **which is on the POS — the screen the barista controls.** No admin surface showed a comp, and no report broke any figure down by barista, so with three baristas rotating a pattern was unlocatable. Comping five R20 drinks moves gross R350 → R250, leaves COGS untouched, and shows the Admin a quieter Sunday with no explanation. **The list, the cap, the ceiling and the per-barista line exist so a comp stays a service recovery and cannot become a salary.** Comps are never price changes and never touch `price_history`.

**L34** — **Where §8.4's scope statement and its replay ruling appear to conflict, the scope statement governs.** A free-coffee entitlement claim **requires a connection** and fails visibly offline, so the two-offline-claims scenario cannot arise through the entitlement path. §8.4's replay ruling stands as **defence in depth** and remains correct if the constraint is ever violated. **The §15.1 offline drill must exercise an entitlement claim**, not five plain orders.

**L35 [new]** — **The barista is never blocked on the network, except while a card payment is actually going through.** Adding a drink is a local action that appears immediately and syncs behind the scenes. Payment is the one place FAVO stops and waits, **because it is the one place it must know the truth before it says "paid"** — showing an unsaved cappuccino is recoverable; marking an uncleared card as paid is not.

**The payment wait carries a visible progress state and a defined ceiling** (§05, S2). No other interaction in the POS may introduce a blocking wait on a network call. The four figures in §05.1 are this rule's budget, not its substance: **if a figure and this rule conflict, the rule governs** and the figure is re-derived.

**L36 [new]** — **The barista till session is never rate-limited and never auto-signed-out during trading hours.** A lockout during the Sunday rush is a worse outcome than the abuse it prevents. Attribution is preserved by the explicit *Hand over* control and the 12-hour absolute session ceiling, never by an idle timeout inside an opening window (§9.5.1, §9.5.3). **This is called out as a locked rule specifically so it is not "hardened" away later by someone applying a framework default.**

**L37 [new]** — **Quantity changes only on the stepper. Tapping an item that is already on the order never changes its quantity.** The first tap adds the drink at quantity 1; every change after that happens on the explicit **− / +** control on that line, and stepping to zero removes the line. A repeat tap on the menu item flashes the existing line and draws the eye to its stepper. **One line per *distinct configuration*** — menu item + shots + modifications (§6.2.2). *This overrides v5.2's proposed default of repeat-taps-increment, on the owner's decision: a stray tap that silently doubles a drink is discovered when the total is wrong, which on a Sunday is after the customer has paid it.*

**"One line per menu item" could not hold, and v7.0 corrects it** [DEF-E]. `order_items` carries `shots` and `modifications` at line level, applied per unit — **so two cappuccinos, one with macadamia and one without, cannot share a line** — and the repeat-tap rule left *no path at all* to create the second one. **A repeat tap flashes the line whose configuration matches what is currently selected; where none matches, it adds a new line.** The barista never has to think about it: same drink made the same way steps up, same drink made differently lands on its own line. *Reachable in v6.0 by any order containing two of the same drink made differently, which the café does every Sunday.*

**L38 [amended in v7.0]** — **The shot count is a modifier on the drink, never a second item** — and, unlike v6.0's wording, **it takes any value from 1 to T15**, picked in one tap from a segmented control on the line: `1 2 3 4`, rendered down to the mode's ceiling, **its segments spaced rather than flush** (D10, D1). *v6.0's "never a repeatable customisation" was a consequence of the two-value enum and goes with it.* It is deliberately **not** a − / + stepper: the line already carries one for quantity, and two steppers side by side is §6.2.2's stray-tap hazard reintroduced (§6.2.4d). `order_items.shots` remains the column of record, the coffee deduction is a **recipe-level multiplier keyed on it**, and the shot is never part of a product name. **§10.5's deletion of `Extra Shot` from `menu_customisations` stands and is now complete rather than lossy** (§6.2.3).

**L39 [new]** — **A margin or profit figure derived from an estimated ingredient cost renders as *provisional* and never green.** The label is wired to `inventory_lots.cost_source = 'estimate'` — **not to a date, and not to a developer remembering** (§7.0.1b). It applies wherever the figure surfaces: the dashboard, the Day summary, the weekly push, the ministry rollup **and the CSV export.**

**This is distinct from §7.0.2's refusal rule and the two must not be conflated.** A *missing* input (a NULL fee, a zero-cost ingredient) makes the figure **UNAVAILABLE**, with the offending item named. An *estimated* input makes it **provisional**. Different failures, different remedies, different colours.

**L41 [new in v7.0]** — **At most one discount *mechanism* may apply to an order line** — an L03 entitlement, an L33 comp, or a §6.9 voucher. **Never two kinds on one line.** Enforced at the application layer and by `CHECK (discount_zar <= quantity × unit_price_zar)`.

**Mechanism, not row — and the distinction is load-bearing.** Each voucher zeroes exactly one unit, and a line may carry **up to `quantity` voucher rows.** Two first-time visitors who both want a cappuccino made the same way produce one line at quantity 2, and *both slips must be redeemable against it or the feature fails on precisely the night it exists for.* Trace T9 needs 2 redemptions on one line and 3 on another. **The entitlement and the comp stay at one per line**, because neither has a case that needs more. *Closes DEF-A.*

**L42 [new in v7.0]** — **An order whose net charge is R0 never begins a tender, in any mode.** Nothing is sent to the card machine, no `payments` row is created, and the order completes as `payment_mode='free'`. *Closes DEF-C, which was reachable in v6.0 in two taps and surfaced to the barista as a broken card machine rather than as a comped order.*

**L43 [new in v7.0]** — **A voucher is a bearer instrument and the paper is the control.** The slip is surrendered at redemption and counted at `closeSession`; the count is recorded **against that session** and a variance alerts the Admin on the daily digest. **Vouchers carry no serial, no code and no per-person limit**, and **a missing count never blocks the close** — NULL is distinguishable from zero.

**L44 [new in v7.0]** — **No customer ever initiates a top-up.** Every rand entering a fund arrives by one of exactly two paths, and **both carry an external proof**: a card payment taken at the counter by a barista, **where the balance does not exist until Yoco confirms the payment succeeded**; or a cash or EFT gift recorded by an Admin naming a method and a reference. **There is no self-service top-up anywhere** — not in the customer PWA, not by a link, not by a QR code.

This is the narrowed form of §8.2 and **it is the clause that prevents the stored-value wallet being rebuilt under another name.** *A typed amount with no confirmed payment behind it creates nothing, shows nothing and is drawable by nobody.*

**L45 [new in v7.0]** — **A fund balance is never refundable in cash.** It resolves by being drawn, or by an **Admin-confirmed** sweep to ministry income. Acknowledged at intake and recorded on the fund row. *This is what allows a stored balance and L02 to coexist.*

**L46 [new in v7.0]** — **A fund's linked names decide who may draw from it, and there is no other fund type.** A fund with names linked pays only for an order bound to one of them, **auto-applied and declined in one tap**; a fund with no names is barista discretion, applied by an explicit tap and logged. **A person may be linked to at most one active fund**, enforced by a partial unique index. Where a linked fund applies it arrives *pre-selected, never exclusive*: the open-fund chip is shown beside it and one tap switches between them, or turns both off and sends the order to the card. **Every open fund collapses to a single chip naming the one FAVO would draw from**, so the footer carries at most two tender chips at any number of funds. **FAVO sends no donor statement** — a fund's balance and ledger are read from `/admin/funds` by an Admin, never pushed to a customer, and **no customer-facing surface displays a fund balance.**

**L47 [new in v7.0]** — **A fund draw is a tender, not a discount.** The order is charged in full, `payment_mode='donor_fund'`, and **nothing is written to `payments`** — §10.2.1's two paths are unchanged. A fund draw never appears in `order_discount`, `comps_zar` or any write-down figure. **And a fund-settled order is *settled* for the purposes of the close**, or every fund-paid coffee books as a bad debt on the day it was paid for (§6.7).

**L48 [new in v7.0]** — **A control that cannot apply in the current context is not rendered.** The voucher chip does not exist on a weekday, the fund chip does not exist on an order with no net charge, the shot picker does not exist on a drink containing no coffee. **This governs *applicability* only:** §17.4.1's rule that a blocked action explains itself rather than disappearing governs *permission*, and the two do not overlap. ***Stopped is shown; meaningless is hidden*** (§6.2.4b).

**L40 [new]** — **The Yoco secret key never leaves the server, and the payment adapter is the only code that touches a raw Yoco response.** Every Web POS call is made by FAVO's own runtime from a secret held in the managed vault. **No payment credential exists on any device** (§9.10.2).

**The adapter returns only the fields §10.3.3 stores.** Every other field in the response — the masked PAN above all — is dropped at that boundary and **never reaches a log, a column, an error tracker or a client.** *Under the SDK route this was a structural property FAVO inherited; under the web route it is a rule FAVO enforces, and that is a real cost of the OPEN-12 decision.*

### 12.2 Tunable — Admin can change with a logged config change

| ID | Default | Tuning point |
| --- | --- | --- |
| T01 | Variance bands: 0–5% ok · 5–10% investigate · 10%+ critical | config.variance_bands |
| T02 | Bean freshness alert at 14 days post-roast | Per-lot origin |
| T03 | **A list of Sunday windows**, not one. Morning **07:50–09:30**; **Untracked Church's window comes from its event profile** | config.sunday_windows — the morning window widened from 09:15 because the grounded Sunday's last sale was **09:16:02**. **A list, because a single window excluded the evening service from every §05 Sunday measurement** — a slow, badly-performing Untracked Church would have passed every row (COL-22). §05's two Sunday criteria are measured **per window**, and the evening entry maintains itself from the profile |
| T04 | Low-stock thresholds | inventory_items.low_stock_threshold |
| T05 | Low-stock check interval: 15 min | Timer schedule |
| T06 | Eligible free-item categories: coffee only | Admin UI. **Must extend without a rebuild** |
| T08 | **Lid variance band: 0–25% ok** — wider than T01, because lid declines are deliberately unmodelled (§7.4) | config.variance_bands.lid |
| T09 | **Extra-shot surcharge: R10 per shot beyond the second** — Sundays, and events whose switch is set (L31, DEC-16) | **Redefined, not retuned.** `config.double_shot_surcharge_zar` → `config.extra_shot_zar`. *The rename is worth the churn for v6.0's own stated reason at `applyFreeCoffee`: the old name is what would keep the old rule alive in the code.* Admin-changeable with a logged config change, so a price rise needs no deploy |
| T10 | Daily two-directional reconciliation, at transaction grain | Not tunable — a control, not a setting (§6.8.3) |
| T11 [new in v7.0] | **25 vouchers per session** | config.voucher_expected_max_per_session. **Alert only — never a block** (§6.9.2), and it lands on the daily digest beside the slip variance as one line (COL-24). *The default is a guess; one Untracked Church evening with a tally sheet replaces it, and it is a config value, changeable without a deploy* |
| T12 [new in v7.0] | [{ kind: "untracked_hot_drink", categories: ALL }] | config.voucher_kinds — **the catalogue.** Each kind names **the modes it is valid in and the menu categories it covers**; the Untracked hot drink voucher covers **every item on the menu**, unlike L03's coffee-only free cup (T06). **The event profile decides which kinds are live** (§6.11.2) — so a Christmas or invite-a-friend voucher is a config row and a switch, *not a migration* |
| T13 [new in v7.0] | **R2,000** | config.donor_fund_ceiling_zar — the per-fund cap (§6.10.4), **checked before anything reaches the machine** (R23). About 100 coffees: large enough for the generosity actually observed, small enough that a forgotten fund is a rounding error. *It does not cap the total across funds — R24 covers that, with an alert rather than a block* |
| T14 [new in v7.0] | **180 days**, alerting at 150 | config.donor_fund_dormancy_days. **The sweep it triggers is a proposal an Admin confirms, never a job's write** (§12.3, §6.10.4). Long enough that a generous gift is not quietly confiscated; short enough that the balance sheet does not accumulate people who left the church two years ago |
| T15 [new in v7.0] | **4 shots · 2 on a weekday** | config.max_shots_per_line, and `config.max_shots_weekday` at **2** (owner, 14 Sep 2026). **The picker renders only the segments the mode allows and the DB CHECK enforces the outer ceiling.** Nobody pays on a weekday, so a third shot is beans given away with no pricing question to settle — and charging for one would need a card step L19 says does not exist on a weekday. **The cost it bounds is about R6,600 a year** if five office staff a day took a triple (5 extra shots × ~250 weekdays × R5.29, §7.0.2's worked bean cost) |

> **T09 in context — and this is the revision v6.0 asked for**
>
> DEC-08 is a dated owner decision (2026-08-19) and **stands as a dated decision. DEC-16 supersedes it on its merits.** v6.0 recorded doubt about DEC-08 in its own words — T09 *"functions as a 50% increase on the majority configuration of the best-selling item, not a surcharge on a minority option"* — and made T09 admin-tunable *"specifically so this can be revised on the first month's evidence."*
>
> **The revision arrived from the counter rather than from the first month's reports, and it turned out the concern was the actual pricing:** one shot and two shots are both the listed price, and R10 starts at the third (§6.2.3). *One of the alternatives v6.0 listed — "set the surcharge below R10" — was close; the real answer was to move where it starts rather than what it is.*

**Retired tunable — do not reuse:** `T07` (guest pairing TTL), retired with §8.5.

### 12.3 Universal invariants

**FAVO is not VAT registered** and no VAT is computed anywhere (L30) · **never store, log or echo a PAN, masked or otherwise, a CVV or an expiry** — and under §6.8 the enforcement point is a named server-side adapter, not a rule to remember (L40, §9.10.2) · money is integer cents in `_zar` columns, with §10.6's one stated exception · wall-clock semantics in `Africa/Johannesburg` · **every mutation and every refusal writes an audit row, and failure to audit fails the transaction** · RBAC server-side · **every externally-keyed write is idempotent on that key, and where no such key exists FAVO never retries** — Yoco documents no idempotency mechanism for a payment send, so a card payment is resolved by lookup and never repeated (S4, OPEN-10) · **no scheduled job may initiate a payment or create revenue** (§9.6.2).

## 13 — Delivery plan

No calendar. Ship in priority order; each capability ships when it is ready and correct. The order below is dependency-driven.

> **The sequence change v6.0 makes, and it is the second-largest consequence of OPEN-12**
>
> **Card work moves from last to second.** It sat at the end because it was months of native development behind an approval FAVO did not control. **At one to two weeks it rides alongside step 2, the order-flow fix — which is where it belongs**, since ringing up and taking payment are the same barista motion. Steps 1 and 3 onward are unaffected, and **the reason for the old ordering is gone.**
>
> **What the web route does *not* save you: error handling.** §6.8.4's ten paths all still need building and none has ever been observed. That work was owed on either route, and it is now the largest remaining piece of the payment chapter. **Build it with the happy path, not after it.**

### 13.0 Step 1 — gate zero: get back online

Nothing else matters while production is down. This is §09 executed, and it ships before any feature work.

> **There is no data migration. FAVO starts on a clean database.**
>
> Owner decision, 2026-08-20. No orders, customers, inventory, entitlement rows or financial records are carried over from the Supabase instance — the new Postgres is created empty and the café begins trading on it. **This is stated because its absence was indistinguishable from an oversight.** It also settles three things: **§9.4's five-year retention starts now**, on the new instance, and makes no claim about pre-cutover history; **the RPO/RTO figures govern the new system only**; and **every corrective migration in §10.3 and §10.3.1 is a no-op on first run**, because there are no existing rows to correct — so §10.3.1's repoint archives nothing and cannot conflict with L12's append-only rule. **What this does not excuse:** the schema still has to arrive in the right shape, and a seeded database still has to be verified before trading.

- **Stand up the always-on host and co-located Postgres — empty**, then apply migrations to the §10 shape and seed the menu, prices (§7.0.1), recipes and ingredient costs.
- **Verify the seed before trading:** the five menu items priced per §7.0.1; one recipe per item; **the three alternative milks seeded with real costs** — §7.0.2's refusal rule blocks every margin figure while any consumed ingredient costs `0.0000`, which makes this a gate-zero item; **the bean cost reconciled** (§7.0.1b defect 1); and **the cost state explicitly recorded rather than silently inherited** — every lot carrying `cost_source = 'estimate'` unless an Admin has recosted it, and the profit flag confirmed rendering *provisional*.
- **Yoco: generate the API key, create the Web POS device, and link the Khumo** (§6.8.2). **Then run the R1.00 test and its five follow-on steps.** This is the gate the payment chapter rests on, and it costs one to two hours.
- **Submit the Yoco SDK integration application** — insurance only, and the one item with an external clock. It is free to send and the approval gets thrown away if the test above passes (§13.1).
- **Rotate the database password** (exposed during development) and re-issue Yoco and VAPID keys into Infisical.
- **Attach `favo.hofmi.net`** via Cloudflare for SaaS (§9.3); run the `dig` check before and after; set `AUTH_URL` and `PUBLIC_BASE_URL`.
- Move ~15 secrets into Infisical.
- **Retire `POST /api/payments/yoco/webhook`** rather than re-pointing it (§11.1). FAVO fetches payment status and subscribes to no webhook, so there is nothing to point at it. Re-run `tests/e2e/prod-smoke.spec.ts`.
- **Configure point-in-time recovery** — continuous WAL archiving, RPO ≤ 5 min (§9.4).
- **Verify the backup by restoring it**, before the café depends on the system again. Record the elapsed time; **it is the first measurement of RTO.**
- **Validate the live queue through the edge for ≥ 4 hours** (§9.8). **This is the gate the previous host failed.**
- **Measure the four §05.1 figures through the edge and record them.** The app and database are co-located in the EU while the till is in Johannesburg; **this is the one moment when changing region is nearly free.** The revisit trigger is the 1.5 s commit figure.
- **Enable connection-drop logging** on the tablet, so §8.4's "monthly-ish" becomes a measured figure (DEC-12).
- **Run the offline audit** (§13.4) — the physical drill, not only the CI test.
- **Confirm the Transformate terms are settled** (OPEN-08). **Gate zero commits FAVO to this infrastructure**, and a four-hour recovery promise with nobody contractually responsible for it is a promise that gets tested on the worst possible morning.

### 13.1 Step 2 — the flow fix, and card payments, together

The highest-value functional change, and a prerequisite for everything else in Priority 1. **Payments are built in this step, not after it.**

| Workstream | Contents |
| --- | --- |
| The flow fix | `orders.notification_target` + the L28 binding rule · **ring-up / make separation** in the POS, with the queue as the work list · **the recents grid** (§6.2.1) · **the quantity stepper** (§6.2.2, L37) · **the segmented shot picker, `order_items.shots` and its recipe multiplier** (§6.2.3, L38, D10) · **L37's one-line-per-distinct-configuration rule** (DEF-E) · **the PWA install step in registration and onboarding, with iOS instructions** (L29) — without it every iPhone customer silently gets no notifications · The Favo wired into the POS row, to §6.4's layout constraints |
| **Card payments** | `beginTender` · `sendToTerminal` · `pollTenderResult` · `recordTenderResult` · `resolveTenderByLookup` (§11.2) · the `payments` table's target shape (§10.3.3) · **DEF-A, DEF-B and DEF-C — all three are in the discount and tender arithmetic being built right now, all three were live in v6.0, and they are cheaper to fix before the code they affect is written than after** (L41, L42, L33) · **the polymorphic-subject `CHECK` on `payments` and its second partial unique index** — one column change, cheapest to land while the table is being migrated anyway, *and §13.1 carries it even if §6.10 is deferred* (§6.10.3, COL-5) · the payment adapter and its field allow-list (§9.10.2, L40) · **all ten error paths of §6.8.4** · the 180 s ceiling and its progress state (L35) · the DB unique index on one successful payment per order · **and every one of the failure paths exercised against Yoco's test credentials on staging before a real card is presented** |
| Deferred settlement | The `orders` settlement columns · `setDeferredMode` and its S2a push · `settleDeferredOrder` with its query-before-send guard · the admin unpaid-orders list · `closeDaily()`'s settle-or-write-off step and the §6.0.5 approval queue. **Build this with the payment work** — it is the only thing standing between a card machine off the wifi and a day of unrecorded sales |
| Alerting | §9.6.3's immediate list and daily digest, **including the card-machine alert to the barista's own device** — which is new, and exists because of the web route. **De-duplication is part of the build, not a follow-up** |
| The SDK contingency | **One line: if §6.8.2's device-link step turns out to need Yoco-side enablement that Yoco will not provide, the approved SDK application is the fallback and §6.8.0's rejected route is reinstated by a PRD amendment.** Nothing in the sequence depends on it, and no work is done against it unless the gate fails |

### 13.2 Step 3 — modes, schedule, identity

- `opening_sessions.mode` + `setDayMode` + one-tap confirm in the opening-window step (L18), computed against **the session's own window** (COL-8). ⛔ **The narrowing to one session per day is struck, not resequenced — do not run it** (COL-14). v6.0 commissioned a migration from `unique(session_date, opens_at)` down to `UNIQUE (session_date)` that §6.11 reverses: *a builder working this step as v6.0 wrote it does the work twice, and writes a migration and a down-script for nothing.* **The shipped constraint at `9aefc2c` is retained**, and the only new object is §6.11.1's one-open-session partial unique index.
- **The rest of the session model** — `closeSession`, `opening_sessions.closed_at`, the per-session voucher columns, and `barista_shifts` keyed to the session rather than the date (COL-23).
- **§6.9 · the voucher.** It needs `opening_sessions.mode`, the `app_config` store and T12 — all of which land in this step — and it shares almost all of its surface with the walk-in log. **Roughly two to three days.** The Untracked Church event profile lands with §13.8's event work, or earlier as a Path A profile if the evening service starts being served before then.
- `customers.status` + the registration change; computed broadcast audience (L22).
- **Repoint the free-coffee entitlement to `customers`** (§10.3.1) and rename `applyStaffDiscount` → `applyFreeCoffee`. **Do this *with* the `status` column, not after** — the entitlement check depends on it, and until both land the weekday benefit reaches nobody it is meant for (R15).
- Barista rota + shift-start push (§6.3), **and the *Hand over* control**, which L36 makes load-bearing rather than a convenience.
- `walk_ins` table with `quantity`, and POS logging (§6.5).
- **Mode-aware and shot-aware deduction, in one pass** (§10.5) — the correctness fix that makes every downstream cost number trustworthy — **and the deletion of `Extra Shot`** in the same migration.
- Eligible-category config (T06) and the `app_config` store (§10.4).
- Session lifetime, the out-of-window idle lock, and §9.5.3's customer-side rate limits.

### 13.3 Step 4 — removal: loyalty and packs

**The wallet is already gone** (§8.2, verified 2026-08-12) — this pass covers loyalty and coffee packs only. They share code paths, so it is one coordinated pass, and **the sequence matters:**

1. Take and **verify** a full backup. Removal is a hard delete with no wind-down — **the backup is the only reversal path.**
2. **Remove UI surfaces first:** the customer loyalty page, the three admin loyalty pages, in-cart redemption, `PackDetailCard`, and the loyalty references on the admin customer detail page.
3. Remove server actions and the accrual path.
4. Drop tables and columns (§10.1) with a tested `down` script.
5. Update the ~34 loyalty test files and **24 pack files** — `grep -rIl -iE 'coffee_pack|pack_redemption|purchasePack|PackDetailCard|coffeePacks' --include='*.ts' --include='*.tsx' .` *(the count of record is the command, not a number in prose)*; suite green throughout.
6. **Check the customer-facing privacy policy page** — it currently describes loyalty data collection and must stop, since POPIA disclosure has to match what is actually stored (§9.4).

**Scale, so nobody underestimates it: 76 source files reference loyalty, 22 reference packs.** The largest single change in v5 — and it is deletion, which is the good kind of large. Placed here because it clears the POS and admin surfaces before the mode work lands on them. **Enforcement checks must return zero before this is done:**

```
grep -rIn -i "wallet" --include="*.ts" --include="*.tsx" src/ db/ | grep -v -iE "test|migration|POS_REBUILD"
grep -rInE -i "loyalt|coffeepack|packRedemption" --include="*.ts" --include="*.tsx" src/ db/ | grep -v -iE "migration"
```

### 13.4 Step 5 — offline trim, and the audit gate

- Delete the `sync_conflicts` table, `actions/sync-conflicts.ts`, the admin resolution surface, and `outbox_log.conflict_id`.
- Keep `useOfflineOutbox`, `apply-outbox.ts`, `POST /api/sync/orders` and `outbox_log` — **including the `client_uuid` unique constraint, which is the idempotency guarantee.**
- **Each retained file must be *edited*, not merely kept.** All three write `sync_conflicts`, so §13.4 as written in v5.0 **does not compile** once §10.1 drops the table. Strip the conflict-write path, keeping the outbox replay and the idempotency rejection. The completion gate is §10.1's grep returning zero.
- **Remove or internally gate the live `/api/crons/*` endpoints**, so §10.7's "no Admin may run a timer" is enforceable. **`retry-deferred-payments.ts` is deleted**: it sets `payments.status = 'successful'` with `resolvedBy: 'retry_cron'`, *accrues loyalty §8.1 removes*, and *writes `sync_conflicts` §10.1 drops* — **one retained file violating three rules of this document.** Its legitimate successor is `resolveTenderByLookup` (§11.2), which reads Yoco and never sends.
- **Add one CI regression test** on the write/replay path: no data loss, no duplicate order. Runs on every PR.
- **Run the offline audit and treat it as a gate.** Write the scope statement (order creation only); implement §8.4's entitlement-collision ruling; run the physical drill on the real tablet over the real network. **If the audit does not pass, offline ships disabled** — not unverified.

### 13.5 Step 6 — Discord removal: replacement first, then delete

Two steps, and **the order is not negotiable** (§8.10).

1. **Build the replacement.** §9.6.3's alerting, verified by forcing a mismatch on staging and confirming the Admin device receives it — **and by asserting the de-duplication**, which is the part v5.2's version of this step did not require. The push infrastructure already exists, so this is a new alert on an existing rail, not a new rail.
2. **Delete Discord.** `src/server/discord/webhook.ts` (delete) · `crons/close-daily.ts` and `crons/generate-weekly-pnl.ts` (drop the import and the ping block) · `scripts/ship-ping.ts` (delete — the WI record is the ship notification) · the two test files (remove the mocks, keep the reconciliation coverage) · `infra/sentinel/alerts.yml` (repoint at Transformate's observability alerting) · `.env.example` · and the seven docs that reference it, folded into §13.6.

**Completion gate — must return zero.** It excludes this PRD and `docs/archive/`, which legitimately record the removal. Baseline at `9aefc2c`: **89 matches** using the command below across code, infra, scripts and docs — which is why §13.6 and this step are one piece of work. A further ~24 live in superseded documents and drop out automatically once §13.6 archives them.

```
grep -rIn -i "discord" --include="*.ts" --include="*.tsx" --include="*.yml" --include="*.md" \
  src/ db/ tests/ infra/ scripts/ docs/ *.md | grep -v -E "FAVO_PRD_v6|docs/archive/"
```

### 13.6 Step 7 — domain, doc and duplicate reconciliation: do not skip

The docs currently describe two different infrastructures and one domain that never existed. **The `favo.hofmi.org` footprint is 37 files**, and it is not confined to docs — a third of it is code, tests and infrastructure, **and two of those fail silently rather than visibly.**

| File | Why it matters |
| --- | --- |
| src/app/layout.tsx | The wrong domain ships in the running app |
| src/app/(customer)/privacy/page.tsx | The public privacy page §9.4 relies on |
| src/server/push/vapid.ts | **The VAPID subject. A wrong `sub` is a push-delivery failure** — L29 / R16 territory, **and it fails silently** |
| tests/e2e/prod-smoke.spec.ts | **A gate-zero step. Gate zero's own smoke test asserts against a domain that will never resolve** |
| tests/unit/lib/customer-sw.test.ts | Service-worker test |
| infra/coolify/favo-app.yml · infra/cloudflare/variables.tf | Deploy and DNS config |
| infra/grafana/dashboards/favo-{cogs,ops,variance}.json | Three dashboards |
| infra/sentinel/alerts.yml · src/server/discord/webhook.ts | §13.5 touches both for Discord and **not** for the domain |
| docs/popia/privacy-policy.md · docs/popia/subject-rights.md · + ~20 further docs | POPIA commitments |

- **Completion gate:** `grep -rIn 'hofmi\.org' .` returns zero outside `docs/archive/`. Start with the **six** files in `src/` and `tests/`.
- Update `ARCHITECTURAL.md`, `docs/API.md`, `docs/BUSINESS_RULES.md` and `docs/DATA_MODEL.md` to match this document. **`docs/API.md` is generated from §11, never consulted by it** (§11.4). Both it and `BUSINESS_RULES.md` were already stale against v4 — both still say the staff discount is "Cappuccinos only".
- Point `CLAUDE.md`'s "PRD is the source of truth" reference at **this file** — it currently points at `FAVO_PRD_v3.md`.
- **Move the superseded documents to `docs/archive/`:** `FAVO_PRD_v5.2.md`, `FAVO_PRD_v5.1.md` and `FAVO_PRD_v5.md` at the repo root, plus `docs/FAVO_PRD_v3.md` and the three phase build plans. **Every one of them is a place a future session can pick up a stale answer**, and v5.2 is now the most confusable of them, because it is recent, long, and *wrong about the payment chapter.*
- **Root-level duplicates — nine, not four.** `API.md`, `BUSINESS_RULES.md`, `ARCHITECTURAL.md`, `DESIGN.md`, `DATA_MODEL.md`, `PLANNING.md`, `DATABASE_SETUP_GUIDE.md`, `FAVO_CAFE_Project_Brief.md` and `CLAUDE.md` all exist at both the repo root and in `docs/`, and the copies have drifted — root and `docs/` `DESIGN.md` differ by 137 lines. **Keep the `docs/` copy and delete the root duplicates.**
- **The catalogue hygiene list**, all in Yoco rather than in FAVO: split `Americano (X1, X2)` into variants so its shot is recorded at all (§6.2.3); the unbalanced parenthesis in SKU `2C(001`; and `/admin/login` consolidated onto `/staff/login` and deleted, with `grep -rIn 'admin/login' src/` returning zero (§17.4).

### 13.7 Step 8 — Priority 2: cost management

- Per-mode split on the live COGS dashboard, and `cost_source` labelling wherever a margin surfaces (L39).
- **Ministry rollup view** (§7.2), and `logExpense` plus `/admin/expenses` — **without which `ministry_cost` renders UNAVAILABLE rather than COGS-only**, by design.
- Weekly ops summary: mode split, walk-in count, event section, push + in-app screen, **and §7.3.1's per-barista write-down block.**
- `/admin/yield` recosting, which is the only path from `estimate` to `invoice`.

**Deliberately after step 3:** the weekday and event figures are wrong until mode confirmation, the walk-in log and corrected deduction all exist. **Building the reports first would produce numbers that look authoritative and aren't.**

### 13.8 Step 9 — event mode

`event_profiles` + `event_windows`, the six switches, all three activation paths, automatic close and the 24-hour backstop (§6.6). The `price_overrides` snapshot is written alongside its `price_history` rows in one transaction (§10.6). **Discipleship 101 is the acceptance case:** recurring Wednesday template, free, disposables, church-member audience, confirmed in one tap and closing itself at 20:30. **Last on sequencing — it depends on modes existing — not on uncertainty.**

### 13.9 Amendment pack A — where each piece lands [new in v7.0]

| Work | Lands in | Why there |
| --- | --- | --- |
| ⚠ §13.2's session narrowing | **Struck, not resequenced** | **Do not run it.** It commissions the migration §6.11 reverses (COL-14). The shipped `unique(session_date, opens_at)` is retained and gains the one-open-session index instead |
| DEF-A, DEF-B, DEF-C | **§13.1, with the payment work** | All three are in the discount and tender arithmetic being built right now, and all three were live defects in v6.0. *Cheaper to fix before the code they affect is written than after* |
| DEF-E, DEF-F, DEF-G | **§13.1 · §13.1 · §13.2** | L37's line rule rides the order-entry work; `searchCustomer`'s contract rides the flow fix it exists for; per-lot coffee costing rides the deduction pass, which is where `shots` lands anyway |
| §6.2.3 · shot pricing | **§13.1 and §13.2** | The picker and `order_items.shots` with the flow fix; the multiplier and the `Extra Shot` deletion with §10.5's deduction pass, which §13.2 already has as one coordinated change |
| §6.9 · the voucher | **§13.2, with modes and the walk-in log** | It needs `opening_sessions.mode`, the `app_config` store and T12 — all of which land there. **Roughly two to three days** |
| §6.10 · the fund | **After §13.4, as its own step** | Gated on a decision that reopens a locked clause, so it should not sit in front of anything that gets the café trading — **and DEC-15 is marked for a read by HOFMI's bookkeeper before it goes live.** But **its top-up path rides on §13.1's payment work**: the polymorphic-subject CHECK is cheapest to land while `payments` is being migrated anyway, *so §13.1 carries that one column change even if the fund is deferred.* **Roughly five to six days for the rest** |
| §8.11 · the tab | **Nowhere** | Recorded as a non-goal with its reopening trigger |

**Build-time figures are estimates, not quotes** — v6.0's own caveat, and it applies here for the same reason.

## 14 — Risks and rollback

| ID | Risk | Likelihood | Impact | Mitigation | Rollback |
| --- | --- | --- | --- | --- | --- |
| R1 | **The live queue fails through the edge**, repeating the last failure | Med | **Critical** | §9.8 — explicit ≥ 4 h end-to-end test through Cloudflare before go-live. **Not a local test** | Fall back to POS queue polling; the queue view degrades but the café runs |
| R2 | DNS change affects HOFMI email | **Low** | **Critical** | §9.3 — Cloudflare for SaaS custom hostname on Transformate's zone, no zone migration, NS and MX untouched. `dig` check before and after, with MX/NS equality as the acceptance test | Remove the `favo` CNAME. Apex, `www` and MX are never modified, so there is nothing to restore |
| **R18** | **The device-link step turns out to need Yoco-side enablement FAVO cannot self-serve**, and the payment chapter cannot ship as written | **Med** — *it is the one undocumented step* | **High** | §6.8.2's R1.00 gate runs **at gate zero, before any payment code is written**, so the answer arrives at the cheapest possible moment. **The SDK application is already in the queue as the fallback** (§13.1) | **This is a delay, not a reversal.** If it fails, §6.8.0's rejected route is reinstated by a PRD amendment against an approval that already exists — the plan loses weeks, not the decision |
| **R19** | **The card machine goes off the wifi mid-Sunday and nobody notices**, because FAVO now depends on *reaching* it rather than the barista tapping on it | **Med** | **High** | **The alert of §9.6.3, routed to the barista's own device within 2 minutes**, plus the first failed send surfacing `TERMINAL_UNREACHABLE` with deferred mode one tap away. **This risk is created by the OPEN-12 decision and is recorded as such** | Deferred mode; settle when the machine answers; §6.7 path B if a standalone machine is used |
| **R20** | **Every §6.8.4 error path ships unobserved** — six of the ten describe a failure nobody at FAVO has seen | **Certain** — this is the current state | Med | §6.8.2 gate step 6 observes three of them for R1.00. **The rest are exercised against Yoco's test credentials on staging before a real card is presented** (§13.1). **The grounded Sunday contains no failure at all, so this is the first time the money-critical paths are seen rather than reasoned about** | Deferred mode covers a total payment outage; S4 covers an individual unresolved payment. **Neither has been drilled** |
| R17 | **Untested offline persistence causes duplicate or lost orders** during a brief network blip | Med | Med | §8.4 — trim to outbox + idempotent retry (`client_uuid` UNIQUE), delete the unreachable conflict layer, add one CI regression test, **and gate on the physical drill** | The idempotency constraint rejects duplicates at the DB; the audit log shows every replay attempt |
| R3 | **Loyalty removal breaks unrelated code paths** — 76 files, shared with orders | Med | High | Remove in the §13.3 sequence, suite green at every step. Enforcement greps as the completion gate | Restore from the verified pre-removal backup. **No partial rollback — which is why the backup is step 1** |
| R4 | A customer expects points they no longer have | Med | Low | No wind-down was chosen deliberately. Remove the UI before the data so nobody sees a stale balance | Counter explanation. Points are not reinstated |
| R5 | **A free event charges people** — or a paid event doesn't | Low | **High** | Payment posture is an explicit switch snapshotted onto the window (L25), not inherited. **The Discipleship 101 drill asserts zero payments sent** | **Refund is not available (L02)** — so this is prevented, not recovered. The drill is the control |
| R6 | **An event window is left open** and silently makes later orders free | Low | High | Mandatory `ends_at`, automatic close on read, 24-hour maximum (L27) | Admin closes the window; affected orders are identifiable by `event_window_id` |
| R16 | **Registered iPhone customers silently receive no notifications** because Web Push needs the PWA installed | **High if unaddressed** | **High** | L29 — an install step in onboarding with explicit iOS instructions, and **never showing a subscribed state the device cannot honour** | Customer collects at the counter. The order is identified by `daily_seq`, the number on the cup |
| R8 | Weekday cost numbers wrong because the double-shot case remains unhandled | **High if §13.2 slips** | High | The substitution path is **already implemented** (migration 0027). **The multi-shot coffee case is the remaining half, and §6.2.3 fixes it as a recipe-level multiplier** keyed on `order_items.shots` — a property of the recipe rather than a barista's memory. Fix with the cup/lid change (§10.5) | Recompute historical COGS from `order_items.shots` and `.modifications` once deduction is correct |
| R9 | Card payments unavailable during Sunday peak | Med | High | Device check every 60 s **plus the first failed send as the primary signal**; deferred mode one tap away. **Weekday and free events are unaffected** — no payment step | Standalone card machine, reference captured (§6.7 path B); reconcile within 24 h |
| R10 | Push non-delivery | High | Low | The live queue board on the POS is the primary signal; push is secondary | Customer asks at the counter |
| R11 | Inventory deduction race on concurrent orders | Med | High | `SELECT … FOR UPDATE` inside the order transaction; the advisory lock on container open | Daily reconciliation catches drift; alert above the T01 band |
| R12 | ~~Yoco webhook replay~~ **→ RETIRED.** FAVO subscribes to no webhook and has no publicly reachable payment endpoint (§9.6). **The replaced risk is R20's unobserved error paths** | — | — | The endpoint is retired at gate zero rather than re-pointed (§13.0) | — |
| R13 | COGS inaccurate because ingredient costs are estimates | **Certain — by decision** | Med | **OPEN-06's condition:** `cost_source` on every lot, and **the margin renders *provisional* and never green** while any input is an estimate (L39). The two known defects — the bean cost and the three zero-cost milks — are gate-zero items | Admin recosts a lot at any time; COGS recalculates forward. **The label is the mitigation, and if the label is dropped during the build the risk comes straight back** |
| R14 | FAVO staff PIN compromise or sharing | Low | Med | Rotate PINs; anomaly detection on entitlement claims outside shift hours, **which depends on refusals being audited** (§10.3.2); admin PIN cooldown at 5 attempts (§9.5.3). ⚠ **Removing the in-window idle lock (§9.5.1) raises this slightly and the trade-off is named there** | Revoke and re-PIN; review the audit trail |
| R15 | **The free-coffee entitlement cannot reach the ~63 office staff it exists for** — it is keyed to the `staff` table | **Certain — this is current behaviour** | **High** | Repoint to `customers` (§10.3.1) as part of §13.2. Until then the weekday benefit either is not granted through the system or is recorded against the wrong person, **which also corrupts the weekday consumption counts feeding §7.3** | **No rollback needed — the current state is the broken one.** On a clean database there are no historical rows to reinterpret |
| **R22** | **A barista opens a fund against a genuine card payment and draws it down for friends.** Yoco reconciles perfectly; the money really arrived. *This is the separation of duties §6.10.3 gives up by moving top-ups to the counter* | Low | **High** | A name on the fund, and **an immediate Admin alert on every unnamed one** (§6.10.3, §9.6.3). The per-barista fund-draw line on §7.3.1. §10.7 keeps rename, re-link and sweep at the desk. **Recorded as created by the counter-top-up decision**, the way R19 is recorded against OPEN-12 | The ledger is append-only and every entry names the staff member who wrote it. **L02 still applies to the money** — what is recoverable is the account of it |
| **R23** | **R5,000 typed where R500 was meant, and the customer taps it.** L02 leaves no remedy and no comp can cover it | Low | **High** | **T13's ceiling is checked *before* the send**, so anything above R2,000 never reaches the machine; and the amount is confirmed on a screen showing the figure large. *§6.9.3 refused a confirmation step for the voucher chip because its result is visible and reversible before Place; this one is neither* | **Partly self-remedying — the money stays the customer's to drink** (§6.10.5). It is the only place in FAVO where L02's "no remedy" has any give in it at all |
| **R24** | **Total fund liability grows unwatched.** T13 caps each fund; nothing caps the sum. Five funds is up to **R10,000 of coffee owed** — around 500 cups | Med | Med | An Admin **daily-digest** line on total live balance across all funds, defaulted around R5,000 — **alerting, never blocking** (§6.10.6). A block would refuse a generous person at the counter, which §6.9.2 already rules out for vouchers on the same grounds | Stop opening new funds and let the queue drain. **At three draws a day five R500 funds cycle in about 42 days**, well inside T14 |
| **R25** | **The tin is never counted**, so L43's control exists on paper only and the voucher variance is permanently `UNAVAILABLE` | Med | Med | **NULL is distinguishable from zero**, so an uncounted tin is visible rather than silently passing. `closeSession` prompts for it, and §7.3.1's write-down block **shows the count of days it was skipped** | None needed for the money — a voucher takes no cash. *What is lost is the control, and the skipped-day count is what makes the loss visible* |
| **R21** | **OPEN-08 is never answered and gate zero completes anyway**, leaving a four-hour recovery promise with nobody contractually responsible for it | Med | **High** | §13.0's last item makes it a gate-zero condition rather than a background conversation. **Sunday is the only paid trading day**, so the promise gets tested on the worst possible morning | None available after the fact. **This is the one risk in the table with no technical mitigation** |

### Rollback strategies

- **Data.** Continuous WAL archiving with periodically tested restores (§9.4). **The restore test is the deliverable, not the dump.**
- **Schema.** Every Drizzle migration ships with a tested `down`. Staging runs `down` + `up` on every migration PR in CI.
- **Feature flags.** New capabilities ship behind a flag where practical. Removals do not — a half-removed loyalty system is worse than either state.
- **Payments.** **A payment rollback is a deploy, not a release** — which is the operational half of the OPEN-12 decision. v5.2's rollback was a per-device config flag *because* a POS fix was a 1–2 day App Review; there is no such constraint now.
- **Catastrophic.** Static "We're back at the counter" page; paper for the day; restore overnight; reconcile the next morning.

## 15 — Acceptance tests and verification

### 15.1 Gates

| Area | Unit | E2E | Manual drill |
| --- | --- | --- | --- |
| **The payment chapter** [new] | The four Web POS calls mocked at every status; **the 180 s ceiling writes `unresolved` and does not cancel**; a fetch error never resolves a payment; **a response containing a masked PAN produces no stored or logged copy of it** (L40) | Against Yoco's test credentials on staging: a success, a decline, a customer who walks away, a machine taken off the network mid-payment, a timed-out send, and **two successful payments on one order refused by the DB index** | **§6.8.2's R1.00 gate, all six steps, against the real Khumo.** Until it passes, the payment chapter is written on documentation rather than proof. **Record the tap count at step 5 and amend §05's Sunday budget to the measurement** |
| Gate zero (hosting) | — | Prod smoke green against the new host | **≥ 4 h live-queue hold through the edge.** Backup restored and verified, with the elapsed time recorded as the first RTO measurement. `dig` shows MX and NS unchanged. **`POST /api/payments/yoco/webhook` returns 404** — retired, not re-pointed |
| **Responsiveness** [new] | No network call blocks the add-item render | Tap-to-visual under 100 ms on the ordering path; order commit under 1.5 s at p95; cold load under 5 s | Throttled to 3G-grade on the real tablet: **the ordering path stays usable.** All four figures recorded at gate zero (§13.0) |
| Flow fix | Target binding rejects null | Ring up → walk away → Done → push arrives for a registered customer | Weekday drop-off drill: cup left on the counter, barista makes it 4 min later, the registered customer is notified **without anyone typing a name** |
| **Quantity and shots** [new] | **Tapping an item already on the order does not change its quantity** (L37); the stepper at zero removes the line; **a line at *n* shots deducts exactly *n* × coffee and 1 × everything else** (L38) | A quantity-2 line prices and costs per §7.0.2; an L33 comp on it zeroes both cups | Ring up two cappuccinos as one line and as two drinks, and confirm the till total matches expectation both times. **Ring two cappuccinos, one with macadamia: assert two lines**, then a third matching the first and assert it steps that line to quantity 2 rather than opening a third (DEF-E) |
| iOS install honesty | — | A registered iPhone customer who has not installed the PWA is told notifications need the install, and **is never shown a subscribed state** | Real iPhone. **The silent-failure case is the one that matters** (L29, R16) |
| No public order status | Queue stream rejects unauthenticated callers | No customer-reachable route returns order or queue state, **including an authenticated customer's own history for an in-flight order** (L23) | Attempt `GET /api/queue/stream` with no session — must be rejected |
| Offline trim and audit | Outbox write/replay: no data loss, **no duplicate order on replay** | — | **Physical drill:** network pulled mid-order, five orders rung up **including one entitlement claim** (L34), restored — five present, none duplicated, stock deducted once each, an audit row per replay. **If it fails, offline ships disabled** |
| Favo layout | — | Menu grid remains hittable while the Favo row is shown, measured at §17.6.3's POS viewport | Barista confirms no screen requires dismissing anything to reach the menu |
| Removal | Suite green after each step of §13.3 | No loyalty, wallet or pack surface reachable | Both enforcement greps return zero |
| Modes and deduction | Mode defaulting; mode-, event- and shot-aware deduction | Opening-window step defaults, overrides in one tap, broadcasts to the computed audience | Weekday order deducts **no** cup or lid; Sunday order does |
| Event mode | Posture switches; 24 h cap; auto-close reverts mode and prices **with no job** | Recurring Wednesday template defaults and confirms in one tap | **Discipleship 101 drill:** open, place orders, assert **zero payments sent and no card prompt**, assert cups **are** deducted, assert the window closes itself at 20:30 and Thursday defaults to Weekday |
| Walk-ins | Never charged, never counted against entitlement, `quantity` per line | POS walk-in flow | Weekly summary shows staff and walk-in as **two counts** |
| **Cost management — FIXTURE-A** | **Replay the 13 FAVO orders of 2026-08-16 and assert, to the cent:** `gross_zar` **R350.00** · `processing_fee` **R9.27** · `net_settled` **R340.73** · `written_off_zar` **R0.00** · `comps_zar` **R0.00** · `cogs_zar` **R196.36** · `gross_margin` **R153.64** · `contribution` **R144.37** · drinks **17** · double shots **10**. **Also assert the flag renders *provisional*, not green**, because every lot is an estimate | Admin opens the rollup; place a test order; figures move within 5 s | Admin confirms the rollup answers the funding question without assembly |
| **Cost management — FIXTURE-B** [adopted in v6.0] | **A synthetic day carrying one comp, one write-off, one path-B settlement, one entitlement cup, one walk-in line on an order that also has a paid line, one tip, and one quantity-2 line** — **extended in v7.0 with four voucher redemptions, two fund draws, a settled fund top-up, a four-shot line, and a line that exhausts a bean container mid-deduction.** Assert every §7.0.2 term individually, and assert `ministry_net` is **identical with and without §6.9.4's reclassification** while the day still prints `cogs_zar` whole. **One money fixture, not two** — *two is two places for the arithmetic to be certified differently, which is the defect C-1 exists to prevent.* Without the extension `topups_settled`, `surcharge_zar` and DEF-G's per-lot costing are all zero or unexercised in the only fixture that certifies them | — | **Why it is required.** Every discretionary term in §7.0.2 is **zero** in FIXTURE-A, so a formula wrong in `written_off_zar`, `comps_zar`, `tip_zar`, `entitlement_cups` or `walk_in_cups` **passes every existing check.** *A synthetic fixture that exercises a rule is worth more than a real day that does not.* This was proposed as review criterion C-1 and left undisposed; **v6.0 adopts it** |
| **Shot pricing, at every step** [new in v7.0] | Ring a cappuccino at 1, 2, 3 and 4 shots on a Sunday. Assert **R20.00 · R20.00 · R30.00 · R40.00**, and a quantity-2 line at 3 shots at **R60.00** — *the surcharge is per unit, not per line* | A four-shot drink deducts **4 ×** the base recipe's coffee and exactly **1 ×** cup, lid and milk. Assert per ingredient, not on the total | **Weekday shot ceiling:** in weekday mode the picker renders **two** segments and a direct write of 3 is rejected; in Sunday and paid-event mode it renders T15 segments |
| **A multi-shot line spanning two bean lots** [DEF-G] | Open a bean container with two cups left, ring a four-shot drink. Assert the deduction **completes by auto-opening the next sealed container**, and that `line_cogs` costs **two units at the first lot's rate and two at the second** — not four at either | — | — |
| **L48 · nothing inert on screen** [new in v7.0] | Weekday order: no voucher chip on any line. Order with no net charge: no fund chip. Hot chocolate line: no shot picker. **Assert on the rendered tree, not on the click handler** | — | **The busiest realistic order still fits:** three lines, two fund chips, voucher chips live. Measure every interactive target in the order panel on the real tablet at §17.6.4's geometry — **all ≥ 44 px, gaps ≥ 8 px. Run this before a sixth per-line control is ever added** (§6.2.4d) |
| **One discount mechanism per line** [DEF-A · DEF-B] | Attempt an L33 comp on a line carrying an entitlement, and on a line carrying a voucher. **Both rejected.** `SELECT … WHERE discount_zar > quantity * unit_price_zar` returns empty. The comp ceiling reads `line_gross − discount_zar` | — | — |
| **Nothing worth R0 reaches the machine** [DEF-C] | — | Comp a Sunday single-line order to R0, then a voucher on the same shape. Assert **no `payments` row and no call to `sendToTerminal`** in either case, and `payment_mode='free'` | — |
| **Vouchers** [new in v7.0] | A voucher zeroes exactly one unit; a line at quantity *n* accepts *n* redemptions and rejects the *n*+1th; **a removed voucher writes a reversal, never a delete** — apply and remove three times and assert three rows carrying `reversed_at`, that `voucher_cups` counts none of them, and six audit entries (COL-29) | T9 — one order, five new people, five slips across two lines: **total R0, no payment row, nothing sent to the terminal.** T10 — a vouchered hot chocolate beside a paid cappuccino: **the amount handed to the machine is the cappuccino alone**, and the notification target is the member | **Offline drill:** ring three vouchered orders offline and reconnect. Assert all three replay with their redemptions intact, none is charged, and none is flagged as an exception — **unlike an entitlement claim, which L34 still fails visibly offline** |
| **The voucher's paper control** [new in v7.0] | A session closed with **no slip count** leaves `voucher_slips_counted` NULL; **neither `closeSession` nor `closeDaily()` is blocked**, and the day's variance renders `UNAVAILABLE` rather than zero (L43) | A count differing from `voucher_redemptions_recorded` raises the L09 admin push **with both figures**, and the close completes | §7.3.1 shows each barista's vouchers as **a count and a value**, and a period with vouchers never shows one without the other (§6.9.2a) |
| **Sessions** [new in v7.0] | **One session open at a time, enforced at the DB.** Open a session, attempt a second on the same date, assert `STALE_STATE` from the partial unique index. Close the first, open the second, assert it carries **its own mode, deferred state and voucher kinds** | **Order numbers run across sessions.** Ring orders in a morning session, close it, open an evening session and ring more. Assert `daily_seq` **continues rather than restarting**, and `UNIQUE (revenue_day, daily_seq)` is never violated (COL-30) | A session bound to an event window is **force-closed when the window expires**, audited, with the slip count prompted as normal (COL-11) |
| **Search never blocks the order path** [DEF-F] | Type into the search field and, **while the request is in flight**, ring a drink and step its shots. Assert the menu stayed tappable and **no render waited on the call** (L35). *This is the assertion DEF-F exists for* | `tha` returns Thandeka; `andre` returns André; four phone digits return their owner. Two customers sharing a given name render with surnames, and if still alike, with four phone digits. **No email and no full phone number in any payload** | Search a name that does not exist: **an empty list, no error, and `none` presented as a choice the barista taps** — L28 forbids defaulting into it |
| **The fund — money in** [new in v7.0] | **A balance never exists before the money does.** Ring a R500 top-up, then decline the card: assert the balance is zero and the fund is not drawable. Repeat with a timeout: assert the entry shows `pending`, contributes zero, and becomes drawable **only after `resolveTenderByLookup` confirms it**. *This is the test the whole of §6.10.3 rests on* | **A payment points at exactly one subject:** `SELECT … WHERE num_nonnulls(order_id, fund_topup_id) <> 1` returns empty, and an attempt to ring a top-up onto an open order is refused. **A second successful payment against one top-up is refused by the DB** (COL-5) | **T13 is checked before the machine, not after.** Attempt a R5,000 top-up: assert `VALIDATION`, **no payment row and no call to `sendToTerminal`** (R23) |
| **The fund — money out** [new in v7.0] | **A fund never writes to `payments`** — draw twenty fund orders on staging and assert the table is untouched and T10's exception list is empty. **A fund cannot go negative:** two simultaneous draws against a fund holding one drink's worth — one succeeds, one returns `FUND_INSUFFICIENT`. *This is the `FOR UPDATE` test and it is the only place §6.10 can lose money* | **A fund-paid order is never written off.** Draw a fund on ten orders, run `closeDaily()`, assert **zero write-offs and an empty unpaid-orders list**. **A fund-settled order is frozen:** a comp, a voucher, a new line or a quantity step all return `TENDER_IN_PROGRESS`. **A cancelled fund-paid order** writes a compensating `adjustment` and never edits the spend entry | **Selection is deterministic and the footer does not grow.** Three open funds topped up in March, June and August: assert **the March one is offered and drawn**, then drop it below the order value and assert June is offered. With five funds — two linked, three open — assert **at most two tender chips**, the override list carrying the three open ones and none of the linked |
| **The fund — who may do what** [new in v7.0] | **No self-service top-up path exists:** no route, endpoint or action reachable by a *customer* session increases a fund balance (L44), and a deep link to the admin cash/EFT route from a barista PIN session returns the admin 403 page | **Linked names gate the draw.** Draw against a three-name fund for a fourth person: `FUND_NOT_LINKED`. For a linked person: **auto-applied, declinable in one tap.** Against a fund with no names: the explicit tap path, for anyone. **Linking a customer to a second active fund is refused by the partial unique index**, not by application code alone | **No fund balance reaches a customer:** no push, no in-app screen and no customer-scoped endpoint returns a fund balance or ledger (L46). Asserted on the payload of **every** customer-scoped read |
| **An unknown payment mode breaks a report** [new in v7.0] | Feed a report an unhandled `payment_mode` and assert it **fails loudly rather than absorbing the row** (§10.6) | **Run it before the `donor_fund` enum value ships**, so the migration and the report updates are one change (COL-7) | — |
| Deferred settlement | An order cannot be settled twice; **`closeDaily()` leaves no unpaid order open** | Force the machine unreachable on staging: orders are created deferred, stock deducts at `in_progress`, settlement works by both paths, **and a settle on an order whose earlier payment actually succeeded is refused with `ALREADY_RESOLVED`** | Write-off drill: leave one deferred order unsettled to close, confirm it is written off, appears as a loss on its own line, raises the approval queue, and **does not roll over** |
| Extra-shot pricing | **R10 per shot beyond the second** applies on Sunday and on switched-on events; **never on a weekday or a free event**; the line deducts `shots` × coffee | A Sunday order at three shots totals item + R10; **at two shots it totals the item alone** | Barista rings 1, 2, 3 and 4 shots in each mode and confirms the till total matches expectation |
| Saturday | `setDayMode` rejects any Saturday session with no event window | Opening step on a Saturday offers *Start an event*, not a mode picker | Attempt to open a Saturday normally — **it must not be possible** |
| Price override integrity | Snapshot and `price_history` agree; editing one alone is rejected; **`setMenuItemPrice` fails rather than writing an anonymous row** | Open an event with overrides, close it, confirm prices revert **and no past order re-prices** | Daily equality check returns zero discrepancies |
| **Alerting** [new] | Each §9.6.3 condition fires once per incident | Force a close mismatch on staging and confirm the Admin device receives it **before** Discord is deleted (§13.5) | **De-duplication drill:** take the card machine off the wifi for an hour and assert **one alert plus one resolution notice, not sixty.** Assert the barista's own device was alerted, not only Nikao |
| Session and rate limits | The till PIN pad is not rate-limited; the admin PIN cools down at 5; a session cannot exceed 12 h | An idle till **does not lock during an opening window** and does lock outside one | *Hand over* ends the session with orders in flight untouched, and the next barista's actions attribute to them |
| Audit coverage | Every mutation and **every refusal** writes a row | `GET /api/admin/audit-coverage` returns **0 orphans** | — |
| Accessibility | Contrast and touch-target checks in CI against §17.6's tokens | — | **Barista drill with wet hands:** no mis-taps on the primary order path (§17) |

### 15.2 Protocol

1. **Pre-merge.** CI runs `bun typecheck`, `bun lint`, `bun test:unit`. All green, no exceptions.
2. **Merge.** Squash to `main` with the WI key in the commit message.
3. **Deploy.** Automatic on merge to `main` (§9.7).
4. **Post-deploy smoke.** Read-only paths only. **No mutating tests against live data** — and specifically **no payment sent to the live card machine from a smoke test**, because there is no void.
5. **Ship record.** Deploy SHA, URL, smoke result and audit-coverage result recorded on the WI. **That record is the ship notification** — there is no chat-channel ping (§8.10).

### 15.3 Live-op drills

`SC01`–`SC05` from `docs/HANDOVER_LOOSE_ENDS.md` still stand. **`SC08` (offline: zero orders lost) is retired** — replaced by a CI regression test on the outbox write/replay path, which catches the same failure on every PR instead of once in a drill. **A new drill is added:** the de-duplication drill in §15.1, because §9.6.3's alerting is only as good as its signal-to-noise ratio and that cannot be unit-tested.

> **Three review criteria adopted in v6.0**
>
> These were proposed during the v5.2 review, left undisposed because a criterion is a change to the bar the document is judged against, and **each has a live instance in this document's own history.**
>
> **C-1 — a money fixture must exercise the rules it certifies.** Adopted as **FIXTURE-B** above.
>
> **C-2 — every identifier a formula reads must resolve to a declaration.** Adopted as a mechanical pass over this document: **every backticked identifier in §6.0, §7.0.2 or §12 must resolve to a declaration in §10.2, §10.3, §11.2 or §11.4.** `cost_estimated`, `set_by_staff_id`, `completed_at`, `qty`-vs-`quantity`, `surcharge_zar`, `price_delta`, `receipt_suffix` and `pending_charges` were all instances, and **each survived a review that met every listed check.**
>
> **C-3 — "the PRD wins" needs an exception for physical impossibility.** Adopted: **where this document specifies an interaction with an external system, the artefact that system actually produces is dispositive *as to feasibility*.** The live instance was v5.2's instruction to match the daily import on `receipt_no`, which **no grounded artefact could satisfy** — under the stated precedence, that instruction outranked the export proving it could not run. **§6.8.2's R1.00 gate is C-3 applied to the payment chapter**: the machine's actual behaviour outranks this document's description of it.

## 16 — Decisions

### 16.1 Closed

Dated owner decisions, with the reasoning that produced them. **Where a decision was later overturned, both the decision and the reason it fell are recorded** — a document that records why it changed its mind prevents those arguments from being re-run.

| Decision | Resolution | Where |
| --- | --- | --- |
| **The POS↔card-machine seam** | **The Web POS route. Owner decision, 2026-09-07.** FAVO's server sends the amount to the card machine over Yoco's Web POS API; FAVO stays a web app. **This supersedes the 2026-08-20 decision (Option C, two-phase native wrapper), whose stated premise — that a website cannot reach a physical card reader — was true of Yoco's Payment SDK and false of Yoco's API.** Rejected, with reasons: **A** side-by-side permanently (L01 never enforceable in software); **B** Yoco Online inside FAVO (a web card form at a counter with nine people queuing, and online rates are normally dearer than card-present); **C** the native wrapper (six to twelve weeks behind an approval FAVO does not control, a payment credential on the counter tablet, a 1–2 day App Review on every hotfix, and a one-device advantage that is unconfirmed and probably absent — §6.8.0). **Phase 0 is deleted, not exited** | §6.8 · §9.10 · §8.9 |
| The SDK application | **Submitted anyway, as insurance.** Owner decision, 2026-09-07. A free form with a multi-day turnaround, and the only fallback if §6.8.2's device-link step fails against the real machine. **It is a one-line contingency, not step 0**, and nothing in the sequence depends on it | §13.0 · §13.1 |
| Card-machine model | **Khumo Print family** — large touchscreen, prints slips. Identified on sight, 2026-09-07, which settles the half of OPEN-11 that mattered: **the café is not on a Yoco Go, so no hardware purchase is implied and no phone-pairing workaround is needed.** *The remainder — Khumo Print 2 support, and whether the supported-model list is Yoco's or a third party's — is in §16.2* | §6.8.2 · §9.10.1 |
| Ingredient costs | **Best-estimate costs now, real invoices later — with a condition.** Owner decision, 2026-09-07. Ship so the profit indicator works end to end rather than sitting dark, and **wire the *provisional* label to a per-ingredient `cost_source` field, not to a date and not to a developer remembering.** Two known defects are fixed regardless of estimate quality: the bean cost discrepancy of ~170% against Yoco's implied figure, and the three milks costed at zero | §7.0.1b · L39 |
| Ringing a quantity of two | **A stepper on the order line. Owner decision, 2026-09-07.** First tap adds; repeat taps highlight only; **− / +** on the line; remove at zero. **This overrides v5.2's own default of repeat-taps-increment** — a stray tap that silently doubles a drink is discovered when the total is wrong, which on a Sunday is after the customer has paid it | §6.2.2 · L37 |
| The double shot, and the weekday tap budget | **A modifier on the drink, not a second item; the weekday budget closes at 4 taps.** Owner decision, 2026-09-07. One extra tap on the line already added, and a **recipe-level multiplier on the coffee deduction** — which is also the R8 fix. Set at 4 rather than 3 **so the document is not held open waiting for an observation nobody has made**. **⚠ Its pricing half (DEC-08) is superseded by DEC-16**; the modifier-not-an-item half and the multiplier both stand, generalised from a pair to a count | §6.2.3 · L38 · L31 |
| POS responsiveness | **Instant for drinks; FAVO waits only for money.** Owner decision, 2026-09-07. The principle is the testable part; the four figures are its budget. **The undecided 300 ms placeholder is retired.** The payment wait gets a visible progress state and a 180-second ceiling | §05.1 · L35 |
| Rate limiting | **Generous on accounts; tight on the admin PIN; the till never locks out.** Owner decision, 2026-09-07. Customers 10 per account per 15 min and 30 per IP; admin PIN 5 then a 5-minute cooldown and an alert; **the barista till session is never rate-limited and never auto-signed-out during trading hours** | §9.5.3 · L36 |
| The training bar | **Two criteria: a weekday shift solo, and a supervised Sunday.** Owner decision, 2026-09-07. The suggested single criterion covers only the easy shift — **a bar that never tests Sunday does not test the thing most likely to break** | §05.3 |
| Alerting | **Alert on anything that could lose money or data, routed to whoever can fix it.** Owner decision, 2026-09-07. Four immediate conditions, one daily digest, and **de-duplication as a requirement** — alerts people learn to swipe away are worse than no alerts. **The card-machine alert goes to the barista's own device**, because they are the one standing next to it | §9.6.3 |
| Scheduled jobs | **Closed by the §9.6.2 register** — six jobs, their schedules, their missed-run behaviour and who is told. What remained was a tuning value in `app_config`, not an open question | §9.6.2 |
| Priority order | **Ease (baristas + customers) first; cost management second.** Owner decision, 2026-08-12, reversing the v4 scope paper | §03 |
| Domain | **`favo.hofmi.net`.** Nothing to register, nothing to buy. A `.co.za` remains a later branding option — the base URL is one config value | §9.3 |
| Cloudflare mechanism | **Cloudflare for SaaS custom hostname on Transformate's zone.** Available on Free/Pro/Business. **No `hofmi.net` zone migration; NS stays at Xneelo; Google MX untouched.** The earlier Enterprise-only concern conflated this with onboarding our own zone in partial setup | §9.3 |
| Data residency | **EU.** POPIA-compliant with the documented safeguards; no cost delta; app and DB co-located, which is the latency that matters. **Revisit trigger:** if the 1.5 s commit figure is breached during the gate-zero drill, re-open with SA as the alternative. *The trigger was previously a tap-response figure, which §05.1's principle makes the wrong measure* | §9.4 · §13.0 |
| Event mode design | **Closed — §6.6 is a buildable spec. Five switches**, three activation paths, automatic close on read. *v5.2's version of this row said "four switches", a figure DEC-08 superseded on the same day it was written and which the review's own freeze rules would not let it edit. Corrected here, which is one of the things a final version is for* | §6.6 |
| Free events | **Supported and specified.** Payment posture is per-event; `free` sends nothing to the machine. Discipleship 101 is the reference case and the acceptance drill | L25 · §6.6 |
| Discord | **Removed entirely — deleted from the codebase, not left unconfigured.** All alerting consolidates on Web Push + the in-app admin dashboard. Owner decision, 2026-08-12. **The L09 replacement must land before the deletion** | §8.10 · L09 |
| Loyalty / wallet / packs | **Removed, hard delete, no wind-down.** Owner decision, 2026-08-12 | §08 |
| Offline mode | **Trimmed, not kept wholesale and not deleted**, and it is an **audit gate**: it ships disabled if the audit does not pass. Owner decisions 2026-08-12 and 2026-08-19, the first revised on Mia's correction — the original reasoning conflated power outages with network blips | §8.4 · DEC-12 |
| Guest notifications & customer order status | **Out of scope entirely.** No guest QR, no pairing token, and **no customer-facing order-status or queue view**. Owner decision, 2026-08-12: *"the POS queue page is completely out of scope."* | §8.5 · L23 |
| Saturday | **No default mode — the café is treated as closed, and a session cannot be opened without an event window.** No Saturday value in the mode enum, because every option would be wrong. Owner decision, 2026-08-19; surfaced by Mia's question about how mode is derived. *v5.2 carried this as two separate rows saying the same thing; merged here* | §4.2 · DEC-04 |
| VAT | **Not VAT registered.** Prices are VAT-free; no VAT computed or reported. Reopens if turnover approaches R1m. Owner decision, 2026-08-19 | L30 · DEC-01 |
| Card machine unavailable | **Orders are created deferred and settled after, or written off at day close.** L01 gains an explicit exception; the standalone machine's reference is captured so the fallback is reconcilable. Owner decision, 2026-08-19 | §6.7 · DEC-02 |
| Event price storage | **Both — `price_history` is the source of truth, the window's snapshot is a read cache**, written in one transaction and never edited alone. Owner decision, 2026-08-19 | §10.6 · DEC-03 |
| Recovery targets | **RPO ≤ 5 min via continuous WAL archiving; RTO ≤ 4 hours.** Nightly-only backups rejected — they place a full Sunday inside the loss window. Owner decision, 2026-08-19. ⚠ **The RTO has no contractually responsible party until OPEN-08 is answered** | §9.4 · DEC-05 |
| Receipts | **None.** The terminal's slip only; no printer, no drawer, no digital receipt. Owner decision, 2026-08-19 | §8.6 · DEC-06 |
| Design system in the PRD | **Yes — a full Design chapter.** The system stays in the codebase; the PRD names it as authoritative, consolidates the UI rules already scattered through §6.2/§6.4/L15, and adds the screen inventory and states. Owner decision, 2026-08-19 | §17 · DEC-07 |
| Cancelling an order | **Barista before making; admin PIN from `in_progress` onward**, with compensating stock movements. L02 still applies — cancellation is not a refund. Owner decision, 2026-08-19 | §11.3 · DEC-10 |
| Do baristas get the free weekday coffee? | **Yes — via a `customers` row like anyone else.** One mechanism, no parallel FAVO-staff allowance. Owner decision, 2026-08-19 | §1.1 · DEC-11 |
| The POS device | **Closed without pinning a device.** Targets are authored in CSS px and millimetres derived from **132 logical ppi**, the constant for every standard iPad, giving **44 px = 8.46 mm**. The owner's instruction was *"build to a generic slightly older iPad and let it adapt"* — so **the answer was to specify no device at all rather than to name one.** The one residual: **an iPad mini (163 ppi) falls below the 8.46 mm floor** and would need the px tokens raised first | §17.6.4 |
| **DEC-16 · Shot pricing** [new in v7.0] | **Supersedes DEC-08.** One and two shots are both the listed price; **R10 a shot from the third.** T09 becomes `extra_shot_zar` and `order_items.shot` becomes `shots`. Owner decision, 14 Sep 2026, **from the counter rather than from the first month's reports** — *and it is the revision v6.0's own §12.2 left T09 tunable for.* Falls out of it: **the second shot is the least profitable thing FAVO sells**, and 83% of cappuccinos take it, so margin must break out by shot count | §6.2.3 · L31 · L38 · T09 · T15 |
| **The shot control** [new in v7.0] | **A segmented `1 2 3 4` picker, not a − / + stepper.** Owner decision, 14 Sep 2026. It **designs out** the two-adjacent-steppers hazard rather than testing for it, and costs a tap less on triples and quads. Its segments are **spaced, not flush**, so D1's 8 px floor is not broken by a drawing convention | §6.2.3c · §6.2.4d · D10 |
| **Weekday shots** [new in v7.0] | **Capped at 2.** Owner decision, 14 Sep 2026. The picker renders two segments, not four greyed ones (L48). *Nobody pays on a weekday, so a third shot is beans given away with no pricing question to settle. The cost the cap bounds is about R6,600 a year* | T15 · §10.5 |
| **Sessions** [new in v7.0] | **A revenue day carries as many sessions as it needs, at most one open at a time.** Owner decision, 14 Sep 2026. **Reverses v6.0's §11.2 narrowing** and answers the objection that produced it: *"the current session" is a definition, not a search.* Largely *not doing* a migration v6.0 commissioned | §6.11.1 · §11.2 · §13.2 |
| **Untracked Church** [new in v7.0] | **A recurring event profile carrying a sixth switch — which voucher kinds are live.** Owner decision, 14 Sep 2026. It puts the voucher where the vouchers actually are rather than deriving it from the day of the week, and it is genuinely independent of the other five switches | §6.11.2 · §6.6 · T12 |
| **DEC-13 · The voucher** [new in v7.0] | **Adopted.** One tap, one unit, **the surrendered slip counted at the close as the control.** No serials, no codes, no typing. Owner decision, 14 Sep 2026 | §6.9 · L41 · L43 |
| **The voucher's value** [new in v7.0] | **Zeroes the whole unit, extra shots included** — L03's rule word for word. Owner decision, 14 Sep 2026. *A slip is therefore worth between R20 and R45*, and §6.9.2a's per-barista count-and-value reporting is what makes that safe | §6.9.2a · §7.3.1 |
| **Vouchers offline** [new in v7.0] | **They queue and replay cleanly.** Owner decision, 14 Sep 2026, *reversing an earlier recommendation.* **L34's connection requirement does not transfer** — it exists because the entitlement is guarded by `UNIQUE(customer_id, day)`, and **a voucher has no uniqueness constraint for a replay to violate.** It is a line attribute of order creation, which §8.4 already queues | §6.0.6 T5 · §8.4 · L34 |
| **DEC-14 · §8.2** [new in v7.0] | **Narrowed, not deleted.** Owner decision, 14 Sep 2026. The guard against a customer stored-value wallet stays; **the line moves to admit a named, non-refundable blessing fund** opened at the counter or by an Admin. *Deleting §8.2 would have removed the only thing standing between FAVO and a customer wallet* | §8.2 · §6.10.1 · L44–L46 |
| **Who may open a fund** [new in v7.0] | **A barista, at the counter** — the first entity-creating action a barista may call. Owner decision, 14 Sep 2026. **R22 is the price and is recorded at Low/High with its mitigations rather than argued away**, and an unnamed fund fires an immediate Admin push | §10.7 · §6.10.3 · R22 |
| **Fund draws on a linked name** [new in v7.0] | **Auto-applied, declined in one tap** — L03's posture, for L03's reason: a standing arrangement should not cost a decision every time. Owner decision, 14 Sep 2026. **No donor statement**, and the barista may read a fund's *balance* to answer the person in front of them | §6.10.2 · §6.10.5 · L46 |
| **The top-up fee** [new in v7.0] | **The fund is credited the full amount; Yoco's fee flows to `processing_fee`** like any other card sale. Owner decision, 14 Sep 2026. *R13.25 on a R500 gift — about one cappuccino's margin — and nobody has to explain to a donor why R500 bought R486.75 of coffee* | §6.10.4 · §7.0.2 |
| **DEC-15 · A top-up in the books** [taken, with one read outstanding] | **Money owed in coffee, not income, until the coffee is drawn.** Owner decision, 14 Sep 2026. *Marked for a read by HOFMI's bookkeeper before the fund goes live — **it gates that and nothing else***, and it is the only treatment under which "how much is left in my fund" is a real figure | §6.10.4 · §7.0.2 |
| **The group tab** [new in v7.0] | **Recommended against, and adopted as a non-goal.** Nikao, 14 Sep 2026. Settling many orders on one card tap needs a payment pointing at more than one order — **the one schema change FAVO cannot afford**. *A group fund with linked names does the same job with the cash moving one day earlier* | §8.11 · §6.10.2 |
| Timeline | **No fixed date.** Gate zero first, then priority order | §13 |

### 16.2 Open

**One decision, one narrowed question, and two unconfirmed facts.** v5.2 had nine live items, four of them the owner's. Every entry below carries an owner and a gate, and **the one with no default has no default deliberately.**

| ID | Question | Owner | Gate | Default if undecided |
| --- | --- | --- | --- | --- |
| **OPEN-08** | **Commercial terms with Transformate.** The only item nobody could close with a sensible default, **because commercial terms are not a technical decision.** Four questions are with Matt: **(1)** the infrastructure figure against the expected under-R500 a month; **(2)** what the separate service fee is and what it covers; **(3)** whether the server and database accounts sit in FAVO's name or Transformate's, and whether FAVO could take its data elsewhere; **(4)** who is actually on the hook if the server dies at 08:00 on a Sunday. <br>**That last one is the gate.** §9.4 commits to being back up within four hours, and **Sunday is the only paid trading day.** A four-hour recovery promise with nobody contractually responsible for it is a promise that gets tested on the worst possible morning. | Nikao ↔ Matt | **Settled before gate zero completes.** Gate zero is the migration onto this infrastructure, so it is the point of commitment (§13.0) | ⚠ **No default. Do not record an assumed figure as a decision.** The expected under-R500 a month is an expectation, not a quote |
| OPEN-10 | **Does a payment send de-duplicate on `client_reference`?** Yoco documents no idempotency mechanism on any identifier. **Narrowed rather than closed:** the Web POS route gives every payment an explicit, server-fetchable status, so FAVO no longer *needs* idempotency — it can ask what happened (§6.0.1 S4). **This is a question for Yoco, not a gap in this document** | Nikao → Yoco | Answered in the same email; blocks nothing | **Assume NOT idempotent.** Resolution of an unresolved payment is a lookup, never a re-send. The only door to a second send is S4 step 3's three-condition test. **This default is safe whichever way Yoco answers** — a *yes* would merely let FAVO relax a rule it does not need to relax |
| **FACT-1** | **How is a physical terminal linked to a Web POS device?** Creating the device, sending it a payment and fetching the result are all documented. **The step that binds FAVO's device record to the Khumo on the counter is not**, and it is the single genuine unknown in the payment chapter | Nikao → Yoco, and one physical check | **§6.8.2's R1.00 test, at gate zero** | **Assume it is self-service until the test says otherwise.** If it needs Yoco-side enablement, **that is a delay, not a reversal** — the SDK application is already in the queue (R18) |
| **FACT-2** | **Is the supported-model list Yoco's, or a third party's?** The list putting the Khumo Print family in scope for Web POS comes from an **integrator's help pages, not from Yoco**, and Yoco now sells a "Khumo Print 2" whose status is unstated. **v5.2's own warning about third-party lists still applies; this document narrowed it and did not close it** | Nikao → Yoco | Before any hardware is bought | **Record the model as "Khumo Print family, pending written confirmation from Yoco", and do not cite the third-party list as a source.** The device lookup of §9.10.1 returns the terminal's own model and serial number, **which settles this from Yoco's own record** the moment the device is created |
| FEE-1 | **Does `GET /v1/payments/` return `processing_fees`?** If it does, the daily manual export upload becomes a server-side fetch and §7.5's one regression against the incumbent closes. **Untested by anyone** | Nikao → Yoco | Not a blocker | **The daily import stays the specification in force** (§6.8.3). **Nothing in this document depends on the REST route either way**, and it must not be built on before it is verified |

> **Two measurements outstanding from amendment pack A — neither is an open decision**
>
> Recorded because they are worth doing, and flagged because **neither blocks anything and neither changes a word of this document.** They validate figures §6.9 argues *from*; they do not change what it specifies.
>
> - **Count the taps for a 100% discount on Yoco.** Two minutes. §6.9 is justified against "about ten", which is an observation rather than a measurement. *If it turns out to be six, §6.9 is still right and one sentence in it gets a better number.*
> - **Tally one Untracked Church evening's first-timers.** One sheet of paper. It replaces T11's default of 25 — *an admin-tunable config value, changeable without a deploy* — and it is also the count that would decide whether the *Voucher every drink* shortcut is ever worth building (§6.9.1b).

> **Closed since v5.2, for the record**
>
> **OPEN-01** (responsiveness) · **OPEN-02** (job schedules) · **OPEN-03** (rate limits) · **OPEN-04** (alerting) · **OPEN-05** (training bar) · **OPEN-06** (ingredient costs, closed *with a condition*) · **OPEN-07** (the design system and the POS device) · **OPEN-09** (the reader seam, closed 2026-08-20 and *re-decided* 2026-09-07) · **OPEN-11** (the machine, closed as to family; the residue is FACT-2) · **OPEN-12** (the Web POS route) · **OPEN-13** (quantity) · and **D.5** (the double shot).

## 17 — Design

### 17.1 Authority — two layers, and what each governs

> **Layer 1 — the FAVO brand system**
>
> `FAVODesignSystem_99c02a`, an unversioned handover dated 2026-08. Authoritative for **brand**: the five colour anchors, the two type families (Barlow Condensed display / DM Sans body), the spacing and radius scales, voice, and the packaging, signage and marketing-web surfaces. Its 54 tokens define every colour, type step, spacing value and radius used anywhere in the product.

> **Layer 2 — the application component layer**
>
> **This does not exist and §17 commissions it.** It is derived from Layer 1's anchors and scales, and it — not the brand system — is what POS, admin and customer screens are composed from.

**Why this is split, stated plainly because v5.0 got it wrong.** §17.1 previously named "the FAVO design system" as *"the source of truth for all UI"* whose components screens are *"composed from."* **The system that exists cannot bear that.** Verified against the delivered bundle: its README scopes it to *"packaging, in-store signage, cups, and website"* and states *"No Figma, no codebase, no decks attached"*; its manifest exposes **one** component, from a website kit, with **no POS kit, no admin kit and no tablet viewport**; it contains **no size, touch-target or hit-area token of any kind**, so §17.3's "touch targets verified in CI against the tokens" had nothing to verify against; it contains **no status colour of any kind** — no success, no warning, no error, no red, no green; and **it has no version field.** Had the path slot simply been filled in, §17.1 would have asserted authority over the POS on behalf of a document that never mentions it — **and its standing prohibition would have made every POS screen a PRD amendment**, forbidding exactly the component work the POS needs.

> **Standing prohibition, restated for two layers**
>
> A raw hex value outside Layer 1's token set requires a PRD amendment. **A new application component is expected** — that is what Layer 2 is — **but it must be built from Layer 1's tokens and added to Layer 2's inventory, never hand-rolled into a screen.** A component that introduces a colour, type step, spacing value or radius not in Layer 1 contradicts this document: flag it, don't build it.

### 17.2 Consolidated UI requirements

Requirements, not suggestions. They existed in v5.0, scattered through functional chapters where they read as commentary. Gathered here so they are enforceable, with their origins.

| # | Requirement | Origin |
| --- | --- | --- |
| D1 | **Minimum touch target, per surface** — POS **44×44 px = 8.46 mm**, admin **40×40 px = 7.69 mm**, customer **44×44 px** — with ≥ **8 px = 1.54 mm** between adjacent targets. Millimetres are derived from 132 logical ppi (§17.6.4) | AT-138 · §6.2 · §17.6.4 |
| D2 | **The Favo row is inline, above the menu grid, and occupies ≤ ¼ of the order panel.** Never a modal, interstitial or full-screen state | §6.4 |
| D3 | **The menu grid stays visible and tappable at all times.** No state requires dismissing something to reach the menu | §6.4 |
| D4 | **No full-screen interstitials anywhere on the ordering path** | §6.2 |
| D5 | **"Done" is the most prominent action on the active-order view** | L15 |
| D6 | **"Something else" is a dismissal, not a navigation** — it opens no screen | §6.4 |
| D7 | **A shallow path from customer lookup to order placed.** No routine action buried more than two levels deep | §6.2 |
| **D8** [new] | **The quantity stepper sits on the order line, is at least a D1 target on both controls, and is never the same tap area as the item tile.** A stepper a barista can hit by accident is the failure L37 exists to prevent | §6.2.2 · L37 |
| **D10** [new in v7.0] | **The shot picker sits on the order line, renders one target per selectable value at D1 size *with D1 spacing between them*, renders only the values the session's mode permits, and is never adjacent to the quantity stepper without a visual break.** D8 stays exactly as it is, for quantity. *A segmented control is conventionally drawn flush — four 44 px targets sharing borders is 0 px between adjacent targets, which is exactly the floor D1 states, so the rule would be broken by a convention rather than by a decision* (COL-9) | §6.2.3c · §6.2.4d · L38 |
| **D9** [new] | **The payment wait is a progress state readable from arm's length** — the amount and the fact that FAVO is waiting on the machine — **and it is never a bare spinner and never a blank screen.** It is the one place in the POS where the barista is asked to wait (L35), so it is the one place a wait must look deliberate | §05.1 · §6.8.4 · L35 |

### 17.3 Accessibility

The POS is used at speed, with wet or full hands, by someone with a queue. **Accessibility here is throughput, not compliance.**

- **Contrast ≥ 4.5:1** for body text, **≥ 3:1** for large text and meaningful UI boundaries — measured against WCAG 2.2 AA, and **binding on the app regardless of what the brand system approves for print.** **Three of Layer 1's own pairings fail this and are therefore prohibited for app body text:** `--fg-2` (Cool Steel) on Porcelain at **2.46:1** — which is the brand system's designated *secondary/support text* token and fails at every size; `--accent` (Crimson Carrot) on Porcelain at **3.12:1**; and white on `--accent` at **3.38:1**. The latter two are usable for large text and boundaries only — **which directly constrains D5**, since "Done" is the most prominent action in the product and its label is body-sized. Support text in the app uses `--fg-1` or a Layer 2 token meeting 4.5:1, **never `--fg-2`**.
- **Touch targets per D1**, verified in CI against **Layer 2's size tokens** — Layer 1 has none — rather than by eye.
- **Every admin action reachable by keyboard**; admin is used on a desktop.
- **Every control has an accessible name.** The customer PWA is public and must be usable with a screen reader.
- **No colour-only signalling.** The profit/loss indicator is red/green — it needs a second cue (a sign, a word, or an arrow), since red-green is the most common colour-vision deficiency **and this is the number the whole of Priority 2 exists to communicate.** **Layer 1 contains no red and no green**, so this indicator was previously unbuildable without violating §17.1's raw-hex prohibition; §17.6.1 adds the semantic tokens it needs. **And the *provisional* state of L39 needs a third treatment** that is neither red nor green and cannot be mistaken for either.

### 17.4 Screen inventory

**Reconciled against `src/app/` at `main @ 9aefc2c` — 37 page routes.** v5.0 labelled this inventory *"Draft — to be confirmed against the running app"* and omitted **13 routes that exist**, which mattered because this table is what carries the states requirement: **an un-inventoried screen gets no states.** The omissions, each with a disposition:

| Route | Disposition |
| --- | --- |
| /admin/yield | **Keep and spec.** It shows container yield — the input to §7.0.2's `unit_cost` — and it is **the only path from `cost_source = 'estimate'` to `'invoice'`**, so it is load-bearing for Priority 2 and for L39 |
| /pos/today · /pos/history | **Keep and spec** — these are §7.5's Day summary and its history |
| /admin/menu/[id]/recipe | **Keep and spec.** Recipe editing is load-bearing for §7.4's cup/lid-per-recipe and §10.5's deduction fix |
| /admin/hours | **Keep and spec** — operating hours, governed by L04 |
| /admin/customers · /admin/customers/[id] | **Keep and spec** — §13.3 step 6 requires editing the detail view |
| /admin/reports | **Keep and spec** — the export surface of §7.2, **and the Yoco-export upload the daily import reads** |
| **/admin/funds** [new in v7.0] | **New and specified.** Every blessing fund with its balance, ledger, member list and last draw, **in draw order with each one's queue position and a depletion estimate** (§6.10.6). It is the *only* surface where a fund's ledger and member list are readable, and the only place a cash or EFT top-up is recorded (L46, §10.7) |
| / · /menu · /privacy | **Keep as-is** — public marketing and POPIA surfaces, governed by Layer 1, not the app component layer |
| /reset-password | **Keep and spec** — §9.5, rate limits §9.5.3 |
| /admin/login | **Resolved — consolidate on `/staff/login` and delete `/admin/login`.** §9.5 describes **one** staff auth system with two roles and one session contract; **two login surfaces means two places a session lifetime, a rate limit and an idle lock can drift apart**, and §9.5.3's limits would have to be applied twice or be applied once and miss a door. **Role is read from `staff.role` after the PIN verifies** — it was never a property of which page you started on. §13.6 carries the deletion, gate: `grep -rIn 'admin/login' src/` returns zero. *This row said "Resolve" — a task, not a disposition — for two review runs* |

#### 17.4.1 The states, per screen

A blanket sentence — *"every screen carries all eight states"* — over a 30-row table with no state column **is a claim, not a specification**, and it is unfalsifiable: no screen can fail it and no reviewer can check it. **It means a builder must invent an empty state, a loading state and a permission-denied state for every screen in the product, and thirty inventions do not agree with each other.**

**The nine states:** *default · empty · loading · success · validation-error · system-error · offline · permission-denied* — and, **on POS screens only, a ninth: peripheral-down** (the card machine unreachable). **Four default contracts, one per surface**, so a row only has to state where it deviates. **These are normative:** a screen that says "POS default" has these behaviours and a builder need not invent them.

| State | POS default | Admin default | Customer PWA default | Public |
| --- | --- | --- | --- | --- |
| empty | The reason plus the next action, never a bare blank — *"No orders yet — take one"* | The reason plus the filter that would widen it | *"Nothing here yet"* plus what creates the first one | n/a — public pages are content |
| loading | **Skeleton in place, controls stay tappable.** Never a blocking spinner over the till | Skeleton; the page frame renders first | Skeleton | Server-rendered; no client loading state |
| success | **Inline and non-modal** — the queue advances, the row moves. Never a dialog that must be dismissed | Inline confirmation with what changed | Inline | n/a |
| validation-error | **On the field, in plain words, with the value preserved.** Never a code | Same | Same | Same |
| system-error | An error **code** from §6.0.1's register, the plain-words line, **and the work preserved** | Code + plain words + retry | Plain words + retry | A static error page |
| offline | §8.4: order creation queues; **everything else shows `OFFLINE_UNAVAILABLE` with the reason** | **Read-only**, with a stale-as-of timestamp — an admin figure computed offline is a wrong figure | *"You're offline"*; history renders from cache, marked stale | n/a |
| permission-denied | **The control is not rendered** — a barista never sees an admin control refuse them | Not rendered; a deep link returns the admin 403 page | Not rendered | n/a |
| peripheral-down *(POS only)* | `TERMINAL_UNREACHABLE`: *"Card machine not responding"*, with `setDeferredMode` **one tap away** | n/a | n/a | n/a |

**And the exceptions, which are the part that could not be inferred.** Every screen below states its contract; **where a state is marked n/a it says why**, because "this state cannot occur" is a design claim that must be checkable.

| Surface | Screen | Contract, and every deviation |
| --- | --- | --- |
| POS (tablet) | PIN login | POS default, **except**: *permission-denied* n/a (nothing is authorised yet) · *empty* n/a · ***offline* is the load-bearing one** — the PIN must verify against the server, so offline this screen states *"Can't reach the till system — you can't sign in"* and offers nothing else. **A cached PIN unlock is explicitly not built** |
| POS (tablet) | Opening window — mode confirm + broadcast | POS default. *empty*: no session yet → **this screen is the empty state of the whole POS** · Saturday shows *Start an event*, not a mode picker |
| POS (tablet) | Order entry — menu grid, Favo row, recents grid, search | POS default. *empty*: menu unloaded → skeleton grid, **never a blank slab** · *offline*: order creation queues; **customer search and the free-coffee entitlement are unavailable and say so** · D2–D4, D7, **D8** apply |
| POS (tablet) | Queue / work list | POS default. ⚠ ***empty* and *offline* must be distinguishable** — an empty work list during a disconnection reads as *"nothing to make"* and is the failure that loses a customer. Offline shows the last-known queue with a *not yet synced* marker (S5) |
| POS (tablet) | Active order — make → Done | POS default. *validation-error* n/a — there is no input · D5 applies |
| POS (tablet) | **Tender** | POS default, **except**: *empty* n/a · ***loading* is the primary state and it is D9's progress state**, bounded at 180 s (S2) · ***peripheral-down* is the primary non-happy path** — `TERMINAL_UNREACHABLE` with deferred mode one tap away · *system-error* distinguishes `GATEWAY_UNAVAILABLE` (safe to try again) from `PAYMENT_UNKNOWN` (never try again) **in the words on the screen, not only in the code**. *v5.2 carried two tender screens, one per phase; there is one* |
| POS (tablet) | Walk-in log | POS default (§6.5) |
| POS (tablet) | Free-coffee claim | POS default — **exceptions only.** The entitlement applies automatically on the normal path · *offline*: **unavailable and says so** (L34) |
| POS (tablet) | Order line `⋯` · comp | POS default. *permission-denied*: **the third comp in a session renders the admin-PIN prompt rather than hiding the control** — the barista must see why they are stopped. *This is the reason L48 is scoped to applicability and not to permission (§6.2.4b): **stopped is shown, meaningless is hidden.*** |
| POS (tablet) | Deferred settlement | POS default. *empty*: *"Nothing outstanding"* — **which is the good news and must read as such** |
| POS (tablet) | **Fund top-up — amount entry and confirm** [new in v7.0] | POS default, **except**: *empty* n/a — the screen opens with an amount field and nothing to be empty of · ***loading* is a live card payment** and inherits §6.8.4 whole, bounded at 180 s with D9's progress state · *peripheral-down* is `TERMINAL_UNREACHABLE`, and **there is no deferred top-up** — the screen says a gift can wait · *system-error* must separate `GATEWAY_UNAVAILABLE` (safe to try again) from `PAYMENT_UNKNOWN` (never) **in words**, as the tender screen does · *validation-error* carries the T13 ceiling refusal, **before anything reaches the machine** |
| **Fund override list** [new in v7.0] | POS default. *empty* n/a — **the chip that opens it is only rendered when at least one open fund can cover the order** (L48), so an empty list cannot be reached · *offline* unavailable with the reason, like every fund action (§8.4) |   |
| **Voucher slip count, at `closeSession`** [new in v7.0] | POS default. ***empty* is the normal opening state and is *not* zero** — an uncounted tin and a tin holding nothing are different facts and must render differently (L43) |   |
| Day summary · history | POS default. ⚠ ***empty* ≠ *unavailable***: a day with no orders shows zeroes; a day whose fee import has not run shows **UNAVAILABLE** on the fee and net lines with *"settles overnight"*. **Conflating them is the failure §13.7 warns about**, and a *provisional* margin is a third thing again (L39) |   |
| Admin | Expenses | Admin default. *empty*: *"No expenses recorded — the ministry rollup reads COGS only until one is"*, **because a silent empty here is what makes §7.2 wrong** |
| Admin | Write-downs | Admin default. **This is the comps-review surface** — §7.3.1's per-barista figures **and** §6.0.5's write-off approval queue. *empty*: *"No write-downs this period"*, **with zeroes printed, never omitted** |
| Admin | Yield | Admin default. *empty*: lots not yet recosted → **the list of `cost_source = 'estimate'` lots *is* the content, not an empty state.** This screen is L39's only exit |
| Admin | Reports | Admin default. **Also carries the Yoco-export upload**; *empty*: no export uploaded for the completed day → **the state that raises the 09:00 push** |
| Admin | Live COGS dashboard | Admin default. ⚠ ***empty* is never zeroes** — an unrecosted or un-imported input renders **UNAVAILABLE with the offending item named**, and the profit flag renders *provisional*, never green, while any lot is an estimate |
| Admin | Ministry rollup | Admin default. Same UNAVAILABLE rule; `ministry_cost` reads UNAVAILABLE until `logExpense` has a writer |
| Admin | Unpaid / deferred orders | Admin default. *empty*: *"Nothing outstanding"* |
| Admin | **Funds — balances, ledger, draw order** [new in v7.0] | Admin default. *empty*: ***"No funds — coffee given away today is not being recorded"***, because a silent empty here is the state §6.10.0 says the café is in now · **draw order and depletion estimates render `UNAVAILABLE` rather than a guess** while fewer than thirty days of draws exist |
| Admin | Menu & prices · recipe editor · inventory & low stock · purchases · hours · customers | Admin default |
| Monthly P&L sign-off · audit log · staff & PINs · rota · event profiles · `app_config` | Admin default. *permission-denied* on the audit log is **read-only for Admin and denied for everyone else** — there is no write state to specify |   |
| Customer PWA | Register · log in | Customer default. ***system-error* is the Supabase Auth outage of §9.6.1**: *"Sign-in is unavailable right now — you can still order at the counter."* |
| Customer PWA | Password reset | Customer default (§9.5, limits §9.5.3) |
| Customer PWA | **Install / notification onboarding** | Customer default. ⚠ **The highest-risk screen in the product** (R16, L29): it must **never show a subscribed state the device cannot honour**, so on iOS-without-install **the *success* state is unreachable** and the screen states the install requirement instead |
| Customer PWA | Account — set and edit The Favo | Customer default (same server action as the POS, §6.4) |
| Customer PWA | Order history | Customer default. *offline*: renders from cache, marked stale. RLS: own orders only, and **only in `ready`, `collected` or `cancelled`** (L23) |
| Public | Landing · Menu · Privacy | Public default. Governed by **Layer 1**, not the app component layer — **no app states beyond a static error page** |

### 17.5 Device strategy

| Surface | Device | Input |
| --- | --- | --- |
| POS | Tablet, landscape, **installed PWA** — *and that is now the whole story; v5.2 had this becoming a native iOS app* | Touch, wet hands, one-handed where possible |
| Customer | Phone, portrait, installed PWA (**required on iOS for push** — L29) | Touch |
| Admin | Desktop browser | Keyboard + pointer |

**POS orientation, with its reasoning.** POS is **landscape** so that the Favo row (D2, bounded at ≤ ¼ of the order panel) and the **full five-item menu grid** (D3) coexist without scrolling — **and now the order line's stepper and shot picker too** (D8, D10). In portrait the vertical budget forces one of them to give, and **D3 is the one that cannot.**

### 17.6 Layer 2 — the application component layer

**This is the layer §17.1 commissions.** It is derived entirely from Layer 1's anchors and scales. **Only the tokens below are new, and each exists because Layer 1 has no equivalent and a requirement elsewhere in this document is unbuildable without it.**

#### 17.6.1 Semantic status tokens *(new — Layer 1 has none)*

| Token | Role | Constraint |
| --- | --- | --- |
| --status-success | Profit, settled, in stock | ≥ 4.5:1 on `--bg-paper`, paired with a word or a ✓ |
| --status-error | Loss, declined, mismatch, duplicate charge | ≥ 4.5:1, paired with a word or a ✕ |
| --status-warn | **Provisional** (L39), deferred, unresolved, low stock | ≥ 4.5:1, and **visually distinct from both success and error** — a *provisional* margin that reads as either is the failure L39 exists to prevent |
| --status-unavailable | **UNAVAILABLE** — an absent input, not a doubtful one (§7.0.2) | ≥ 4.5:1, and **distinct from `--status-warn`**. *New in v6.0: v5.2 had one token doing both jobs, and §7.0.2 and §7.0.1b are two different failures with two different remedies* |
| --selected [new in v7.0] | **"This option is the one in force"** — the voucher chip when applied, the fund chip when selected, the shot picker's chosen segment, the notification target when bound | ≥ 4.5:1 in both themes. **It may resolve to the accent today; the point is that it is a separate token.** §17.1 makes Crimson Carrot *"the sole accent"* for links and labels, and four different meanings borrowing it is §17.6.1's own one-token-two-jobs defect — *a later brand change would move links and silently change what "this fund is paying" looks like* (COL-31) |
| --status-offline | Not synced, connection lost | ≥ 4.5:1 |
| --status-disabled | Action unavailable, **with a reason** | ≥ 3:1, **never the only cue** |

**Concrete values are Layer 2's to choose and are not specified here** — the requirement is the role, the contrast floor and the second cue. Every one must pass §17.3's floor in CI, and **none may be a raw hex in a screen.**

#### 17.6.2 Size tokens *(new — Layer 1 has none)*

| Token | Value | Applies to |
| --- | --- | --- |
| --target-pos | **44 px** | Every interactive element on POS, **including both stepper controls** (D8) |
| --target-admin | **40 px** | Every interactive element on admin |
| --target-customer | **44 px** | Every interactive element in the customer PWA |
| --target-gap | **8 px** | Minimum between adjacent targets, all surfaces |

**Why three numbers and not one.** D1 previously stated a single touch target for the whole product, while the grounding records **three device classes** — customer on mobile, admin on laptop, POS on iPad. **One number cannot serve a wet-handed barista at speed and a pointer on a desktop.** WCAG 2.2 AA's target-size minimum (24×24 px) is the floor beneath all three, not the target.

#### 17.6.3 Viewports *(new — D2, D3 and §15.1 were unmeasurable without these)*

| Surface | Reference viewport | Measurement rule |
| --- | --- | --- |
| POS | **1080 × 810 landscape** — the §17.6.4 reference device | D2's "≤ ¼ of the order panel" is measured here. **D3's minimum: all five menu items visible and tappable without scrolling, with the Favo row shown** — and, in v7.0, **with a quantity stepper *and* a four-segment shot picker on at least one order line** (D8, D10, §6.2.4d) |
| Admin | 1280 × 800 | Sidebar collapses below 1024 px |
| Customer | 390 × 844 | Installed PWA, portrait |

#### 17.6.4 Physical target size — specified so it survives buying a new iPad

Owner instruction, 2026-08-20: *"build to a generic slightly older iPad, and it must adapt if a newer one is bought."* **Both halves are satisfied by never specifying a device.** Targets are authored in **CSS px**; millimetres are **derived from a stated constant and never authored.**

```
mm = css_px × 25.4 / device_logical_ppi
     device_logical_ppi = 132   -- every standard iPad: 9.7" 10.2" 10.5" 10.9" 11" 12.9"
                        = 163   -- iPad mini ONLY
```

| Token | CSS px | mm at 132 ppi |
| --- | --- | --- |
| --target-pos | **44** | **8.46 mm** |
| --target-admin | 40 | 7.69 mm |
| --target-customer | 44 | 8.46 mm |
| --target-gap | 8 | 1.54 mm |

> **Why device-independent rather than device-pinned**
>
> **Reference device: iPad 9th generation (10.2″)**, 1080 × 810 logical landscape — chosen as the *reference*, not as a requirement. Still receiving iPadOS updates, cheap new and cheaper refurbished. **The px figures are already correct on any standard iPad, so buying a newer one changes nothing and requires no edit to this document.** The only device that re-derives the millimetres is the **iPad mini** (163 ppi), where 44 px = 6.85 mm — **below the 8.46 mm floor** — so *if a mini is ever proposed as the POS device the px tokens must be raised before it is adopted.* **That is the one hardware decision §17 constrains.**
>
> **Why 44 and not a rounder number.** WCAG 2.2 AA's target-size minimum is 24 × 24 CSS px, so 44 clears it comfortably; 44 pt is also **Apple's own Human Interface Guidelines minimum.** Two independent authorities, which is why it is the right number rather than a guess.

## Appendix A — Glossary

|   |   |
| --- | --- |
| FAVO staff | Baristas and the admin/owner — the people who run the café. PIN auth, `staff` table. ~3–5 people. **Never called just "staff"** (§1.1) |
| FAVO staff | Baristas and the admin/owner — the people who run the café. PIN auth, `staff` table. ~3–5 people. **Never called just "staff"** (§1.1) |
| Office staff | HOFMI office employees. Customers with `status='office_staff'`. ~63 people. Get the free weekday coffee. **Not FAVO staff** |
| Office staff | HOFMI office employees. Customers with `status='office_staff'`. ~63 people. Get the free weekday coffee. **Not FAVO staff** |
| Church member | Congregation. Customers with `status='church_member'` |
| Church member | Congregation. Customers with `status='church_member'` |
| The Favo | A customer's saved usual — a menu item plus modifications, editable by them, one tap at the POS. Formerly "regular order" |
| The Favo | A customer's saved usual — a menu item plus modifications, editable by them, one tap at the POS. Formerly "regular order" |
| Notification target | Who to tell when an order is ready. Bound at ring-up: a registered customer, or explicit none (L28) |
| Notification target | Who to tell when an order is ready. Bound at ring-up: a registered customer, or explicit none (L28) |
| Walk-in | A weekday non-staff visitor. Not charged, not counted against the staff entitlement, logged for consumption reporting. **No identity captured** |
| Walk-in | A weekday non-staff visitor. Not charged, not counted against the staff entitlement, logged for consumption reporting. **No identity captured** |
| Mode | Weekday, Sunday or Event. Defaulted from **the session's own window** against the date, confirmed by the barista in the opening-window step (L18) |
| Mode | Weekday, Sunday or Event. Defaulted from **the session's own window** against the date, confirmed by the barista in the opening-window step (L18) |
| Event profile / event window | The reusable template, and a concrete occurrence of it. The window snapshots the profile's **six** switches so history does not change when the template is edited |
| Event profile / event window | The reusable template, and a concrete occurrence of it. The window snapshots the profile's **six** switches so history does not change when the template is edited |
| Payment posture | An event's payment behaviour: `free`, `standard`, or `override` (event prices). **Independent of cup/lid consumption** |
| Payment posture | An event's payment behaviour: `free`, `standard`, or `override` (event prices). **Independent of cup/lid consumption** |
| Opening window | The window for *dropping cups off* — **not** the time by which drinks are finished |
| Opening window | The window for *dropping cups off* — **not** the time by which drinks are finished |
| **Web POS** | **Yoco's browser- and server-driven card-present API** (§6.8). Four calls: create a device, look it up, send it an amount, fetch the payment's status. **The route FAVO takes card payments on, and the reason there is no native app** |
| **Web POS** | **Yoco's browser- and server-driven card-present API** (§6.8). Four calls: create a device, look it up, send it an amount, fetch the payment's status. **The route FAVO takes card payments on, and the reason there is no native app** |
| **Web POS device** | FAVO's registered handle for the physical card machine — one row on Yoco's side, one id in `app_config`, and the thing a payment is sent *to*. **Linking a terminal to it is the one step Yoco does not document** (FACT-1) |
| **Web POS device** | FAVO's registered handle for the physical card machine — one row on Yoco's side, one id in `app_config`, and the thing a payment is sent *to*. **Linking a terminal to it is the one step Yoco does not document** (FACT-1) |
| `client_reference` | FAVO's own reference for one tender *attempt* — `client_uuid:attempt` — sent to Yoco, echoed back, and **the key a payment is recovered by when a send timed out and FAVO holds no Yoco id** (P3) |
| `client_reference` | FAVO's own reference for one tender *attempt* — `client_uuid:attempt` — sent to Yoco, echoed back, and **the key a payment is recovered by when a send timed out and FAVO holds no Yoco id** (P3) |
| Deferred order | An order created while the card machine could not be reached, with `payment_mode='yoco_deferred'` — made and handed over, **settled or written off before the day's close** (§6.7) |
| Deferred order | An order created while the card machine could not be reached, with `payment_mode='yoco_deferred'` — made and handed over, **settled or written off before the day's close** (§6.7) |
| Settlement reference | The standalone card machine's transaction reference, captured when a deferred order is paid outside FAVO. **What makes the outage fallback reconcilable** |
| Settlement reference | The standalone card machine's transaction reference, captured when a deferred order is paid outside FAVO. **What makes the outage fallback reconcilable** |
| Unresolved payment | A payment whose outcome FAVO could not establish. **The drink is made; the money is resolved by a lookup, never by sending again** (S4) |
| Unresolved payment | A payment whose outcome FAVO could not establish. **The drink is made; the money is resolved by a lookup, never by sending again** (S4) |
| Extra-shot surcharge | **R10 per shot beyond the second**, on Sundays and on events whose switch is set; free on weekdays, where T15 caps the line at two shots. The coffee deduction is `shots` × the recipe's coffee (L31, L38, T09, DEC-16). *One and two shots are both the listed price* |
| Extra-shot surcharge | **R10 per shot beyond the second**, on Sundays and on events whose switch is set; free on weekdays, where T15 caps the line at two shots. The coffee deduction is `shots` × the recipe's coffee (L31, L38, T09, DEC-16). *One and two shots are both the listed price* |
| **Untracked Church** | HOFMI's Sunday evening service, the one people are brought to for the first time. **A recurring event profile** carrying the sixth switch — which voucher kinds are live (§6.11.2). *"Untracked" is the name of the service, not a description of the voucher mechanism* |
| **Untracked Church** | HOFMI's Sunday evening service, the one people are brought to for the first time. **A recurring event profile** carrying the sixth switch — which voucher kinds are live (§6.11.2). *"Untracked" is the name of the service, not a description of the voucher mechanism* |
| **Untracked hot drink voucher** | A paper slip entitling the bearer to **one free drink — any item on the menu**, unlike L03's coffee-only free cup. No serial, no code, no per-person limit. **Surrendered at redemption and counted at the close, which is the control** (§6.9, L43). The POS chip says just `voucher`; the schema says `untracked_hot_drink` |
| **Untracked hot drink voucher** | A paper slip entitling the bearer to **one free drink — any item on the menu**, unlike L03's coffee-only free cup. No serial, no code, no per-person limit. **Surrendered at redemption and counted at the close, which is the control** (§6.9, L43). The POS chip says just `voucher`; the schema says `untracked_hot_drink` |
| **Blessing fund** | A named, **non-refundable** balance that pays for *other people's* coffee. Created at the counter against a confirmed card payment, or by an Admin against a cash or EFT gift. `donor_funds` in the schema; **never "wallet"** (§6.10, §8.2) |
| **Blessing fund** | A named, **non-refundable** balance that pays for *other people's* coffee. Created at the counter against a confirmed card payment, or by an Admin against a cash or EFT gift. `donor_funds` in the schema; **never "wallet"** (§6.10, §8.2) |
| **Open fund** | A fund with **no linked names.** The barista chooses who it blesses; FAVO chooses which fund — **oldest unspent gift first** (§6.10.6) |
| **Open fund** | A fund with **no linked names.** The barista chooses who it blesses; FAVO chooses which fund — **oldest unspent gift first** (§6.10.6) |
| **Linked name** | A customer attached to a fund, who may draw from it and **for whom it applies automatically**, declinable in one tap. **At most one active fund per person** (L46). *The linked names are what make a fund the answer to the group tab* |
| **Linked name** | A customer attached to a fund, who may draw from it and **for whom it applies automatically**, declinable in one tap. **At most one active fund per person** (L46). *The linked names are what make a fund the answer to the group tab* |
| **Fund code** | Four characters identifying a fund — `FVO-7K2M`, from a 31-symbol alphabet with no `0/O` or `1/I/L`. **A bearer handle, not a secret** (§6.10.3) |
| **Fund code** | Four characters identifying a fund — `FVO-7K2M`, from a 31-symbol alphabet with no `0/O` or `1/I/L`. **A bearer handle, not a secret** (§6.10.3) |
| **Session** | One opening of the café. **A revenue day carries as many as it needs, and at most one is open at a time** — which is what makes "the current session" a definition rather than a search (§6.11.1). Mode, deferred state, live voucher kinds and the barista on duty all belong to it |
| **Session** | One opening of the café. **A revenue day carries as many as it needs, and at most one is open at a time** — which is what makes "the current session" a definition rather than a search (§6.11.1). Mode, deferred state, live voucher kinds and the barista on duty all belong to it |
| `cost_source` | `estimate` or `invoice`, per ingredient lot. **The field the *provisional* margin label is wired to** (L39) |
| `cost_source` | `estimate` or `invoice`, per ingredient lot. **The field the *provisional* margin label is wired to** (L39) |
| Provisional vs UNAVAILABLE | **Two different failures.** *Provisional* — the input is an estimate, so the number is computable but not trustworthy (L39). *UNAVAILABLE* — the input is absent or zero, so **the number is not computed at all** and the offending item is named (§7.0.2) |
| Provisional vs UNAVAILABLE | **Two different failures.** *Provisional* — the input is an estimate, so the number is computable but not trustworthy (L39). *UNAVAILABLE* — the input is absent or zero, so **the number is not computed at all** and the offending item is named (§7.0.2) |
| Design system | **Two layers** (§17.1). Layer 1 is the FAVO **brand** system — colour, type, spacing and voice for packaging, signage and marketing web; it states *"No Figma, no codebase, no decks attached."* Layer 2 is the **application component layer** for POS, admin and the customer PWA — **it does not exist yet and §17 commissions it** |
| Design system | **Two layers** (§17.1). Layer 1 is the FAVO **brand** system — colour, type, spacing and voice for packaging, signage and marketing web; it states *"No Figma, no codebase, no decks attached."* Layer 2 is the **application component layer** for POS, admin and the customer PWA — **it does not exist yet and §17 commissions it** |
| COGS | Cost of Goods Sold. Computed live from stock movements × ingredient cost |
| COGS | Cost of Goods Sold. Computed live from stock movements × ingredient cost |
| Container model | Milk and beans tracked as physical bottles and bags (in cups), not ml and g. At most one open container per item (L17) |
| Container model | Milk and beans tracked as physical bottles and bags (in cups), not ml and g. At most one open container per item (L17) |
| PIN | 4–6 digit numeric staff login code, bcrypt-hashed at rest. **Never rate-limited on the till** (L36) |
| PIN | 4–6 digit numeric staff login code, bcrypt-hashed at rest. **Never rate-limited on the till** (L36) |
| POS | Point of Sale — the tablet at the counter, running the installed PWA. One barista takes the order, makes the drink and taps Done |
| POS | Point of Sale — the tablet at the counter, running the installed PWA. One barista takes the order, makes the drink and taps Done |
| POPIA | Protection of Personal Information Act (South Africa) |
| POPIA | Protection of Personal Information Act (South Africa) |
| PWA | Progressive Web App. Installable to a home screen; here for installability and push, **not** for offline (§8.4) |
| PWA | Progressive Web App. Installable to a home screen; here for installability and push, **not** for offline (§8.4) |
| RLS | Row-Level Security — per-row Postgres access policies, independent of the application |
| RLS | Row-Level Security — per-row Postgres access policies, independent of the application |
| SAST | South African Standard Time (UTC+2). All times in this document unless stated otherwise |
| SAST | South African Standard Time (UTC+2). All times in this document unless stated otherwise |
| SSE | Server-Sent Events — the live POS queue transport, fed by Postgres `LISTEN/NOTIFY` |
| SSE | Server-Sent Events — the live POS queue transport, fed by Postgres `LISTEN/NOTIFY` |
| VAPID | Key pair authenticating the push server to the browser push service. **A wrong subject is a silent push failure** (§13.6) |
| VAPID | Key pair authenticating the push server to the browser push service. **A wrong subject is a silent push failure** (§13.6) |
| Variance | Expected stock (recipe deductions) minus counted stock (stock takes), as a percentage. Bands T01, and T08 for lids |
| Variance | Expected stock (recipe deductions) minus counted stock (stock takes), as a percentage. Bands T01, and T08 for lids |
| Yoco | South African card gateway. PCI-DSS managed. **FAVO holds no card data — and under §6.8 that is a boundary FAVO enforces rather than a property it inherits** (L40) |
| Yoco | South African card gateway. PCI-DSS managed. **FAVO holds no card data — and under §6.8 that is a boundary FAVO enforces rather than a property it inherits** (L40) |

## Appendix B — What changed from v6.0, what changed from v5.2, and what did not

### B.0 — v6.0 → v7.0: amendment pack A, merged [new in v7.0]

> **Where the pack came from, and why it is a version rather than a patch**
>
> v6.0 was written from documentation, a Yoco export and one grounded Sunday morning. **Amendment pack A was written after a shift on the sales-coffee team**, audited twice — once against itself, once against v6.0's locked rules, invariants, matrices, screen contracts and adopted review criteria — and adopted in full on 14 September 2026. **It changes a price, a schema column read by every coffee sale, the number of sessions a day may hold, and the standing prohibition in §8.2.** None of those is a patch.

| v6.0 | v7.0 |
| --- | --- |
| **A *double* shot carries R10** (T09, DEC-08), and `order_items.shot` is an enum of `single \| double` | **One and two shots are both the listed price; R10 starts at the third** (DEC-16). `shots` is an integer picked in one tap from a segmented 1–4 control — *an enum with two values cannot hold four* — and **margin breaks out by shot count**, which is how the café learns its best seller mostly sells in its worst-margin form (§6.2.3) |
| **One session per revenue day** — `UNIQUE (session_date)`, the reopening concept dropped, a later opening time an update to the single row | **As many sessions as a day needs, at most one open at a time** (§6.11.1). v6.0's objection — *"nothing says which row carries the mode"* — is answered rather than overruled, **and the shipped constraint at `9aefc2c` is retained**, so §13.2's migration is struck rather than resequenced (COL-14) |
| **No mechanism for a free drink outside L03 and L33**, so the Sunday evening service's paper vouchers took ~10 taps each on the Yoco machine | **§6.9's Untracked hot drink voucher: one tap, one unit, and the surrendered slip counted at the close is the control.** Deliberately *not* on L33's comp path — twenty vouchers a Sunday through a cap that exists to make free drinks visible turns the cap into noise (L41–L43) |
| **§8.2 banned every stored balance** as a standing prohibition | **§8.2 is narrowed, not deleted** (DEC-14). What stays banned is a customer-held, self-service, refundable balance. **§6.10's blessing fund is none of those** — and it passes the §03 test the wallet failed, because it serves both priorities rather than neither (L44–L47) |
| Generous members hand over cash and the coffee is given away **with nothing recorded**; a group with one payer has no shape in the system at all | Both are one mechanism: **a fund, with names linked to it or none** (§6.10.2). **The group tab is refused** because it needs a payment pointing at more than one order (§8.11) — *a polymorphic subject is cheap; a multi-subject payment is not* |
| **Five event switches**, and whether vouchers are live derived from the day of the week — which nothing did, because vouchers did not exist | **Six.** Untracked Church is a Path A recurring profile carrying the sixth: *which voucher kinds are live* (§6.11.2). **Genuinely independent of the other five**, so deriving it would have been the inheritance model §4.3 discarded, arriving one switch later |
| **Seven defects nobody had found** — three in the discount arithmetic, one in the order line, one in the search the whole push feature rests on, one in the bean deduction, one in `net_settled` | **All seven fixed** (§00). *Six were live in v6.0 and reachable with none of the new work built*, which is why they are in §13.1 with the payment work rather than behind the features that surfaced them |
| **Thirty-one collisions** between the pack and v6.0's locked rules, matrices, delivery plan, traces and design register — *hard contradictions, undischarged obligations, and two that read as conflicts and are not* | **Every one resolved in the body of this document**, and each carries its COL number where the resolution lives — so a reviewer who disagrees can check the reasoning rather than re-derive it. *The failure mode Appendix B exists to prevent is a pack that contradicts the document it amends **without saying so*** |

### B.1 — v5.2 → v6.0

> **Why the archaeology lives here**
>
> v5.2 carried its own corrections inline — hundreds of italic notes reading *"v5.2 said X"* — because it was a review artefact and its charter froze the record of its own mistakes. **That was right for a review document and wrong for a final one.** A builder reading v5.2 had to read the base statement, then every correction to it, then check whether the correction propagated. **The body of v6.0 states only what is true. The corrections are here.**

### The decision that changed the shape of the build

| v5.2 | v6.0 |
| --- | --- |
| Card tender in **two phases**: Phase 0 rings every Sunday sale twice on two devices while the PWA holds the order record; Phase 1 wraps the POS in a native iOS app driving Yoco's in-person Payment SDK | **One route: Yoco's Web POS API, server-to-server.** Phase 0 is deleted, Phase 1 never happens, and the tap count is 3–4 from the first day (§6.8) |
| Sunday sale ≈**7–9 taps** against ~3–4 today, and §05 recorded it as *"a regression on the busiest flow in the café"* and *"the largest cost this document imposes on a barista"* | **4 taps**, with the tender costing none. §03's contradiction with Priority 1 is gone |
| Phase 1 blocked on an SDK integration key with a Yoco-controlled approval clock, an Apple Developer organisation enrolment, and a signing certificate | **A self-service API key.** The SDK application is submitted as insurance and thrown away if the R1.00 test passes |
| A POS hotfix is a **1–2 day App Review**, which is why the rollback had to be a per-device config flag | **A POS fix is a deploy.** The `tender_mode` flag and its seven-row specification are deleted |
| A live payment credential on the counter tablet, needing a mint endpoint, a Secure-Enclave keypair, a `pos_devices` enrolment table, a nonce signature, a 7-day authoritative cache and a rotation procedure | **No credential on any device.** The secret stays in the vault and only FAVO's server calls Yoco (§9.10.2). `pos_devices` is not created, taking the table count from 34 to 33 |
| Reconciliation at **day grain** throughout Phase 0, because FAVO and Yoco's own app shared one merchant account | **Transaction grain from the first Sunday.** The `receipt_suffix` match ladder is deleted |
| **L01 not enforceable in software** in the phase actually in force — a barista attested that an amount matched | **L01 enforceable on every route.** `confirmExternalTender` is deleted, and with it the only path where a human assertion created revenue |
| Recovery through an iOS SDK lookup whose callback **carried no result code** and returned null for *"not found **or** lookup failed"*, indistinguishably — forcing a four-condition test to authorise a second charge | **A server-side fetch of the payment's own status resource.** An error is an HTTP error, not an ambiguous null. OPEN-10 is narrowed and no longer load-bearing |
| The unconfirmed-payment job **could not call Yoco at all**, because the lookup was an iOS SDK method and a server timer cannot invoke one — so recovery depended on a barista having the app open | **Job 4 performs the lookup itself** (§9.6.2). Recovery no longer depends on anyone standing at the till |
| PCI scope closed **structurally**: FAVO could not leak what it never received | ⚠ **Weaker, and recorded as a cost of the decision.** The Web POS payment resource is reported to carry a masked PAN, so the boundary becomes a rule FAVO enforces at a named adapter (L40, §9.10.2) |
| "Native mobile apps" listed as a standing non-goal *while §6.8.2 and §9.10 commissioned one* | **The non-goal holds without exception** (§8.9) |

### The ten other decisions v5.2 left open

| Item | v5.2's state | v6.0 |
| --- | --- | --- |
| OPEN-01 | Undecided, with a **300 ms** placeholder that had to survive a measurement against ~160 ms per DB round trip | **A principle plus four figures** (§05.1, L35). The placeholder is retired and the residency revisit trigger is now the commit figure |
| OPEN-02 | Marked open, with §9.6.2 already the register of record | **Recorded closed** in §16.1, where the arithmetic reads it |
| OPEN-03 | *"Rate limiting … currently absent entirely"*, with a default nobody had chosen | **Decided** (§9.5.3, L36), **and it exposed a contradiction:** §9.5.1's 5-minute idle lock *is* an auto-sign-out. Reconciled — no idle lock during an opening window, and the trade-off named |
| OPEN-04 | Thresholds and on-call actions unspecified | **Decided** (§9.6.3), **plus a genuinely new alert**: the card machine unreachable, routed to the barista's own device — a failure mode the web route creates |
| OPEN-05 | One criterion: a weekday shift solo | **Two criteria** (§05.3). *A bar that never tests Sunday does not test the thing most likely to break* |
| OPEN-06 | Open-narrowed to a data reconciliation, with `cost_estimated` commissioned and never built | **Closed with a condition:** `cost_source` as an enum, and L39 as a locked rule. The bean cost and the three zero-cost milks become gate-zero items; the powder scale stays a stated dispute |
| OPEN-11 | Three hardware and pairing facts, machine model unverified | **The machine is a Khumo Print**, identified on sight — no Yoco Go, no hardware purchase, no phone-pairing workaround. The pairing questions **dissolve with the SDK route**; the residue is FACT-2, and §9.10.1's device lookup settles it from Yoco's own record |
| OPEN-13 | Open, with a default of **repeat-taps-increment** | **Overridden: a stepper** (§6.2.2, L37, D8) |
| D.5 | *"The one question that is still open"* — how many taps a double shot costs on Yoco today | **Closed at 4 taps** (§6.2.3, L38). The tap count on Yoco is still worth two minutes but **blocks nothing** |
| OPEN-08 | *"Not a blocker"*, with an assumed under-R500/month | **Still open — and promoted to a gate-zero condition** (§16.2, §13.0, R21). Four questions with Matt, the fourth being the gate |

### Gaps in v5.2 that v6.0 closes on its own account

| # | Closed | The defect |
| --- | --- | --- |
| 1 | **§9.5.1 vs OPEN-03** — the idle lock | A 5-minute idle lock and a decision that the till is "never auto-signed-out during trading hours" cannot both hold. **Reconciled in §9.5.1**, with the residual risk named against R14 |
| 2 | **§8.9 vs §8.8** — native apps | Two normative passages in one document, both in force, one commissioning a native iOS POS and one forbidding it. **Resolved by the OPEN-12 decision**, and both cash and native apps are promoted out of the bare comma-separated non-goal list that let them be contradicted |
| 3 | **§08's subsection order** | v5.2 ran 8.1–8.7, then 8.10, then 8.9, then 8.8. **Renumbered** — small, but it is the kind of disorder that makes a reader wonder what else moved |
| 4 | **§16.1's stale "four switches"** | DEC-08 added the fifth switch on the same day, and every unfrozen section said five. **The review's charter would not let it edit a dated decision's reasoning, so it recorded the row as a residual.** Corrected here — that is one of the things a final version is for |
| 5 | **§16.1's duplicate Saturday rows** | Two rows saying the same thing. **Merged** |
| 6 | **C-1 — a money fixture must exercise the rules it certifies** | Every discretionary term in §7.0.2 is **zero** in the only fixture, *and §15.1 asserts that fixture*, so a formula wrong in `written_off_zar`, `comps_zar`, `tip_zar`, `entitlement_cups` or `walk_in_cups` passes every check. **Adopted as FIXTURE-B** (§15.1) |
| 7 | **C-2 — every identifier must resolve to a declaration** | `cost_estimated`, `set_by_staff_id`, `completed_at`, `qty`-vs-`quantity`, `surcharge_zar`, `price_delta`, `receipt_suffix`, `pending_charges` — **each survived a review that met every listed check.** Adopted as a mechanical pass (§15.3) |
| 8 | **C-3 — physical impossibility outranks the PRD** | v5.2 instructed a join on `receipt_no` that **no grounded artefact could satisfy**, and the stated precedence made that instruction outrank the export proving it could not run. **Adopted** (§15.3), and §6.8.2's R1.00 gate is it applied to the payment chapter |
| 9 | **One status token doing two jobs** | `--status-warn` covered both *provisional* (an estimated input) and *UNAVAILABLE* (an absent one) — **two different failures with two different remedies rendering identically.** §17.6.1 adds `--status-unavailable` |
| 10 | **The `webhook` actor kind** | `audit_log.actor_kind` carried a `webhook` value in a document that states FAVO subscribes to no webhook — **an enum value nothing could ever write.** Dropped |
| 11 | **`retry-deferred-payments.ts`** | A retained file that sets `status='successful'` from a cron, accrues loyalty §8.1 removes, and writes `sync_conflicts` §10.1 drops — **one file violating three rules.** §13.4 deletes it and names its legitimate successor |
| 12 | **The error paths** | v5.2's failure specification was a mapping of iOS SDK enum cases, correct after four rounds of Android-vs-iOS corrections. **§6.8.4 respecifies ten paths against what the Web POS API actually reports**, including the distinction v5.2 had no way to draw: **a send that errored with no id (safe to retry) versus a send that timed out (never)** |

### What v6.0 deliberately did not change

> **Stronger than the bar being applied — leave alone**
>
> **§1.1's** three-population vocabulary, which surfaced bug R15 · **§08's** standing prohibitions · **§7.0's** arithmetic, its rounding rule and its worked Sunday, *which verify to the cent independently five times across two review runs* · **§9's** hosting chapter, which came through both runs without a correction · **§8.4's and §9.3's** records of their own corrected mistakes · **§13's** ordering rationale · and **§16.1's** dated decisions with their overturned reasoning. **Documents that record why they changed their mind prevent those arguments from being re-run** — which is exactly why §6.8.0 records the premise that fell rather than quietly replacing it.

## Appendix C — The normative requirements register

> **This register is normative and it is the layer to build from**
>
> A rule stated in prose can be *read*; it cannot be **assigned, estimated, tested or signed off**, and three of those four are what a build needs. Each row states what must be true, in one testable sentence, with the section that owns the full reasoning.
>
> **Where a row and its source section disagree, the source section wins and the disagreement is a defect to be reported** — this register is a *restatement*, never a second decision. Its second purpose is the one a held-out reviewer named as the single thing that would most slow a builder: *"to know what to build for any behaviour, I must read the base statement, then every correction to it, then check whether the correction propagated."* **Here, only what is true survives; the archaeology stays in Appendix B.**
>
> **Priority** is §03's: **P1** = ease · **P2** = cost. **A P1 requirement blocks go-live; a P2 requirement blocks the Priority-2 sign-off, not the till.** *Given* is the state before, *When* is the single act, *Then* is what must be observably true afterwards. **A *Then* that names no observable is not a requirement and does not belong here.**

### C.1 — Priority 1 · the till, the sequences and the money path

| ID | Source | Given / When / Then |
| --- | --- | --- |
| REQ-001 | S1 | **Given** any server action · **When** it fails · **Then** the response is `{ok:false, code, message}` where `code` is one of §6.0.1's enumerated codes, and **no other string is ever returned** |
| REQ-002 | S2 | **Given** a server action · **When** it exceeds **10 s** (5 s ×2 for a payment status fetch) · **Then** it returns the appropriate code and **the caller's work is preserved** |
| REQ-003 | S2, L35 | **Given** a payment at the machine · **When** **180 s** elapse from the send · **Then** FAVO stops waiting, writes `unresolved`, and **does not attempt to cancel the payment** — there is no documented cancel, and pretending to have one would be the most dangerous line in the chapter |
| REQ-004 | S3 | **Given** an order in `ordered` · **When** the card is declined · **Then** the order **stays** in `ordered` with its queue position and bound target intact, re-attemptable — **nothing is re-rung** |
| REQ-005 | S2a | **Given** a session not in deferred mode · **When** `setDeferredMode(on)` succeeds · **Then** an Admin push fires **within one minute**, and again **every 30 minutes** the session stays deferred |
| REQ-006 | §6.0.4 | **Given** `deferred_entered_by='health_check'` · **When** a barista attempts to exit deferred mode · **Then** it is refused; only an Admin or a passing check may clear it |
| REQ-007 | S3a, L01 | **Given** a completed revenue day with unpaid orders · **When** `closeDaily()` runs · **Then** each is written off with a reason, the count and value are reported, **this happens before the reconciliation gate**, and **no `free` order is ever swept** |
| REQ-008 | S4 | **Given** a card flow that ends without a determinate result · **When** the outcome is recorded · **Then** `status='unresolved'`, **the order enters the queue and the drink is made**, and recovery is a **server-side fetch of the payment's status** — **never a second send** |
| REQ-009 | S4 step 3 | **Given** an `unresolved` payment · **When** a second send is proposed · **Then** it is refused unless **all three** hold: the status resource read `failed` (not an error, not `pending`) · **two** fetches ≥ **60 s** apart both read `failed` · ≥ **120 s** since the send. **A fetch error never authorises a send** |
| REQ-010 | §6.8.4 | **Given** a send that returned an error **with no payment id** · **When** it is handled · **Then** it returns `GATEWAY_UNAVAILABLE` and a retry is offered — **and a send that *timed out* returns `PAYMENT_UNKNOWN` instead and is never retried.** These two must never be conflated in code or in copy |
| REQ-011 | S4, §10.6 | **Given** an order · **When** a second successful payment is discovered or attempted · **Then** the DB unique partial index refuses the row, the order is flagged `duplicate_charge` to T10 **immediately, not at the close**, and the Admin is pushed with both Yoco ids and the amount |
| REQ-012 | S4a | **Given** a payment entering `unresolved` · **When** the status is written · **Then** an Admin push fires **immediately** naming `daily_seq`, amount, barista and session — **not at 00:05** — and **two in one session escalate** |
| REQ-013 | S5 | **Given** the POS is offline · **When** the queue renders · **Then** it shows the last-known orders, marks offline-created ones *not yet synced*, and **disables `in_progress`/Done with a visible reason** |
| REQ-014 | S6 | **Given** an SSE client that dropped · **When** it reconnects with `Last-Event-ID` · **Then** it receives every event after that id, in order, before any new one |
| REQ-015 | S7 | **Given** an order at `ready` with `completed_at` set · **When** 20 minutes elapse · **Then** the sweep sets `collected`. **No barista tap sets it, and no metric reads it** |
| REQ-016 | S7a | **Given** an order that is both weekday-free and deferred-eligible · **When** `createOrder` runs · **Then** `payment_mode='free'` and **no tender is begun** |
| REQ-017 | S7b, P3 | **Given** any order · **When** it is created · **Then** `client_uuid` is non-null and **UNIQUE**, minted at ring-up, and **it is the root of every tender reference** |
| REQ-018 | S7c | **Given** an order whose every line is comped to R0 · **When** it is completed · **Then** `payment_mode='free'` and no payment record is required by L01 |
| REQ-019 | S7d | **Given** a Yoco transaction whose items are all non-menu SKUs · **When** T10 runs · **Then** it is reported as a **named informational line, never a mismatch** — otherwise a bag of beans fires a false positive every week on the same channel as a real stock error |
| REQ-020 | S8 | **Given** no open container and none openable · **When** the order is placed · **Then** `STOCK_EXHAUSTED` is returned **before any tender begins**, and nothing is charged |
| REQ-021 | S8a | **Given** an order · **When** `transitionOrder('in_progress')` succeeds · **Then** stock deducts **there and only there** — not at `createOrder`, not at `ready`, not twice |
| REQ-022 | S8b | **Given** a paid order · **When** the `in_progress` deduction fails · **Then** `STOCK_EXHAUSTED_AT_MAKE` is returned with the resolution path, **the money is not reversed** (L02), and **the Admin is pushed immediately** |
| REQ-023 | S9 | **Given** an order in any state · **When** a backwards or repeated transition is attempted · **Then** it is rejected with `STALE_STATE` and the audit records the rejection |
| REQ-024 | T1, L03 | **Given** weekday mode and a matched `office_staff` customer with no entitlement today · **When** an eligible item is selected · **Then** the entitlement applies **without a tap**, discounting **one unit** — and the barista taps only to **decline** it |
| REQ-025 | L03, §05 | **Given** a customer with an entitlement row today · **When** a second is attempted · **Then** `ENTITLEMENT_USED` is returned, **the order continues as paid**, and **the refusal is audited with `action='reject'`** |
| REQ-026 | T2, P1 | **Given** a Sunday sale · **When** tender begins · **Then** `orders` → `order_items` → `payments` (`pending`, carrying `client_reference`) are **all written before anything is sent to the machine.** Never the reverse order |
| REQ-027 | P3, §11.2 | **Given** attempt *n* on an order · **When** `beginTender` runs · **Then** `client_reference = client_uuid:n`, **NOT NULL and UNIQUE**, written **before** the send — and **never reused on a retry** |
| REQ-028 | P4, §11.2 | **Given** an open tender attempt · **When** anything attempts to change the order's total — a comp, a free cup, a new line, a quantity step, a cancel · **Then** it is refused with `TENDER_IN_PROGRESS` |
| REQ-029 | §11.2 | **Given** a send that returns a payment id · **When** it returns · **Then** `yoco_payment_id` and `sent_at` are persisted **immediately, before any outcome is known**, and a second send for the same `(orderId, attempt)` is a `VALIDATION` failure |
| REQ-030 | §6.8.4, §11.2 | **Given** a completed payment · **When** the result is recorded · **Then** `charged_amount_zar == orders.total_zar` is asserted; a mismatch is **recorded at the charged amount** and flagged to T10, **never overwritten** |
| REQ-031 | §6.8.4, L40 | **Given** a Yoco payment response containing a masked PAN · **When** the payment adapter parses it · **Then** **no copy of that field exists in any column, log, error report or client response**, and the adapter returns only the fields §10.3.3 declares |
| REQ-032 | §6.8.3, T10 | **Given** a completed revenue day · **When** T10 runs · **Then** it checks payments FAVO holds that Yoco does not **and** payments Yoco holds that FAVO does not, **at transaction grain** |
| REQ-033 | §6.8.3 | **Given** an import row matching zero or more than one FAVO payment · **When** the import runs · **Then** it is **left unmatched and listed on T10, never guessed at**, and the daily unmatched rate is reported |
| REQ-034 | T4 | **Given** a write-off with reason `unresolved_at_close` · **When** the next reconciliation runs · **Then** it stays an **open T10 item** until Yoco's record confirms no payment or produces one — in which case **the write-off is reversed and the payment attached** |
| REQ-035 | T4, §6.0.5 | **Given** a day's write-offs · **When** the close completes · **Then** each carries `actor_staff_id` set to the barista who took the order and a reason, an **Admin approval queue item** exists, and **they report as `unapproved` until an Admin clears it with a PIN** |
| REQ-036 | T4, L09 | **Given** a reconciliation mismatch · **When** `closeDaily()` runs · **Then** **only the close record** is blocked, an in-app alert **and** a push fire, and **ordering is unaffected** |
| REQ-037 | T5, §8.4 | **Given** the POS is offline · **When** a barista acts · **Then** order creation is accepted into the outbox and **everything else** — tender, entitlement claim, stock movement, broadcast — returns `OFFLINE_UNAVAILABLE` with the reason |
| REQ-038 | T5, §12.3 | **Given** an outbox order carrying `client_uuid` · **When** it replays, however many times · **Then** the UNIQUE constraint makes the second application a no-op — **no duplicate order, no duplicate stock movement** |
| REQ-039 | T5 | **Given** an outbox order more than **12 hours** old · **When** it replays · **Then** it is rejected, surfaced on the admin exception list, and **never silently accepted**; and a replay takes **the server's receipt time as its revenue day**, never the client's |
| REQ-040 | T6, DEC-10 | **Given** an order at `in_progress` or later · **When** it is cancelled · **Then** an admin PIN is required, compensating `stock_movement` rows are written (originals never edited), and **`on_behalf_of_staff_id` names the overriding admin** |
| REQ-041 | T6 step 2b | **Given** a customer who leaves mid-make · **When** the barista abandons the order · **Then** a `waste_log` row with `category='abandoned'` and `order_id` is written, **the queue slot is released**, and **L02 keeps the money** |
| REQ-042 | T7 | **Given** an open event window · **When** `ends_at` passes · **Then** mode, menu scope, payment posture, cup consumption, audience and the surcharge **all** revert — **with no job involved** — and no event leaks into the next day |
| REQ-043 | §6.6, L27 | **Given** `openEventWindow` · **When** it is called · **Then** `ends_at` is **required** and a window longer than **24 h** is rejected |
| REQ-044 | §6.6, §10.2 | **Given** an event window opened from a profile · **When** the profile is later edited · **Then** the window's six switches and price overrides are **unchanged — history does not move** |
| REQ-045 | §6.6, §05 | **Given** `payment_posture='free'` · **When** orders are placed · **Then** **zero payments are sent to the machine**, no card prompt appears, and `payment_mode='free'` |
| REQ-046 | §6.1, L28, §10.6 | **Given** any order · **When** it is created · **Then** `notification_target` is `customer` **or** explicit `none`, never null, and the CHECK tying it to `customer_id` holds |
| REQ-047 | §05, §6.1 | **Given** an order with target `customer` · **When** the barista taps **Done** · **Then** `completed_at` is set and the push is delivered **≤ 10 s**, measured on a real device through the edge |
| REQ-048 | L29, R16 | **Given** an iPhone that has not installed the PWA · **When** the notification screen renders · **Then** it states the install requirement and **the subscribed state is unreachable** |
| REQ-049 | §8.5, L23 | **Given** no session, **or** a customer session and an order still in flight · **When** any order, queue or stream surface is requested · **Then** the state is not returned — **zero routes expose order state to an unauthenticated caller, and a customer's own history exposes no in-flight state** |
| REQ-050 | §05, §6.2 | **Given** the recents grid · **When** a known office-staff customer orders a single-shot drink · **Then** it is placed in **≤ 3 taps including the free cup**, with **no typing** — and **≤ 4** where the drink is a double |
| REQ-051 | §05, §6.8 | **Given** a Sunday sale to an unregistered customer at quantity 1 · **When** it is rung up · **Then** it is placed and tendered in **≤ 4 taps** with no amount to read, key or confirm — **and this figure is re-timed against §6.8.2's gate measurement rather than defended** |
| REQ-052 | §6.2.1 | **Given** the weekday recents grid · **When** it renders · **Then** office staff **without** today's entitlement appear first — by L03 the already-served are precisely who cannot claim again — and served tiles appear below, visibly marked, never in a primary slot |
| REQ-053 | §6.2.2, L37, D8 | **Given** a drink already on the order · **When** the barista taps that menu item again · **Then** **the quantity does not change**; the line *whose configuration matches the current selection* flashes and its stepper is drawn to the eye. Quantity changes **only** on the stepper, and stepping to zero removes the line |
| REQ-054 | §6.2.3, L38 | **Given** a line at *n* shots · **When** stock deducts · **Then** ***n* × the base recipe's coffee** and **exactly one** of everything else is deducted, via a recipe-level multiplier keyed on `shots` — **and `Extra Shot` does not exist in `menu_customisations`** |
| REQ-055 | §6.4, D2, D3 | **Given** the POS order panel at §17.6.3's viewport · **When** the Favo row renders · **Then** the menu grid stays visible and tappable, all five items without scrolling, and the Favo row occupies **no more than a quarter** of the panel |
| REQ-056 | §6.3, L22 | **Given** a session with a confirmed mode · **When** `broadcastOpeningWindow` runs · **Then** the audience is **derived** — office staff on weekdays, office staff + church members on Sundays, the profile's audience on events — and **no hand-picked list is possible** |
| REQ-057 | §4.2, DEC-04 | **Given** a Saturday · **When** the opening window is used · **Then** it offers *Start an event*, **not a mode picker**, and **no session opens without an event window in force** |
| REQ-058 | §6.5 | **Given** a walk-in sale · **When** `logWalkIn` runs · **Then** a row records the item and **quantity** with **no customer reference of any kind**, and it never touches `staff_entitlement_log` |
| REQ-059 | L33, §7.3.1 | **Given** a barista comping a line · **When** `compOrderLine` runs · **Then** `reason` is from the closed list, the value is **≤ `min(line_gross − discount_zar, (highest live price + (T15 − 2) × extra_shot_zar) × quantity)`**, a **third** comp in a session needs an admin PIN, and the comp appears on `/admin/write-downs` **per barista** |
| REQ-060 | L02 | **Given** any wrong or disputed charge · **When** a remedy is sought · **Then** FAVO offers an **L33 comped drink** — **there is no refund path and no void path**, and `requestRefund`/`approveRefund` do not exist |
| REQ-061 | §9.5.1, L36 | **Given** a signed-in barista · **When** **12 h** elapse, or *Hand over* is tapped, or 5 min of idleness pass **outside** an opening window · **Then** the POS returns to the PIN screen **with all work preserved.** **Inside an opening window there is no idle timeout** |
| REQ-062 | §9.5.3, L36 | **Given** repeated failed logins · **When** the limits of §9.5.3 are reached · **Then** the account or IP cools down and the breach is audited — **and the barista till session is never rate-limited, on any path, by any middleware** |
| REQ-063 | §9.5.1, T6 | **Given** an admin PIN entered for an override · **When** the action completes · **Then** **no admin session exists**, the barista's is not extended, and `on_behalf_of_staff_id` records the admin |
| REQ-064 | §10.3.2, §11.5, §05 | **Given** any mutation **or any rejected action** · **When** it completes · **Then** an `audit_log` row exists — `action='reject'` with a reason for a refusal — **a failure to audit fails the transaction**, and `/api/admin/audit-coverage` returns **0 orphans** |
| REQ-065 | §10.4, §9.10.1 | **Given** a tender · **When** `beginTender` runs · **Then** `webpos_device_id` is read **once** and written onto the payment row, and **changing the configured device mid-tender changes nothing about that payment and rewrites no report** |
| REQ-066 | §9.6.2 | **Given** any timer · **When** it runs · **Then** it **never sends a payment and never initiates a tender.** It may attach a payment Yoco confirms exists, which is a read followed by a record |
| REQ-067 | §9.6.2 | **Given** a completed revenue day · **When** **06:00** passes with no `daily_closes` row, or **09:00** with no import · **Then** an Admin push names the day and **repeats daily until resolved** |
| REQ-068 | §9.6.3 | **Given** the card machine unreachable during trading hours · **When** 2 minutes pass · **Then** **the on-duty barista's own device is alerted**, as well as the Admin, with a named action — and **one alert per incident, not one per minute** |
| REQ-069 | §9.8, §05 | **Given** the production edge · **When** a POS holds the queue stream · **Then** it survives **≥ 4 h**, verified end-to-end through Cloudflare — **a local test that bypasses the edge does not satisfy this** |
| REQ-070 | L35, §05.1 | **Given** the ordering path · **When** a barista taps anything other than the tender control · **Then** the visual response is **< 100 ms and not network-dependent**, and **no interaction other than the payment wait blocks on a network call** |
| REQ-071 | L40, §9.10.2 | **Given** a production build · **When** the client bundle is inspected · **Then** it contains **no Yoco key of any kind**, and **no client-reachable endpoint returns one** |

### C.2 — Priority 2 · the money, and refusing to look authoritative

| ID | Source | Given / When / Then |
| --- | --- | --- |
| REQ-101 | §7.0.2, §10.6 | **Given** any monetary value · **When** it is stored or computed · **Then** it is an integer number of cents — **never a float, never `numeric`** — except `inventory_lots.unit_cost_zar`, which is `numeric(10,4)` by design |
| REQ-102 | §7.0.2 | **Given** a historical order · **When** an Admin changes a menu price · **Then** that order's `line_gross` is **unchanged**, because it reads `order_items.unit_price_zar`, **never the live price** |
| REQ-103 | §7.0.2 | **Given** a line carrying a priced modification · **When** `line_gross` is computed · **Then** the modification delta is included, **per unit**, from the snapshot on the line |
| REQ-104 | §7.0.2, T09 | **Given** a line at *n* shots on a Sunday or a switched-on event · **When** it is priced · **Then** the surcharge is `extra_shot_zar × MAX(0, n − 2)`, **per unit** — **so one and two shots carry none**; on a weekday or a switched-off event it is **0** (DEC-16) |
| REQ-105 | §7.0.2 | **Given** a line with quantity *n* · **When** gross or COGS is computed · **Then** the price, the surcharge, the modifications, the cup and the lid are **each multiplied by *n*** |
| REQ-106 | §7.0.2 | **Given** any period · **When** COGS is rolled up · **Then** every figure is a sum of integers rounded **once per order**, **so no two reports can disagree by a rounding choice** |
| REQ-107 | §7.0.2 | **Given** an ingredient costing under half a cent per base unit — chocolate, chai · **When** `unit_cost` is stored · **Then** it keeps **four decimal places**; rounding here would price it at **zero** and delete it from the cost model |
| REQ-108 | §7.0.2 | **Given** any settled order in the period with `fee_zar IS NULL` · **When** a report renders · **Then** `processing_fee`, `net_settled` and `contribution` read **UNAVAILABLE, never zero** — `SUM()` skipping NULLs is the silent zero this rule exists to prevent |
| REQ-109 | §7.0.2 | **Given** an ingredient consumed in the period with `unit_cost_zar` NULL or `0.0000` · **When** a margin figure renders · **Then** it reads **UNAVAILABLE with the offending ingredient named** |
| REQ-110 | §7.0.1b, L39 | **Given** any contributing lot with `cost_source = 'estimate'` · **When** the margin or profit indicator renders · **Then** it is ***provisional***, never `--status-success`, with the warning and a link to the recosting screen — **and it is visually distinct from UNAVAILABLE** |
| REQ-111 | §7.0.2 | **Given** a day with written-off orders · **When** `contribution` is computed · **Then** it reads `collected − cogs − fees`, **so an order never paid for is not counted as profit** — and gross, written off, collected and fees are each separately visible |
| REQ-112 | §7.0.2 | **Given** a rollup period · **When** `ministry_cost` sums expenses · **Then** card processing fees are **excluded**, because `contribution` has already netted them. **A fee is never both an expense and a deduction** |
| REQ-113 | §7.0.2 | **Given** a paid event day · **When** `ministry_cost` is computed · **Then** it uses **`free_event_cogs`**, not all event COGS — a paid day's COGS is already inside its `contribution` |
| REQ-114 | §7.0.2, §11.2 | **Given** no `logExpense` writer in production · **When** `ministry_cost` renders · **Then** it reads **UNAVAILABLE** — a ministry cost with no rent, utilities or wages is worse than no figure |
| REQ-115 | §7.0.2, L03 | **Given** an entitlement applied to an order · **When** `entitlement_cups` is computed · **Then** it counts **rows**, and **no row ever discounted more than one unit's price** |
| REQ-116 | §7.0.2 | **Given** an order carrying one walk-in line and one other line · **When** `walk_in_cups` is computed · **Then** **only the walk-in line's quantity is counted** |
| REQ-117 | §7.0.3, §15.1 | **Given** the grounded Sunday **2026-08-16** · **When** FIXTURE-A runs · **Then** gross **R350.00**, fees **R9.27**, net settled **R340.73**, `cogs_zar` **R196.36**, `gross_margin` **R153.64**, `contribution` **R144.37**, 17 drinks — **every figure asserted, none illustrative** — and the flag renders *provisional* |
| **REQ-118** | §15.1 [new] | **Given** FIXTURE-B — a synthetic day carrying one comp, one write-off, one path-B settlement, one entitlement cup, one walk-in line beside a paid line, one tip and one quantity-2 line · **When** it runs · **Then** **every discretionary term in §7.0.2 is asserted individually.** Without this, a formula wrong in those terms passes every other check |
| REQ-119 | §7.0.4, §6.8.3 | **Given** a card sale · **When** `fee_zar` is written · **Then** it comes from Yoco's record for **that transaction** — **never an estimate, never a percentage, never recomputed** |
| REQ-120 | §7.0.4, T10 | **Given** a Yoco payout · **When** it is reconciled · **Then** `Σ (gross + tip − fee)` over the settled transactions equals the payout, **per device**, and a difference is an open T10 item |
| REQ-121 | §7.1 | **Given** the Admin dashboard · **When** a test order is placed · **Then** revenue, COGS, expenses, margin and the profit flag are present, **split per mode**, and COGS increments **within 5 s** |
| REQ-122 | §7.2 | **Given** a selected week or month · **When** the rollup renders · **Then** weekday cost, Sunday revenue and cost, and event columns are netted in **one view** — **no CSV, no spreadsheet** |
| REQ-123 | §7.3 | **Given** a completed week · **When** Monday **06:00** passes · **Then** the three baristas and the Admin receive a push **and** an in-app screen, split by mode, including the walk-in count and the event section |
| REQ-124 | §7.3.1, §05 | **Given** a week with comps, write-offs and abandoned orders · **When** the summary renders · **Then** **three named per-barista figures** appear, each traceable to `audit_log.actor_staff_id`, **zero printed as `0` rather than omitted**, and **at least one Admin push fired the same day** |
| REQ-125 | §7.4, T08, L24 | **Given** a weekday order · **When** stock deducts · **Then** `stock_movements` contains **no** cup or lid row; **Given** the same order in Sunday mode · **Then** it does |
| REQ-126 | §7.4 | **Given** an Americano · **When** COGS is computed · **Then** the cup is included and the lid is not — **the recipe governs, not the mode** |
| REQ-127 | §7.4, §05 | **Given** week 2 onward · **When** `v_weekly_variance` is read · **Then** variance is **< 5%**, and **the T08 lid band is honoured in the computation** |
| REQ-128 | §7.5 | **Given** any trading day · **When** the barista opens `/pos/today` · **Then** orders, drinks, gross, fee, net, write-offs, comps, entitlement cups and walk-in cups are shown — **it is a read: nothing is confirmed and no tap ends the day** |
| REQ-129 | §7.5, §7.0.2, L39 | **Given** a day whose fee import has not run · **When** the summary renders · **Then** the fee and net lines read **UNAVAILABLE with *"settles overnight"* — never R0.00**; and a day with no orders shows **zeroes**. **Three states, three renderings: empty, unavailable, provisional** |
| REQ-130 | §10.6, §7.0.1 | **Given** an Admin changing a price · **When** `setMenuItemPrice` runs · **Then** a `price_history` row carries **`set_by_staff_id`** and the previous row is closed — **and the write fails rather than proceeding anonymously** |
| REQ-131 | §7.0.1b, L39 | **Given** any lot with `cost_source = 'estimate'` · **When** any figure derived from it is displayed **or exported** · **Then** it is marked as estimated — **on the screen, in the export and in the weekly summary**, not only on the dashboard |
| REQ-132 | §7.0.1b, §13.0 | **Given** the seeded database at gate zero · **When** the seed is verified · **Then** **no ingredient consumed by a live recipe costs `0.0000`** — the three alternative milks are seeded — and **the bean cost has been reconciled and its `cost_source` recorded honestly** |
| REQ-133 | §10.3.3, §7.0.2 | **Given** a settled deferred order · **When** any §07 figure groups by payment mode · **Then** `yoco_deferred` is **split by `settled_at` and `written_off_at`**, because the mode records how the order was *taken* and not how it *ended* |
| REQ-134 | §10.6 | **Given** any report grouping by payment mode · **When** it encounters an unknown value · **Then** it **fails loudly. It never defaults** |
| REQ-135 | §11.4, §9.4 | **Given** a successful export · **When** it completes · **Then** an `audit_log` row exists — **an export is a data egress and §9.4's POPIA commitments apply to it** |

### C.3 — Shot pricing, vouchers, funds and sessions [new in v7.0]

**Continuing the series from REQ-136.** Amendment pack A numbered its rows with letter suffixes wedged beside existing ones — `REQ-132a`, `REQ-134b` — *which is ambiguous in a ticket and sorts wrongly in every tool that will hold it.* They are renumbered here as plain integers, keeping the source column so each still points at the clause that owns it (COL-18).

| ID | Source | Given / When / Then |
| --- | --- | --- |
| REQ-136 | L31, §6.2.3 | **Given** a Sunday order line at *n* shots · **When** its price is computed · **Then** `surcharge_zar = extra_shot_zar × MAX(0, n − 2)` per unit — **so one and two shots carry no surcharge and the third is the first that is charged** |
| REQ-137 | DEC-09, §10.5 | **Given** an order line at *n* shots · **When** stock deducts at `in_progress` · **Then** coffee deducts *n* × the base recipe quantity and **every other ingredient deducts exactly 1 ×** |
| REQ-138 | T15, L48 | **Given** weekday mode · **When** the shot picker renders · **Then** it shows **two segments, not four greyed ones**; in Sunday or paid-event mode it shows T15 segments; and **a direct write above the applicable ceiling is rejected** |
| REQ-139 | §6.2.3, P2 | **Given** a period of sales · **When** §7.1's dashboard and §7.3's weekly summary render · **Then** margin is broken out **by shot count** as well as by item, *so a best-seller selling in its worst-margin configuration is visible* |
| REQ-140 | DEF-F, L35 | **Given** a barista typing in the customer search · **When** a request is in flight · **Then** the menu grid stays tappable, **no render blocks on the call**, and the order may be completed before the search resolves |
| REQ-141 | DEF-F, L28 | **Given** a search returning no results · **When** it renders · **Then** it is an **empty list rather than an error**, and `no notification` is offered as an explicit adjacent choice the barista must tap |
| REQ-142 | DEF-F, §9.4 | **Given** any search response · **When** its payload is inspected · **Then** it carries **no email address and no full phone number**, and two results sharing a given name are distinguishable by surname or by four phone digits |
| REQ-143 | L41, DEF-A | **Given** an order line already carrying a discount · **When** a *different* discount mechanism is applied to it · **Then** it is **rejected**, and `discount_zar` never exceeds `quantity × unit_price_zar` **at the DB** |
| REQ-144 | T15, §6.2.3 | **Given** weekday mode · **When** a write of 3 or more shots is attempted on a weekday order · **Then** it is rejected at the application layer as well as by the picker's rendering |
| REQ-145 | §6.9.2a, §7.3.1 | **Given** a period containing voucher redemptions · **When** the write-down block renders · **Then** each barista's vouchers appear as **a count *and* a value**, *so an average value per slip is readable without computing it* |
| REQ-146 | L48, §6.2.4 | **Given** any order-entry state · **When** a control cannot apply — a voucher chip on a weekday, a fund chip on an order owing nothing, a shot picker on a coffee-free drink · **Then** it is **absent from the rendered tree, not present and disabled** |
| REQ-147 | §6.2.4c | **Given** a line at quantity *n* carrying *m* voucher redemptions where *m* < *n* · **When** the line renders · **Then** it shows *m* of *n* and its remaining price, **so a partly-vouchered line can never read as fully vouchered** |
| REQ-148 | DEF-E, L37 | **Given** an order carrying a line for a menu item · **When** the same item is selected with a *different* configuration of shots or modifications · **Then** a **new line is created**; and when selected with a matching configuration · **Then** the existing line's quantity steps up and **no second line appears** |
| REQ-149 | T9, L42 | **Given** one order whose every unit carries a voucher · **When** it is placed · **Then** its total is **R0**, **no payment row is created and nothing reaches the terminal** |
| REQ-150 | T10 | **Given** an order carrying one vouchered line and one paid line · **When** tender begins · **Then** **the amount sent to the machine is the paid line alone**, and the vouchered line is unchanged by the tender |
| REQ-151 | L41, §6.9.1 | **Given** a line at quantity *n* carrying *n* voucher redemptions · **When** an *n*+1th is attempted · **Then** it is rejected; and given fewer than *n* · **Then** it is accepted and zeroes one further unit |
| REQ-152 | L33, DEF-B | **Given** a line carrying an entitlement · **When** `compOrderLine` computes its ceiling · **Then** the ceiling reads `line_gross − discount_zar`, **not `line_gross`** |
| REQ-153 | L42, DEF-C | **Given** an order whose net charge is R0 in any mode · **When** tender is attempted · **Then** **no `payments` row is created, nothing is sent to the terminal**, and the order completes as `payment_mode='free'` |
| REQ-154 | §6.9.1 | **Given** a session with `untracked_hot_drink` active · **When** the barista taps the voucher chip on a line · **Then** **exactly one unit** of that line discounts to R0, one `voucher_redemptions` row is written, and **any remaining net still goes to the machine** |
| REQ-155 | §6.9.3, L48 | **Given** weekday mode · **When** the order-entry screen renders · **Then** **no voucher control exists on any line**, and `redeemVoucher` returns `VOUCHER_NOT_IN_MODE` if called directly |
| REQ-156 | L43 | **Given** a session closed with a slip count entered · **When** it differs from `voucher_redemptions_recorded` · **Then** the L09 admin push fires **with both figures**, and **the close completes** |
| REQ-157 | L43, §6.11.1 | **Given** a session closed with no slip count entered · **When** `closeSession` and then `closeDaily()` run · **Then** `voucher_slips_counted` is **NULL**, **neither close is blocked**, and the day's variance renders `UNAVAILABLE` rather than as zero |
| REQ-158 | §6.9.4 | **Given** a period containing voucher redemptions · **When** `contribution` and `ministry_cost` are computed · **Then** `outreach_cogs` is **excluded from the first and included in the second**, `ministry_net` is **unchanged**, and the day still prints `cogs_zar` whole with `outreach_cogs` beneath it |
| REQ-159 | T11 | **Given** a session crossing `voucher_expected_max_per_session` · **When** the next voucher is redeemed · **Then** it appears on the Admin's daily digest and **the redemption succeeds** |
| REQ-160 | L44 | **Given** any customer session · **When** any route, endpoint or action that increases a fund balance is attempted · **Then** it is **unreachable**, and a deep link to the admin route returns the admin 403 page |
| REQ-161 | L44 | **Given** `topUpDonorFund` · **When** it is called without a `funding_method` and `reference`, or for an amount carrying the fund above T13 · **Then** it returns `VALIDATION` and **writes nothing** |
| REQ-162 | L47, §10.2.1 | **Given** a fund-paid order · **When** it completes · **Then** `payments` has **no row for it**, `order_net_charged` equals the order's full price, and it appears in **neither** `order_discount` **nor** `comps_zar` |
| REQ-163 | §6.10.5 | **Given** two simultaneous draws against a fund holding one drink's worth · **When** both run · **Then** one succeeds and one returns `FUND_INSUFFICIENT`, and **the balance never goes below zero** |
| REQ-164 | L46, §6.10.2 | **Given** a fund with linked names · **When** a draw is attempted for an order bound to anyone not on the list · **Then** it returns `FUND_NOT_LINKED`; and when the order is bound to a linked name · **Then** the fund is **applied without a tap and is declinable in one** |
| REQ-165 | L46 | **Given** any customer-scoped read or push · **When** its payload is inspected · **Then** it contains **no fund balance and no fund ledger entry** — FAVO sends no donor statement and displays no fund balance to a customer |
| REQ-166 | L47, §6.7 | **Given** an order settled from a fund · **When** `closeDaily()` runs its write-off sweep · **Then** the order is **treated as settled, is not written off**, and does not appear on the admin unpaid-orders list |
| REQ-167 | §6.10.5, P4 | **Given** an order settled from a fund · **When** anything attempts to change its total — a comp, a voucher, a new line, a quantity step · **Then** it is refused with `TENDER_IN_PROGRESS`, **exactly as P4 refuses it during a card tender** |
| REQ-168 | §6.10.5 | **Given** a cancelled fund-paid order · **When** `cancelOrder` completes · **Then** a compensating `adjustment` entry restores the fund to its pre-draw balance, and **the original spend entry is never edited** |
| REQ-169 | §6.10.6, L46 | **Given** a linked person bound as an order's target · **When** the order is rung · **Then** their fund chip renders **lit** and the open-fund chip renders beside it unlit; and **a single tap on either switches the tender**, or turns the lit one off and sends the order to the card |
| REQ-170 | §6.10.6 | **Given** any number of open funds able to cover the order · **When** the footer renders · **Then** **exactly one open-fund chip appears**, naming the fund holding the **oldest unspent top-up** and the count of those behind it; a fund that cannot cover the order is **never offered**; and the footer never carries more than two tender chips |
| REQ-171 | §6.10.6 | **Given** two or more active funds · **When** `/admin/funds` renders · **Then** it lists them **in draw order** with each one's queue position and a depletion estimate from the last thirty days' draw rate |
| REQ-172 | L46, §6.10.6 | **Given** a customer already linked to an active fund · **When** they are linked to a second · **Then** the write is **refused by a partial unique index** on `donor_fund_members(customer_id)` over active funds — *not by application code alone* |
| REQ-173 | §6.10.3, L44 | **Given** a fund top-up sent to the terminal · **When** the payment is declined, times out, or is otherwise not `successful` · **Then** **the fund's balance is unchanged**, the `top_up` entry shows its payment status, and **no draw against it is permitted** |
| REQ-174 | §6.10.3, §10.6 | **Given** `payments` · **When** any row is written · **Then** **exactly one** of `order_id` and `fund_topup_id` is non-null, enforced by CHECK; **a second successful payment against one top-up is refused by a partial unique index**; and an attempt to attach a top-up to an order with an open tender is refused |
| REQ-175 | §6.10.3, T13 | **Given** a top-up amount above `donor_fund_ceiling_zar` · **When** `beginFundTender` runs · **Then** it returns `VALIDATION`, writes no payment row and **sends nothing to the terminal** — *the ceiling is checked before the machine, never after* |
| REQ-176 | §6.10.3, R22 | **Given** a fund created with no display name · **When** `createDonorFund` completes · **Then** a unique code is issued, **an immediate Admin push fires naming the barista, the amount and the code**, and **the creation succeeds** |
| REQ-177 | §6.10.4, §12.3 | **Given** a fund dormant beyond T14 · **When** the dormancy job runs · **Then** it writes **only an Admin task**, no ledger entry, and **no revenue is created until `sweepDonorFund` is called by an Admin** |

### C.4 — What this register is not

**It is not complete, and saying so is the point.** It covers the normative content of §06 and §07. It deliberately does **not** restate §08's non-goals, §09's infrastructure, §12's locked rules (which carry `L01`–`L40`), §16's decisions or §16.2's open items — each already has an identifier scheme and a home. **Where a *Then* above is weaker than its source section, the source section governs.**

**Three rows are knowingly untestable today and are marked here rather than hidden.** **REQ-047**'s 10-second push and **REQ-069**'s four-hour connection cannot be measured until the app is back online. And **REQ-010, REQ-029 and REQ-030 describe behaviour of a card machine nobody has yet sent a payment to** — §6.8.2's R1.00 gate is what turns them from reasoning into observation, and until it passes **the whole of C.1's payment block is written on documentation rather than proof.**

## Appendix D — What this document is least confident about

This appendix is the honest account. **It exists so nobody reads v6.0 as finished in the sense of being proven.** It is finished in the sense that matters — every decision is made, every gap is either closed or has an owner and a gate — but four things below would change if the world disagreed with it.

> **1 · The payment chapter has never touched the card machine**
>
> **Six of §6.8.4's ten error paths describe a failure nobody at FAVO has seen**, and the one step that binds FAVO's device record to the Khumo is **the one step Yoco does not document.** The chain is documented end to end except there, and the machine is in the supported family — **but "documented" is not "executed", and the family list is a third party's.** §6.8.2's gate costs one to two hours and R1.00, and until it passes this chapter is high confidence rather than proof. **If the device-link step fails, the SDK application is already in the queue and this is a delay rather than a reversal** (R18) — but the plan would lose weeks and the tap count would go back to 7–9 for as long as it took.

> **2 · The payment chapter is new text with no independent reader**
>
> v5.2 recorded that its own final pass **had no independent review** and that the payment sections needed one most — and that this exact pattern produced roughly sixty of two review runs' defects: a correction made in one section and not carried to the section that owns it. **v6.0 rewrites §6.8, §9.10, T2, T3, half of §10.3.3, six §11 rows, §9.6.2's job 4, four business rules and thirty requirement rows, and the same author wrote and swept all of it.** **Treat every payment row as needing one independent check**, and the highest-value single process step is still the mechanical one: *after any edit, grep every number, enum, count and rule id it touches for its other occurrences.*

> **3 · §07's arithmetic is right in form and untested in substance**
>
> Its revenue half verifies to the cent, independently, **five times across two review runs.** But the review wrote the formulas, then the fixture that tests them, then the acceptance row that asserts the fixture — **and got the quantity term wrong, the rounding example wrong by a cent, the profit figure wrong on write-offs, and the fee comparison wrong by two orders of magnitude**, catching each only because an adversary recomputed it. **Treat every number in §07 as needing one independent recomputation.** And every cost input is an estimate *by decision*: the seed and Yoco disagree by up to R5.55 a drink, the bean cost by ~170%, and the powder scale is a stated dispute that no single price reconciles. **The *provisional* label of L39 is what makes shipping on those numbers safe. If the label is dropped during the build, the risk comes straight back.**

> **4 · The traces describe one Sunday morning in which nothing went wrong**
>
> All 13 grounded transactions succeeded. **T3 and T4 — the two most money-critical traces — are specified and have never been seen.** §6.8.2's gate step 6 and §13.1's staging exercise are the first time they are observed rather than reasoned about, and they are cheap. **Internally coherent is not the same as correct.**
>
> Two smaller items in the same category. **The 45-orders-in-100-minutes figure has no recorded source** and it sizes §9.9's infrastructure, T03's window and two §05 criteria — it needs provenance or re-derivation. And the **seam-walk measurement** that counts undefined hops across the eight traces has not been re-run since the middle of the second review round; **this document must not carry a stale number forward as a current one**, so it carries none.

> **5 · Amendment pack A has had no independent reader either [new in v7.0]**
>
> **No part of the work merged into v7.0 was read by anyone but its author** — and it rewrites the pricing of the best-selling item, adds a stored balance, and changes how many sessions a day can hold. *v6.0 recorded the same about its payment chapter and called it the thing that most needed a second reader; this is that pattern repeating, one version later.*
>
> - **The session model is the largest structural change and has the least evidence.** It rests on one sentence about there being an evening service.
> - **DEF-G's per-lot costing is a formula change nobody has recomputed.** Every other figure in §7.0.2 has been verified five times; this one has been verified none.
> - **The fund's counter top-up has never been run against the Khumo**, and it rides the same unproven device-link step §6.8.2 gates on — *so it inherits R18 without being named in it.*
> - **Thirty-one collisions were found across five audit passes, and the fifth still found five.** The rate was not falling to zero, *which is itself a reason to expect more.* A sixth pass found no further contradictions with v6.0 and six errors of the pack's own — **the risk had moved inside the document**, which is worth knowing because it changes what a seventh pass should look for.
> - **Two figures §6.9 argues from are observations, not measurements** — the ten-tap cost of a 100% discount on Yoco, and T11's default of 25 first-timers an evening. Both are on §16.2's list and *neither blocks anything*.
> - **The generous-donor pattern is reported, not observed.** How often, how much and how many people — none of that is known. *If it turns out to be one person once a quarter, §6.10 is a week of work for a spreadsheet's worth of value.*
> - **DEC-15's deferred-income treatment has had no accounting review.** It is the right shape for the reports FAVO produces; whether it is the right shape for whatever HOFMI files is a question for the ministry's bookkeeper, **and it gates the fund's go-live.**

> **And one thing v7.0 confirmed is safe, which is worth saying plainly**
>
> **§7.0.3's grounded Sunday survives DEC-16 intact.** That day is worked to the cent, is a fixture in the test suite, and verifies independently five times across two review runs — *so a reader meeting a change to shot pricing would reasonably fear it moved.*
>
> It does not, and the reason was already in v6.0: *"the R10 surcharge applies from the first Sunday after this document is signed off — **it was not in force on 2026-08-16**."* The ten double cappuccinos on that day were rung at R20, **which is exactly what DEC-16 says they should cost.** *The one day the whole cost model is verified against is the one day the old pricing was never applied to.*

> **And one thing that is now more solid than it was**
>
> v5.2's front matter had to say, in bold, that the document was **not signable**, that the check which outranks all others — *"is every claim traceable to a source, or invented?"* — **was failing as late as round five on the one path where a customer can be charged twice**, and that **five things needed a person before any build could start, four of them the owner's.**
>
> **Those four are answered.** What remains is **one commercial conversation** (OPEN-08, and it is a gate), **two facts in one email** (FACT-1, FACT-2), **one R1.00 test**, and the ordinary work of building carefully. **That is a different kind of document from the one this replaced.**

**FAVO Café — Product Requirements Document v7.0.** Supersedes v6.0 (2026-09-07), v5.2 (2026-08-31), v5.1, v5.0, v4.0 and the v4 context-and-scope paper in full. Hosting chapter contributed by Transformate, 2026-08-07, adopted unchanged. Decisions DEC-01…DEC-12 taken by Nikao, 2026-08-19; the Web POS decision and the ten closures of §00 taken by Nikao, 3–7 September 2026; **DEC-13…DEC-16 and the shot, session, voucher and fund decisions taken by Nikao, 14 September 2026**, and merged here as v7.0 on 18 September 2026.

**v7.0 is v6.0 plus amendment pack A, and nothing else.** Every change carries the clause, defect or collision id it came from — `DEC-13…DEC-16`, `DEF-A…DEF-G`, `COL-1…COL-31`, `L41…L48`, `T11…T15`, `R22…R25`, `REQ-136…REQ-177` — so a reader who wants to know why a sentence moved can find the decision that moved it. *Amendment pack A was written after a shift on the sales-coffee team and audited over six passes against this document's own locked rules, invariants, matrices, screen contracts and review criteria.*

Technical chapters current as of `main @ 9aefc2c`. Yoco capability findings from the Yoco API reference, the in-person SDK prerequisites and the yoco.com device specifications, retrieved 3 September 2026; **the Web POS device-link step and the supported-model list are unconfirmed and are recorded as such** (§16.2 FACT-1, FACT-2). Card machine identified on sight by Nikao. Cost inputs extracted from `db/seed/*` at `9aefc2c` and are **estimates by explicit decision** (§7.0.1b).

**Where this document and any other file in the repository disagree, this document wins and the other file is a bug** — with one exception, adopted in v6.0 as criterion C-3: **where this document specifies an interaction with an external system, the artefact that system actually produces is dispositive as to feasibility.**
