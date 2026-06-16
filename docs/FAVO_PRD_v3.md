# FAVO Café — Product Requirements Document v3.0

**Authored by:** HOFMI Build Team · mine@hofmi.net
**Version:** v3.0.0 · supersedes v2.0 (2026-05-27)
**Last updated:** 2026-05-27
**Target launch:** Wednesday, 3 June 2026
**Status:** Final — ready for build

---

## 01 — Header & Metadata

| Field | Value |
|---|---|
| Project name | FAVO Café Web App |
| Document type | PRD v3.0 — incorporates client discovery (completed 2026-05-25 by Nkuleko Ngcobo) and executive decisions |
| Authored by | HOFMI Build Team · mine@hofmi.net |
| Supersedes | FAVO PRD v2.0 (draft, 2026-05-27) |
| Last updated | 2026-05-27 |
| Target launch | Wednesday, 3 June 2026 — in service for the Dr Mark Services. Firm deadline. |
| WI (master) | `HOFMI-FAVO-1` · tenant `hofmi` · status `spec-final` |
| WIs (phases) | `HOFMI-FAVO-P1` through `HOFMI-FAVO-P4` + infra WIs `HOFMI-FAVO-INFRA-1..2` |
| Repository | `github.com/hofmi-ai/favo` |
| Deploy target | `favo.hofmi.org` · Coolify on `hofmi-eu-open` (Hetzner DE) · Cloudflare in front |
| Tenancy | Single-tenant within `hofmi`; one café location for v1; multi-location is an explicit non-goal |
| Source language | English (UI), ZAR (currency), Africa/Johannesburg (timezone, UTC+2) |
| Distribution | Public-facing app. The customer PWA is publicly accessible. Admin routes are gated via Cloudflare Access (HOFMI SSO required). |

---

## 02 — Problem & Why Now

FAVO is a specialty coffee café that operates inside the HOFMI office during the week and serves the congregation before and after the Sunday service. Today the café runs on three disconnected surfaces: a paper order pad at the counter, a Yoco card machine that sits beside the till, and a WhatsApp group where staff message stock levels at the end of each day. There is no coherent record of what was sold, what was consumed, what was wasted, and where the gap between the three actually is.

The concrete cost is that **nobody knows the true cost of a cappuccino**. Beans get rotated, milk gets thrown when it foams badly, cups get dropped, staff drink their one free coffee but nobody counts it, and the Sunday service produces a forty-five-order rush in 85 minutes that the current paper queue cannot manage cleanly. COGS moves month to month with no narrative — the admin team only discovers a variance when they download a Yoco CSV and build a spreadsheet manually.

> **Mission frame:** Café revenue contributes to HOFMI's operational budget. Every Rand of variance is a Rand that does not reach ministry. The point is not to optimise a coffee shop — it is to *steward* it. The primary success metric (from FAVO Admin, Q54): *"the ability to easily see the movement of COGS and if we are making profit or not, without having to download a CSV and make the calculations myself."*

---

## 03 — Goals & Non-Goals

### Goals (in priority order)

1. **Live COGS visibility.** Revenue minus COGS minus expenses updates in real time on the admin dashboard. No CSV downloads. No manual calculations. This is the primary success metric.
2. **End-to-end traceability.** Every drink can be walked from ingredient lot → cup → revenue → audit row in under 30 seconds.
3. **Sunday peak throughput.** 45 orders processed in the 07:50–09:15 window (85 minutes) without queue degradation.
4. **100% digital revenue capture.** No paper, no off-system cash, no manual reconciliation as the primary path.
5. **Customer push notification on order ready.** Customer registered on the system receives a Web Push when the barista marks the order done.
6. **Loyalty earn on every order.** Registered customers earn 5 points per R10 spent, automatically applied on order completion. 100 points = R20 redeemable at POS.
7. **Inventory variance under 5%** weekly, from week 2 onwards.
8. **Offline counter mode** keeps the POS running through any ISP or Yoco outage. Zero orders lost.
9. **Single append-only audit trail** across orders, payments, inventory, refunds, and price changes.

### Non-Goals (explicit commitments not to build in v1)

1. **Customer self-ordering.** In-person only. Staff take orders at the counter. The customer PWA is a read-only loyalty and order history dashboard.
2. **Dine-in or pre-orders.** Takeaway / collection only.
3. **EFT / instant-EFT.** Yoco card at the counter, full stop.
4. **Tipping.** Not supported.
5. **Multi-language.** English only.
6. **KDS (Kitchen Display Screen).** One iPad. The barista writes the order on the cup and reads from the cup. The tablet shows the POS queue.
7. **Supplier composite rating.** No scoring system. Inventory items record origin and source. Purchases are logged. No rating computed.
8. **Operating hours enforcement.** Hours are displayed for customer information. The system never rejects an order based on time of day.
9. **Multi-location.** Single café. Multi-location is v4+.
10. **Multi-currency.** ZAR only.
11. **Native mobile apps.** PWA-first. App store wrappers are post-v1 only.
12. **Cash payment.** Yoco only. No paper float, no till drawer.

---

## 04 — Success Criteria

| Criterion | Target | How verified |
|---|---|---|
| Live COGS dashboard | Real-time, no manual step | Admin opens dashboard: current day revenue, running COGS, gross margin, and profit indicator all present and current. Verified by placing a test order and watching COGS increment within 5 seconds. |
| Sunday peak throughput | 45 orders in 85 minutes (07:50–09:15) | Load test simulating 45 concurrent orders against staging. Queue board on POS tablet remains stable throughout. |
| Order-to-cup time — normal day | 3–5 minutes | Measured from `orders.placed_at` to `orders.completed_at` on weekday service. p50 must be ≤ 5 min. |
| Order-to-cup time — Sunday peak | Max 10 minutes | Same query. p95 during Sunday service must not exceed 10 minutes. |
| Push notification delivery | Within 10 seconds of barista tapping "ready" | E2E test: barista marks order ready → registered customer device receives push within 10s. Verified in staging with a real device. |
| Loyalty point accrual | 5 pts per R10 on every completed order | `SELECT loyalty_points FROM customers WHERE id = ?` after test order. Points must match formula with zero manual step required. |
| Weekly inventory variance | < 5% by week 2 | SQL view `v_weekly_variance`; Grafana panel "FAVO · Variance". |
| Offline counter mode | 0 lost orders in a simulated 1-hour ISP outage | Phase 3 chaos drill: disable WAN for 60 minutes, take orders via IndexedDB outbox, reconcile on reconnect. Order count must match. |
| Audit coverage | 100% | `SELECT COUNT(*) FROM orders o LEFT JOIN audit_log a ON a.entity_id = o.id WHERE a.id IS NULL AND o.completed_at IS NOT NULL` must always return 0. |
| Staff entitlement enforcement | Max 1 per staff per weekday | `SELECT staff_id, day FROM staff_entitlement_log GROUP BY staff_id, day HAVING COUNT(*) > 1` must always return empty. |
| Monthly P&L admin sign-off | 100% signed before close | `monthly_reports.status = 'closed'` requires `admin_sig` non-null. DB CHECK constraint. |

---

## 05 — Tech Stack & Deploy Target

| Layer | Choice | Why |
|---|---|---|
| Framework | `Next.js 16 App Router + React 19` | Matches the HOFMI stack. Build team ships it daily. |
| Language | `TypeScript 5.6+ strict` | HOFMI standard. `tsc --noEmit` runs in every CI pass, no exceptions. |
| Styling | `Tailwind v4 + shadcn/ui` | Same as other HOFMI projects. Components are pre-audited. |
| Database | `PostgreSQL 16` | Self-hosted on `hofmi-eu-open`. Backed up nightly via Warden R2 snapshot. |
| ORM | `Drizzle ORM` | HOFMI standard. Typed schema, predictable migrations. |
| Authentication | `Auth.js v6 (NextAuth)` | Staff: PIN provider (custom). Customers: email magic link. Admin/Finance: HOFMI SSO. |
| Payments | `Yoco Online API` | SA-native. PCI-DSS managed by Yoco. Hosted fields + tokenisation. No PAN data stored. |
| Real-time queue | `Postgres LISTEN/NOTIFY + SSE` | One fewer moving part than WebSockets. SSE proxies cleanly through Cloudflare. |
| Offline POS | `IndexedDB (idb) + Service Worker` | Counter-only writes go to an outbox; sync queue replays on reconnect with LWW + audit. |
| Push notifications | `Web Push API + VAPID + web-push lib` | Works on PWA without app store. VAPID enforces server identity. |
| File storage | `Cloudflare R2 · bucket: hofmi-favo` | Receipts, exports. Already used for Warden memory backups. |
| Hosting | `Coolify on hofmi-eu-open` | Same deploy pipeline as the rest of HOFMI. `git push` triggers rebuild. |
| CDN / DNS | `Cloudflare · favo.hofmi.org` | Cloudflare Access gates admin routes. WAF in front of all public routes. |
| CI / CD | `GitHub Actions → Coolify webhook` | Typecheck, lint, test on every PR. Deploy on merge to `main`. |
| Tracing | `Raindrop` | Standard across the HOFMI agent fleet. |
| Logs | `Pino → Loki` | Sentinel already watches the Loki instance on `hofmi-eu-open`. |
| Tests | `Vitest + Playwright + Storybook` | Unit, E2E, component states. HOFMI standard test matrix. |
| Secrets | `Infisical · project hofmi/favo` | No `.env` committed. Coolify pulls via Infisical service token at deploy. |

### Environment variables (canonical names)

```bash
# Pulled from Infisical at deploy. NEVER committed to the repository.
DATABASE_URL=postgres://favo:***@hofmi-eu-open:5432/favo
NEXTAUTH_SECRET=***
NEXTAUTH_URL=https://favo.hofmi.org
YOCO_SECRET_KEY=sk_live_***
YOCO_WEBHOOK_SECRET=whsec_***
VAPID_PUBLIC_KEY=***
VAPID_PRIVATE_KEY=***
R2_ACCESS_KEY_ID=***
R2_SECRET_ACCESS_KEY=***
R2_BUCKET=hofmi-favo
R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com
DISCORD_WEBHOOK_FAVO_OPS=https://discord.com/api/webhooks/***
RAINDROP_TOKEN=rd_***
LOKI_URL=https://loki.hofmi-eu-open:3100
PUBLIC_BASE_URL=https://favo.hofmi.org
TZ=Africa/Johannesburg
```

> **Security invariant:** Never store raw card data or full PANs anywhere in the system. Always use Yoco's hosted fields and tokenisation. Never log card numbers, CVVs, or expiry dates in Loki, Raindrop, the audit log, or anywhere else.

---

## 06 — Data Model

Twenty-four core tables. Schema lives in `db/schema.ts` (Drizzle). Migrations in `drizzle/`. Audit log is append-only, trigger-enforced, forever.

| Table | Purpose | Key columns & constraints |
|---|---|---|
| `orders` | The unit of sale. | `id` (uuid), `customer_id` (nullable — guest orders allowed), `staff_id`, `state` (enum: ordered, in_progress, ready, collected, cancelled), `placed_at`, `completed_at`, `total_zar` (cents), `yoco_payment_id`, `is_staff_discount` (bool) |
| `order_items` | Line items in an order. | `id`, `order_id`, `menu_item_id`, `quantity`, `unit_price_zar`, `modifications` (jsonb: milk choice, extra shot, size) |
| `menu_items` | Everything that can be ordered. | `id`, `name`, `category` (enum: coffee, non_coffee), `active`, `current_price_zar`, `recipe_id`. Seeded: 5 items + size variants at Phase 1. |
| `menu_customisations` | Available modifications per item. | `id`, `menu_item_id`, `name` (e.g. "Macadami Milk", "Extra Shot"), `price_delta_zar` (0 for free, positive for add-on) |
| `recipes` | What a drink is. | `id`, `menu_item_id`, `version` |
| `recipe_ingredients` | What a drink consumes per recipe. | `id`, `recipe_id`, `inventory_item_id`, `quantity`, `unit` (enum: g, ml, units), `tolerance_pct` |
| `inventory_items` | Things FAVO holds stock of. | `id`, `name`, `kind` (enum: beans, milk, cup, lid, powder, other), `unit`, `low_stock_threshold`, `origin` (text — bean variety and source) |
| `inventory_lots` | Specific batches — especially beans. | `id`, `inventory_item_id`, `source_name` (text), `batch_number`, `roast_date`, `received_at`, `state` (enum: sealed, active, depleted) |
| `stock_movements` | Every stock change — append-only. | `id`, `inventory_lot_id`, `delta` (signed), `kind` (enum: deduction, waste, restock, adjustment), `related_order_id`, `at`, `by_staff_id` |
| `stock_takes` | Physical counts. | `id`, `kind` (enum: weekly, daily, opening), `started_at`, `completed_at`, `by_staff_id`, `variance_pct` |
| `stock_take_lines` | Per-item count within a stock take. | `id`, `stock_take_id`, `inventory_lot_id`, `expected`, `counted`, `variance` |
| `stock_alert_recipients` | Staff who receive low-stock push alerts. | `id`, `inventory_item_id` (nullable — null = global), `staff_id` |
| `customers` | Registered customer accounts. | `id`, `email`, `name`, `phone` (nullable — used for POS search), `push_subscription` (jsonb), `loyalty_points` (integer, default 0), `created_at` |
| `loyalty_transactions` | Loyalty point earn and redemption log. | `id`, `customer_id`, `order_id`, `delta` (signed), `kind` (enum: earn, redeem), `at` |
| `staff` | Baristas and admins. | `id`, `name`, `role` (enum: barista, admin), `pin_hash`, `active`. Note: `barista` covers both POS operation and coffee preparation. |
| `staff_entitlement_log` | Free coffee claims — barista-applied. | `id`, `staff_id` (receiving the discount), `applied_by_staff_id` (barista on duty), `order_id`, `day` (date) |
| `payments` | Yoco transaction records. | `id`, `order_id`, `yoco_payment_id`, `amount_zar`, `status` (enum: pending, success, failed), `webhook_received_at` |
| `refunds` | Refund records — full amount only. | `id`, `order_id`, `amount_zar`, `reason`, `requested_by`, `approved_by`, `status` |
| `waste_log` | Every waste event. | `id`, `category` (enum: dropped, wrong_order, broken, remake, bean_quality_failure), `inventory_lot_id`, `quantity`, `reason`, `by_staff_id`, `at` |
| `purchases` | Stock purchases — source logged, not rated. | `id`, `source_name` (text), `inventory_lot_id`, `received_at`, `total_zar`, `kind` (enum: standard, emergency); emergency requires `admin_approved_by` non-null |
| `operating_hours` | Display-only hours — never enforced as an order gate. | `id`, `day_of_week`, `open_time`, `close_time`, `is_closed`, `note` |
| `expenses` | Non-stock operating expenses. | `id`, `category` (enum: rent, utilities, delivery, equipment, wages, maintenance), `amount_zar`, `incurred_at`, `logged_by` |
| `price_history` | Menu price changes — append-only. | `id`, `menu_item_id`, `price_zar`, `effective_from`, `effective_until` (nullable = current); no UPDATE/DELETE ever |
| `audit_log` | Append-only record of everything that matters. | `id`, `entity_kind`, `entity_id`, `action`, `actor_id`, `actor_role`, `at`, `before` (jsonb), `after` (jsonb), `reason`; INSERT only — UPDATE and DELETE trigger-denied forever |

### RLS policy summary

- **Customers** can SELECT their own `orders`, `loyalty_transactions`. No write access to orders.
- **Barista** can SELECT/INSERT `orders`, `order_items`, `waste_log`, `staff_entitlement_log`. Can search `customers` by name or phone (read-only, name + phone fields only). Cannot DELETE anything.
- **Admin** can write to `price_history`, `operating_hours`, `stock_alert_recipients`, approve `refunds`, approve emergency `purchases`, sign `monthly_reports`, access all financial reports. `audit_log` remains INSERT-only even for Admin.

> **Invariant:** Never DELETE or UPDATE records in `stock_movements`, `loyalty_transactions`, `audit_log`, or `price_history`. Mark as voided with a follow-up INSERT. Trigger-enforced on `audit_log`; policy-enforced on the others.

---

## 07 — API Surface

Server Actions for mutations. Route handlers for queries and webhooks. SSE for the live queue. All ordering flows are barista-only — the customer app is read-only.

| Endpoint / Action | Kind | Auth | Behaviour |
|---|---|---|---|
| `searchCustomer(query)` | Server action | barista | Searches `customers` by name or phone. Returns id, name, phone, loyalty_points. Used at POS before order creation. Guest path skips this step. |
| `createOrder(input)` | Server action | barista | Creates order in `ordered` state. `customer_id` is nullable (guest). Returns order id + Yoco payment intent. Stock not deducted yet. |
| `transitionOrder(id, toState)` | Server action | barista | State machine: ordered → in_progress → ready → collected. Transition to `in_progress` deducts stock. Transition to `ready` fires Web Push and accrues loyalty points. |
| `cancelOrder(id, reason)` | Server action | barista / admin | Valid only if `state == ordered`. Returns 409 once prep has started. |
| `applyStaffDiscount(orderId, beneficiaryStaffId)` | Server action | barista | Sets `orders.is_staff_discount = true`, `total_zar = 0`, inserts `staff_entitlement_log`. Cappuccinos only. Weekdays only. Barista can apply for themselves. |
| `POST /api/payments/yoco/webhook` | Route handler | HMAC | Verify signature with `YOCO_WEBHOOK_SECRET`. Match payment → order. Idempotency on `yoco_payment_id`. |
| `GET /api/queue/stream` | SSE | barista | Postgres LISTEN on channel `order_changes`. Pushes JSON events to the POS tablet queue view. Client reconnects automatically on close. |
| `GET /api/cogs/live` | Route handler | admin | Returns current day: total revenue (ZAR), total COGS, total expenses, gross margin, and profit flag. Computed live from DB — no batch step. |
| `logWaste(input)` | Server action | barista | Inserts `waste_log` + `stock_movements(kind='waste')` atomically. |
| `runStockTake(kind)` | Server action | admin+ | Creates `stock_takes` row; UI walks each lot; close computes and stores variance. |
| `checkLowStock()` | Cron · every 15 min | system | Queries `inventory_items` where stock ≤ threshold. Sends Web Push to all matching `stock_alert_recipients`. |
| `requestRefund(orderId, reason)` | Server action | any staff | Creates pending `refunds` row. Requires admin approval before Yoco is triggered. |
| `approveRefund(id)` | Server action | admin | Triggers Yoco refund. Inserts audit row. Full amount only. |
| `setMenuItemPrice(id, priceZar)` | Server action | admin | Closes current `price_history` row; inserts new row. Applies to new orders only. |
| `redeemLoyalty(customerId, orderId)` | Server action | barista | Validates ≥ 100 points. Deducts points, sets `total_zar = 0`. Full redemption only. |
| `topUpWallet(customerId, amountZar)` | Server action | barista | Creates Yoco payment intent. Webhook credits wallet on success. Counter-only — barista processes on behalf of customer. |
| `purchasePack(customerId, menuItemId, qty)` | Server action | barista | Creates Yoco payment intent. On success, inserts `coffee_packs` with `expires_at = now() + 90 days`. Counter-only. |
| `closeDaily()` | Cron · 23:59 SAST | system | Reconciles payments vs stock movements. Blocks close and pages Admin via Discord if mismatches exist. |
| `generateWeeklyPnL()` | Cron · Sun 23:59 | system | Aggregates revenue, COGS, expenses; writes archival report row; Discord ping to `#favo-ops`. Secondary to the live dashboard. |
| `approveMonthlyPnL(id)` | Server action | admin | Sets `admin_sig`. Report status transitions to `closed` immediately. |
| `GET /api/reports/export?format=csv\|pdf` | Route handler | admin | Exports sales, COGS, and inventory summary in CSV or PDF format. |

> **Security invariant:** Never bypass the RBAC permission check in any API route or Server Action. Enforcement at the server layer — not just the UI. Admin routes are additionally blocked at the Cloudflare Access layer.

---

## 08 — Business Rules

### LOCKED — require PRD amendment to change

**L01 — No payment, no order.** An order without a successful Yoco payment record is never created. Failed payment cancels the order; no stock deducted.

**L02 — Full refunds only.** No partial refunds in v1. Full refund + re-charge for kept items if partial is needed operationally.

**L03 — Staff free coffee: one free cappuccino per staff member per weekday.** 100% discount applied by the barista on the POS during checkout. The barista on duty can apply it for themselves. Restricted to cappuccinos only — no other drink categories qualify. Enforced at the DB by `UNIQUE(staff_id, day)` on `staff_entitlement_log`; weekdays only. A second claim on the same weekday is rejected by the constraint.

**L04 — Operating hours are display-only.** The system never rejects or blocks an order based on time of day or day of week. Hours in `operating_hours` are for customer-facing display only.

**L05 — Ordering is in-person only. Barista creates all orders.** Customers have no write access to `orders`. The customer PWA is read-only.

**L06 — Loyalty points: earn 5 per R10 spent, minimum 100 to redeem, 100 pts = R20.** Auto-accrued on `state = ready`. Full redemption only — no mixing points with cash.

**L07 — Midnight cut-off for revenue day boundary.** Orders placed at 00:00:01 SAST belong to the new day.

**L08 — Every inventory adjustment writes an audit row.** No silent edits. Trigger-enforced.

**L09 — Stock reconciles with sales before daily close.** `closeDaily()` blocks and pages Admin if mismatches exist.

**L10 — Emergency purchases require admin approval.** `purchases.kind = 'emergency'` requires `admin_approved_by` non-null at insert.

**L11 — Monthly P&L requires Admin sign-off to close.** DB CHECK constraint enforced.

**L12 — Audit log is append-only.** Trigger denies UPDATE and DELETE. Cannot be disabled by any role.

**L13 — FAVO data is tenant-isolated to `hofmi`.** RLS-enforced. No FAVO row is visible from any other tenant context.

**L14 — Staff entitlement: DB-enforced, weekdays only, cappuccinos only.** `UNIQUE(staff_id, day)` on `staff_entitlement_log` is implemented. The constraint applies on weekdays only — no entitlement on Saturdays or Sundays. Only cappuccinos qualify; any attempt to apply the discount to another drink category must be rejected at the application layer before the DB is touched.

**L15 — Mark order ready: barista taps "Done" on the POS dashboard.** The person manning the POS is responsible for the full order lifecycle — taking the order, making the drink, and tapping Done when the drink is ready. No secondary person or handoff required. The Done button must be the most prominent action on the active-order view.

**L16 — Customer wallet top-ups and coffee packs are in scope for v1.** Both features are processed at the counter by the barista on the POS tablet — no customer self-service. Wallet top-up creates a Yoco payment intent; on success, credits the customer's balance. Coffee packs are purchased at the counter and tracked in `coffee_packs` with a 90-day expiry.

### TUNABLE — adjustable by Admin with a logged config change

**T01 — Variance bands.** Default: 0–5% acceptable, 5–10% investigate, 10%+ critical.

**T02 — Bean freshness window.** Default: 14 days post-roast before alert. Adjustable per bean lot origin.

**T03 — Sunday rush window.** Default: 07:50–09:15. Adjust as service times change.

**T04 — Low stock thresholds per item.** Set per `inventory_items.low_stock_threshold`; configurable from Admin UI without a deployment.

**T05 — Low stock alert check interval.** Default: every 15 minutes. Tighten during Sunday peak if needed.

---

## 09 — Phasing & Delivery

Four phases. Seven days. Launch Wednesday 3 June 2026. Four developers + Claude Code running in parallel.

| Phase | Name | Dates | Summary |
|---|---|---|---|
| Phase 1 | POS Core + Auth + Payment | Days 1–2 · May 28–29 | Schema, auth, customer lookup, full order flow, Yoco payment, mark-ready push notification, live queue SSE, staff discount. |
| Phase 2 | Inventory + Live COGS | Days 3–4 · May 30–31 | Recipe deduction, stock takes, waste logging, low-stock alerts with push to named staff, live COGS dashboard, weekly archival cron. |
| Phase 3 | Customer PWA + Loyalty + Offline | Days 5–6 · Jun 1–2 | Customer magic link auth, read-only dashboard, loyalty earn + redeem, operating hours display, Service Worker offline mode, wallet + packs, report exports. |
| Phase 4 | QA + Deploy | Day 7 · Jun 3 | Full E2E pass, smoke test on prod, deploy to favo.hofmi.org, hand-off to FAVO team. |

---

### Phase 1 — POS Core + Auth + Payment
**Days 1–2 · Thu 28 – Fri 29 May · `HOFMI-FAVO-P1`**

**Scope:** Full DB schema migrated (all 24 tables). Menu seeded: 5 items + size variants, customisations (Macadami Milk, Extra Shot, single/double shot). Staff auth: PIN login (barista and admin roles), HOFMI SSO (admin, TODO). Customer lookup: POS search by name or phone → select from results → or create guest order. Order flow: select customer or guest → add items with modifications → Yoco hosted-fields payment → order created → queue updated via SSE. State machine: ordered → in_progress → ready → collected. Transition to *ready* fires Web Push to customer's registered device. Staff discount: barista applies 100% to an order (cappuccinos only, weekdays only, including for themselves) via `applyStaffDiscount()`. Live queue on POS: SSE stream from Postgres LISTEN/NOTIFY. Audit log writing on all mutations.

**Acceptance:** Barista logs in via PIN. Searches customer "Louis" — finds match. Places a cappuccino order with Extra Shot. Yoco test-card payment succeeds. Barista taps Done. Customer device receives push notification within 10 seconds. Audit log row created.

**Out of scope:** Inventory deduction (Phase 2), customer PWA login (Phase 3), offline mode (Phase 3).

**Developer split:** Dev A: DB schema + auth. Dev B: POS UI + customer lookup. Dev C: Yoco integration + webhooks. Dev D: SSE queue + push notifications.

---

### Phase 2 — Inventory + Live COGS Dashboard
**Days 3–4 · Sat 30 – Sun 31 May · `HOFMI-FAVO-P2`**

**Scope:** Recipe ingredients linked to inventory items. Auto-deduction on `transitionOrder(→ in_progress)`. Inventory lots with origin tracking (bean variety + source name). Waste logging UI: category + reason + quantity. Stock take flow: admin starts, UI walks each lot, variance computed and stored. Low stock threshold: when stock ≤ threshold, `checkLowStock()` cron pushes alert to named recipients in `stock_alert_recipients`. Admin UI to configure recipients per item or globally. Live COGS dashboard (`GET /api/cogs/live`): current day revenue, running COGS, expenses, gross margin, profit indicator — real-time, updates on order completion. Secondary: `generateWeeklyPnL()` cron runs Sunday 23:59 for archival snapshot + Discord ping. Monthly P&L report with admin sign-off approval flow. Emergency purchase flag with admin approval gate.

**Acceptance:** Admin opens COGS dashboard. Barista places an order — COGS updates within 5 seconds. Milk stock drops below threshold → named staff receive push notification. Admin logs an expense → gross margin recalculates. Weekly cron fires Sunday 23:59 → Discord ping received in `#favo-ops`.

**Risk:** Ingredient costs must be seeded in `inventory_lots` for COGS to be meaningful. FAVO team provides cost data before Phase 2 begins, or a best-estimate is seeded and corrected post-launch.

---

### Phase 3 — Customer PWA + Loyalty + Offline Mode
**Days 5–6 · Mon 1 – Tue 2 Jun · `HOFMI-FAVO-P3`**

**Scope:** Customer auth: email magic link. Customer registers once — name + phone stored for POS lookup thereafter. Customer read-only dashboard: recent orders (last 10), current loyalty points balance, redemption history. Push notification subscription: customer grants permission on first login. Loyalty earn: 5 points per R10 spent, auto-applied in `transitionOrder(→ ready)`. Loyalty redemption at POS: barista applies `redeemLoyalty()` → 100 pts deducted, order total set to R0. Operating hours display: admin configures in `operating_hours` table, shown on customer PWA. No order-gate logic. Wallet top-up and coffee pack purchase: counter-only, barista processes via `topUpWallet()` and `purchasePack()`. Offline mode: Service Worker installed on POS tablet. IndexedDB outbox captures orders when offline. Sync queue replays on reconnect with last-write-wins and audit trail entry for each conflict. Report exports: CSV and PDF for sales summary, COGS, and inventory variance.

**Acceptance:** Customer receives magic link, logs in, sees last 3 orders and 45 loyalty points. Barista redeems 100 pts for customer — order total becomes R0. WAN cable unplugged for 30 minutes, 5 orders taken via IndexedDB — all reconcile on reconnect with no data loss.

---

### Phase 4 — QA + Production Deploy
**Day 7 · Wed 3 Jun — Launch Day · `HOFMI-FAVO-P4`**

**Scope:** Full E2E Playwright suite run against staging: order flow, Yoco test-card, push delivery, loyalty accrual, offline drill, audit coverage query. Security pass: Semgrep + Grype scan. Zero critical findings gate. Deploy to `favo.hofmi.org` via Coolify. Cloudflare Access configured. Infisical secrets verified in production. Hand-off to FAVO team (Matt, Nkuli, Louis).

**Acceptance:** Audit coverage query returns 0. All Playwright tests green. Push notification works on a real device from `favo.hofmi.org`. Admin can see live COGS.

**Ship gate:** Matt (Owner) + Nkuli (Admin) sign off. Helm WI transitions to `shipped`. Discord ping to `#favo-ops` with deploy SHA and smoke result.

> **Post-launch (v1.1):** Shift scheduling; quality ratings; barista performance dashboard.

---

## 10 — Risks & Rollback

| ID | Risk | Likelihood | Impact | Mitigation | Rollback |
|---|---|---|---|---|---|
| R1 | June 3 deadline slips | Med | High | Phase 1 alone (POS + payment + push) is sufficient to run the service. Phases 2–3 are additive. | Ship Phase 1 only on June 3. Inventory and COGS revert to spreadsheet for first week. |
| R2 | Yoco API outage during Sunday peak | Med | High | Health check pings Yoco every 60s. Auto-enable "deferred payment" mode on 3 consecutive failures. | Mark orders "paid in person — reconcile later" with audit row. Manual reconcile within 24h. |
| R3 | Offline sync conflict | Med | Med | Last-write-wins by timestamp. Full audit history retained. Conflicts flagged in `sync_conflicts` table. | Manager resolves flagged conflicts daily with audit row. No data lost. |
| R4 | Push notification non-delivery | High | Low | Live queue board on POS is the primary signal. Push is secondary. Customer can check status in PWA. | Customer asks at counter. Staff identifies order by order number on cup. |
| R5 | Inventory deduction race on concurrent orders | Med | High | Postgres row-level locking via `SELECT … FOR UPDATE` within the order transaction. | Daily reconciliation catches drift. Admin alert if variance exceeds 1%. |
| R6 | Inventory variance > 15% in first week | High | Med | Daily check-in with Admin during week 1 to calibrate recipe yields. Tolerance bands are tunable. | Reset baseline; tighten `recipe_ingredients.tolerance_pct`. |
| R7 | Staff PIN compromise or sharing | Low | Med | Rotate PINs monthly. Anomaly detection on entitlement claims outside shift hours. | Revoke PIN, force re-PIN; review full audit trail for the affected period. |
| R8 | Yoco webhook replay attack | Low | High | HMAC signature verification. Idempotency on `yoco_payment_id`. | Rotate secret in Infisical; redeploy. Review audit log for any successful replays. |
| R9 | Postgres LISTEN/NOTIFY lag at Sunday peak | Low | Med | SSE 30-second heartbeat. Client reconnects automatically. Missed events caught by full poll on reconnect. | Page refresh restores full queue. No data lost. |
| R10 | COGS inaccurate in week 1 — ingredient costs not seeded | High | Med | Seed with best-estimate costs before Phase 2. Dashboard shows a warning until Admin confirms costs. | Admin updates `inventory_lots` costs at any time. COGS recalculates from that point forward. |

### Rollback strategies

- **Phase 1 minimum viable fallback.** If Phases 2–3 slip, Phase 1 alone handles June 3rd. COGS and inventory can revert to spreadsheet for the first week.
- **Feature flag rollback.** Each phase feature ships behind a flag in `config.flags`. Flip to disable — no code rollback, no migration reversal.
- **Data rollback.** Postgres point-in-time recovery via the Warden R2 nightly snapshot of `hofmi-eu-open`. Worst-case granularity: 24h.
- **Schema rollback.** Every Drizzle migration ships with a tested `down` script. Staging runs `down` + `up` on every migration PR in CI.
- **Catastrophic fallback.** DNS switched to a static "We're back at the counter" page. Paper for the day. Restore from last good snapshot overnight. Reconcile all transactions the next morning.

---

## 11 — Acceptance Tests & Verification

### Test matrix per phase

| Phase | Vitest (unit) | Playwright (E2E) | Manual drill |
|---|---|---|---|
| P1 | ≥ 20 tests — order state machine, payment idempotency, RBAC checks, customer search | ≥ 8 tests — full order flow, push delivery, PIN login, guest order | Real Yoco test-card flow. Audit coverage query returns 0. |
| P2 | ≥ 35 tests — recipe deduction, stock movements, COGS computation, low-stock trigger | ≥ 14 tests — COGS dashboard updates live, stock alert delivered, waste log written | Admin views COGS dashboard. Place test order. COGS updates within 5s. |
| P3 | ≥ 50 tests — loyalty accrual, redemption validation, offline outbox, sync reconciliation | ≥ 20 tests — magic link login, loyalty dashboard, offline chaos drill, report export | WAN-out 30-min drill. 5 orders reconcile cleanly. Loyalty redemption E2E. |
| P4 | All prior tests pass on prod schema | Full E2E suite against staging. Smoke suite against prod (read-only). | Owner + Admin sign-off. Discord ship ping with SHA. |

### Verification protocol

1. **Pre-merge.** CI runs `bun typecheck`, `bun lint`, `bun test:unit`, `bun test:e2e:ci`. All must be green.
2. **Merge.** Squash to `main` with phase WI key in commit message (e.g. `[HOFMI-FAVO-P1]`).
3. **Deploy.** Coolify webhook fires → rebuild → `favo.hofmi.org`.
4. **Post-deploy smoke.** Read-only E2E paths only — no mutating tests against live data.
5. **Ship ping.** Post to Discord `#favo-ops`: phase WI key, deploy SHA, URL, smoke result, audit-coverage query result.

---

## Appendix A — Glossary

| Term | Definition |
|---|---|
| COGS | Cost of Goods Sold. Total cost of ingredients consumed in producing sold drinks over a period. Computed live from stock_movements × ingredient cost. |
| LWW | Last-Write-Wins. Conflict resolution strategy for offline sync — the most recently timestamped write wins when two writes conflict. |
| PIN | 4–6 digit numeric staff login code. Hashed (bcrypt) at rest. Rotated monthly. |
| POS | Point of Sale. The single iPad at the FAVO counter. Operated by the barista on duty. The barista takes orders, processes payment, writes the cup, makes the drink, and taps Done — all from this one device. |
| POPIA | Protection of Personal Information Act. South African data protection legislation. FAVO collects personal data (email, name, phone, purchase history) and must handle it per POPIA requirements. |
| PRD | Product Requirements Document. This document. Authoritative specification for what gets built. |
| PWA | Progressive Web App. Web app installable to a phone home screen, with a service worker enabling offline functionality. |
| RLS | Row-Level Security. Postgres feature enforcing per-row access policies at the database layer, independent of the application. |
| SAST | South African Standard Time (UTC+2). All timestamps in this PRD are SAST unless explicitly stated. |
| SSE | Server-Sent Events. One-way HTTP streaming from server to client. Used for the live POS queue. Proxies cleanly through Cloudflare. |
| VAPID | Voluntary Application Server Identification. Key pair authenticating the push notification server to the browser push service. |
| Variance | Difference between expected stock (from recipe deductions) and counted stock (from stock takes), expressed as a percentage. |
| Yoco | South African card payments gateway. PCI-DSS managed. FAVO holds no PAN data — Yoco's hosted fields handle all card input. |
