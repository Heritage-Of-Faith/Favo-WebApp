# Planning

## Phase overview

| Phase | Dates | Scope |
|---|---|---|
| P1 — POS Core + Auth + Payment | Thu 28 – Fri 29 May | Schema (24 tables), seed, PIN + SSO, customer lookup, order flow, Yoco, state machine, ready→push, SSE queue, staff discount, audit on all mutations |
| P2 — Inventory + Live COGS | Sat 30 – Sun 31 May | Recipe deduction on transition, lots + origin, waste log, stock takes, low-stock push, live COGS dashboard, weekly archival, monthly P&L admin sign-off |
| P3 — Customer PWA + Loyalty + Offline | Mon 1 – Tue 2 Jun | Magic link, customer dashboard, loyalty earn/redeem, hours display, Service Worker offline, wallet + packs, exports |
| P4 — QA + Deploy | Wed 3 Jun | E2E suite, smoke, deploy to favo.hofmi.org |

## Phase 1 acceptance test
Barista PIN login → search "Louis" → place Cappuccino + Extra Shot → Yoco test card → Done → customer device receives push within 10 s → audit log row created.

## Branching
`feat/<initial>-<task-id>-<kebab-name>` · squash-merge with WI key `[HOFMI-FAVO-P1] {ID} — {title}`.

---

## Foundation (must merge to `main` first)

| ID | Title | Owner | Status |
|---|---|---|---|
| G1 | DB schema (24 tables) | Gian | ✅ merged |
| G2 | Audit triggers + RLS policies | Gian | ✅ merged (trigger + RLS SQL + `writeAudit`) |
| G3 | Seed (menu, customisations, staff, "Louis", hours) | Gian | ✅ merged (PR #1) |
| N1 | Design tokens + Tailwind v4 theme + `formatZar` / `formatDate` | Nikao | ⬜ todo |
| GX | Shared types + Server Action stubs | Gian | ✅ merged |

After these land, every other task is independently buildable.
**Gian's foundation (G1–G3, GX) is on `main`** — see "Backend status" in `CLAUDE.md` for callable signatures.

---

## Gian — Backend & server logic

| ID | Title | DB tables | Actions / endpoints | Dependency | Status |
|---|---|---|---|---|---|
| G4 | Auth.js v6: PIN provider + HOFMI SSO + RBAC middleware | staff, audit_log | `loginWithPin` | G1, G2, G3, GX | ✅ merged (PR #3) — PIN + RBAC done; HOFMI SSO provider still TODO (A3 needs it) |
| G5 | Order actions: search, create, transition, cancel, staff discount | orders, order_items, customers, staff_entitlement_log, payments, audit_log | `searchCustomer`, `createOrder`, `transitionOrder`, `cancelOrder`, `applyStaffDiscount` | G1, G2, G3, G4, GX | ✅ merged (PR #4) |
| G6 | Yoco webhook + SSE queue endpoint + LISTEN/NOTIFY plumbing | payments, orders, audit_log | `POST /api/payments/yoco/webhook`, `GET /api/queue/stream` | G1, G2, G3, G5 | ✅ merged (PR #5) — HMAC + routing + SSE framing done; PG LISTEN bridge + Yoco envelope confirm need live infra |
| G7 | Web Push backend (VAPID + send on ready) | customers, audit_log | `POST /api/push/subscribe`, `sendOrderReadyPush()` | G5 | ✅ merged (PR #6) — `transitionOrder→ready` push call-site is TODO |

## Mine — POS frontend & customer-facing UI

| ID | Title | Calls | Dependency |
|---|---|---|---|
| M1 | POS shell + PIN login screen | `loginWithPin` | N1, GX |
| M2 | Customer search + select (Zustand draft store) | `searchCustomer` | N1, GX |
| M3 | Order builder (menu + size + customisations) | `getMenu`, `createOrder` | N1, GX |
| M4 | Yoco hosted-fields payment view | `createOrder` | N1, GX → G6 |
| M5 | Live POS queue board (SSE consumer + reconnect) | `GET /api/queue/stream` | N1, GX → G6 |
| M6 | Active order view + Done button + staff discount UI | `transitionOrder`, `applyStaffDiscount`, `cancelOrder` | N1, GX → G5 |
| M7 | Online indicator + role guard polish | — | N1, M1 |

## Mia — Admin frontend UI/UX

| ID | Title | Calls | Dependency |
|---|---|---|---|
| A1 | shadcn/ui setup + admin design tokens | — | N1 |
| A2 | Admin shell + sidebar + auth gate | `getSession` | A1, GX |
| A3 | HOFMI SSO login page | `signIn('hofmi-sso')` | A1, A2 |
| A4 | Staff management UI | `listStaff`, `createStaff`, `setStaffPin`, `deactivateStaff` | A1, A2, GX |
| A5 | Menu management UI (price edit + history) | `getMenu`, `setMenuItemPrice` | A1, A2, GX |
| A6 | Audit log viewer (paginated + filterable + JSON diff) | `listAudit` | A1, A2, GX |

## Nikao — Landing, customer PWA, design system

| ID | Title | Reads / Calls | Dependency |
|---|---|---|---|
| N1 | Design tokens + Tailwind v4 theme + format helpers | — | none |
| N2 | PWA manifest + icons + favicon + meta | — | N1 |
| N3 | Landing page (hero, about, hours, visit, login CTA) | `operating_hours` | N1, G3 |
| N4 | OperatingHours shared component | `operating_hours` | N1, G1, G3 |
| N5 | Customer PWA shell + push subscription opt-in | `POST /api/push/subscribe` | N1, N2, G7 |
| N6 | Customer login stub (Phase 3 placeholder) | — | N1 |

---

---

## Wave 2 — Loyalty, Wallet & Packs (AT Jira keys)

These tasks shipped in Wave 2 (merged to `main` by 2026-06-21). Each row cross-references the original LOY/W local ID and the AT Jira issue.

| AT key | LOY/W ID | Title | Status |
|---|---|---|---|
| AT-109 | LOY-1 | Multi-unit loyalty redemption | ✅ merged |
| AT-111 | LOY-10a | Pack redemption backend | ✅ merged |
| AT-112 | LOY-10b | Pack redemption POS (superseded by AT-116) | ✅ closed — superseded |
| AT-113 | LOY-16 | WalletSpendDialog | ✅ merged |
| AT-114 | W1+W2 | Wallet spend action | ✅ merged |
| AT-116 | — | Pack redemption POS UI (replaces AT-112) | ✅ merged |
| AT-120 | — | Admin loyalty audit | ✅ merged |
| AT-123 | LOY-4 | Admin loyalty adjustment | ✅ merged |
| AT-124 | LOY-5 | Loyalty reconciliation | ✅ merged |
| AT-125 | LOY-6 | Earn on pack/wallet | ✅ merged |
| AT-126 | LOY-9 | Spec and enum reconciliation (this ticket) | ✅ merged |
| AT-127 | LOY-7 | Liability report | ⬜ todo |
| AT-128 | LOY-8 | Customer loyalty history | ⬜ todo |

---

## Phase 1 verification (merge gate)
1. Migrate + seed staging
2. Register Louis device via N5 staging form
3. Barista PIN login (PIN `1234`)
4. Search "Lou" → select Louis
5. Build Cappuccino + Extra Shot
6. Yoco test card `4111 1111 1111 1111`
7. Queue board updates
8. Start → Done
9. Push received in < 10 s
10. `/admin/audit` shows ≥ 5 rows for that order
11. Weekday cappuccino staff discount — accepted
12. Second same-day claim — rejected by `UNIQUE` constraint

Codified as Playwright spec `tests/e2e/phase1-acceptance.spec.ts` (Gian).

## Quality bars
| Phase | Vitest | Playwright |
|---|---|---|
| P1 | ≥ 20 | ≥ 8 |
| P2 | ≥ 35 | ≥ 14 |
| P3 | ≥ 50 | ≥ 20 |
| P4 | All prior green | Full E2E + read-only smoke on prod |

Audit coverage query must return 0 at end of every phase.

## Day-by-day cadence (P1)
| Slot | Lands |
|---|---|
| Thu AM | G1, G2, G3, N1, GX |
| Thu PM | G4, A1, N2, M1, A3 |
| Fri AM | G5, G6, M2, M3, A2, A4, N3, N4 |
| Fri PM | G7, M4, M5, M6, M7, A5, A6, N5, N6 |
| Fri EVE | Integration walk-through · Playwright acceptance spec · merge gate |
