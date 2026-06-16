# FAVO Café — Phase 2 Build Plan

**Phase:** P2 · Inventory + Live COGS Dashboard
**Dates:** Days 3–4 · Sat 30 – Sun 31 May 2026
**WI:** `HOFMI-FAVO-P2`
**Repo:** `github.com/hofmi-ai/favo`
**Default branch:** `main`
**Reference docs (every dev reads before starting):** `CLAUDE.md`, `DESIGN.md`, `ARCHITECTURAL.md`, `DATA_MODEL.md`, `API.md`, `BUSINESS_RULES.md`, `PLANNING.md`, `FAVO_PRD_v3.md`

Phase 1 acceptance has passed and is merged to `main`. Phase 2 builds on top of: schema, seeded menu, working order flow, audit, SSE.

---

## 1. Phase 2 acceptance test (from PRD §09)

> Admin opens COGS dashboard. Barista places an order — COGS updates within 5 seconds. Milk stock drops below threshold → named staff receive push notification. Admin logs an expense → gross margin recalculates. Weekly cron fires Sunday 23:59 → Discord ping received in `#favo-ops`.

Plus the locked rules that this phase activates:

- L08 — every inventory adjustment writes an audit row
- L09 — stock reconciles with sales before daily close
- L10 — emergency purchases require admin approval
- L11 — monthly P&L requires admin sign-off to close

---

## 2. Team & load distribution

| Dev | Phase 2 task count | Why this shape |
|---|---|---|
| **Gian** | 8 | All deduction, server actions, COGS endpoint, two crons, P&L approval flow live in the data layer |
| **Mia** | 7 | Admin owns every Phase 2 screen except the POS-side waste flow |
| **Mine** | 6 | POS gets inventory awareness, waste logging, low-stock indicator, daily summary |
| **Nikao** | 5 | Provides data-viz primitives, status badge system, dashboard layout tiles, report template — consumed by Mia and customer PWA |

Total: 26 tasks across 2 days. Heavier than Phase 1 (was 23) but Phase 1 left the foundation in place — every new task plugs into existing schema, auth, SSE, and audit.

---

## 3. Branching, CI, merge order

Same conventions as Phase 1:

- Branch: `feat/<initial>-<task-id>-<kebab-name>` (e.g. `feat/g-g8-recipe-seed`)
- Squash-merge to `main` with `[HOFMI-FAVO-P2] {ID} — {title}`
- CI gate: `bun typecheck` · `bun lint` · `bun test:unit` — green before merge
- Playwright (`bun test:e2e:ci`) required for Gian's tasks touching deduction or cron

### Foundation — lands in `main` Sat morning before anything else

| Order | Task | Why first |
|---|---|---|
| 1 | **G8** — Recipe + inventory seed expansion + cost columns | Adds `inventory_lots.unit_cost_zar` and `inventory_lots.quantity_received`. Every COGS query depends on these. Seeds recipes for the 5 menu items and starter lots with best-estimate costs (R10 mitigation). |
| 2 | **GY** (sub-task of G9/G13) — COGS contract + new server action stubs | `getCogsLive()`, `listInventory()`, `listLots()`, `listExpenses()`, `listPurchases()`, `listStockTakes()`, `getRecipe()` typed stubs with realistic fixtures so Mia builds A7–A13 against types from day one. |
| 3 | **N7** — Recharts wrappers + chart tokens | Used by every dashboard tile. Light, no backend dep. |
| 4 | **N8** — Status badge + variance band visual system | Used by Mia and Mine for stock state, freshness, variance. |
| 5 | **N9** — Dashboard layout primitives (KPI tile, sparkline tile, alert tile) | A7 (COGS dashboard) consumes these directly. |

After these five PRs land (target: Sat 10:00), everything below runs in parallel.

---

## 4. Dependency graph

```
G8 (cost columns + seed) ──┬─► G9 (deduction on transition)
                            ├─► G11 (stock-take actions)
                            ├─► G13 (COGS endpoint + views)
                            └─► all admin inventory UI

GY (stubs) ──► all admin UI (A7..A13) + POS inventory (M8..M13)

N7 (charts) ──┐
N8 (badges) ──┼─► A7 (COGS), A8 (Inventory), A9 (Stock take), Mine's POS badges
N9 (tiles)  ──┘

G9 (deduction) ──► G13 (live COGS shows real numbers)
G13 (COGS) ──► A7 (dashboard backed by real data)
G14 (low-stock cron) ──► M10 (POS subscription) + A12 (recipient management)
G15 (monthly P&L) ──► A13 (approval UI)
```

After Sat morning foundation: no developer waits on another.

---

## 5. Developer cards

---

### Gian — Backend & server logic

Owns: schema additions, deduction, COGS computation, crons, P&L approval, all new server actions.

---

#### G8 — Inventory + recipe seed expansion + cost columns

- **Owner:** Gian
- **Branch:** `feat/g-g8-inventory-seed`
- **PRD sections:** §06 (data model), §09 Phase 2 scope, §10 R10
- **DB tables touched:** `inventory_lots` (alter), `inventory_items` (seed), `inventory_lots` (seed), `recipes` (seed), `recipe_ingredients` (seed), `stock_alert_recipients` (seed)
- **Files to create / modify:**
  - `drizzle/0002_inventory_costs/*` — add `inventory_lots.unit_cost_zar` (integer, nullable) and `inventory_lots.quantity_received` (numeric)
  - `db/schema.ts` — update lot columns
  - `db/seed/inventory.ts` — inventory items: espresso beans, milk, oat milk, macadami milk, 8oz cup, 12oz cup, lid, hot chocolate powder
  - `db/seed/lots.ts` — starter lot per item with best-estimate cost (R10 mitigation; flagged `cost_estimated = true` in audit reason)
  - `db/seed/recipes.ts` — recipe per menu item; ingredients per size variant
  - `db/seed/alert-recipients.ts` — seed barista as global low-stock recipient
- **Claude prompt:**
  > Read `DATA_MODEL.md`, `BUSINESS_RULES.md` (L08), `FAVO_PRD_v3.md` §06 §09 §10 R10. Generate Drizzle migration `0002_inventory_costs` adding `unit_cost_zar` (integer cents, nullable) and `quantity_received` (numeric(10,2)) to `inventory_lots`. Update `db/schema.ts`. Build idempotent seed scripts: 8 `inventory_items` (espresso_beans, whole_milk, oat_milk, macadami_milk, cup_8oz, cup_12oz, lid, hot_chocolate_powder) with realistic `low_stock_threshold` per `BUSINESS_RULES.md` T04 defaults. One starter `inventory_lots` row per item with best-estimate `unit_cost_zar` (research: SA wholesale prices for specialty roasted beans ~R450/kg, full-cream milk ~R28/L, oat milk ~R45/L, macadami milk ~R60/L, 8oz cups ~R1.20, lids ~R0.80, hot chocolate powder ~R180/kg). Each seed write calls `writeAudit({ reason: 'phase2_seed · cost_estimated' })` so admins can find and recost. Recipes: one `recipes` row per menu item version 1, with `recipe_ingredients` keyed to size variants (S espresso: 7g beans, 150ml milk if applicable; L espresso: 9g beans, 240ml milk; etc.). Seed barista as a global recipient in `stock_alert_recipients` (inventory_item_id NULL). Add `bun db:seed:phase2` script that runs additively without disturbing Phase 1 seed. Vitest test: idempotent run; assert seeded counts; assert at least one lot per item has a non-null `unit_cost_zar`.
- **Acceptance criteria:**
  - `bun db:seed:phase2` runs twice with no duplicate-key error
  - Every active `menu_items` row has a corresponding `recipes` row with ≥ 1 `recipe_ingredients` line
  - Every `inventory_items` row has ≥ 1 lot in `state = 'active'` with a non-null cost
  - Migration is reversible (down script tested in CI)
- **Dependency:** Phase 1 complete

---

#### G9 — Stock deduction on `transitionOrder(→ in_progress)`

- **Owner:** Gian
- **Branch:** `feat/g-g9-deduction`
- **PRD sections:** §07 (`transitionOrder`), §08 L01 L08, §10 R5
- **DB tables touched:** `orders` (read), `order_items` (read), `recipe_ingredients` (read), `inventory_lots` (read + state update), `stock_movements` (insert), `audit_log` (insert)
- **Server actions:** modifies `transitionOrder()` from Phase 1 G5
- **Files to create / modify:**
  - `src/server/orders/deduction.ts` — `deductForOrder(orderId, txn)`
  - `src/server/orders/state-machine.ts` — call `deductForOrder` on `ordered → in_progress`
  - `src/server/inventory/lot-picker.ts` — pick the active lot per ingredient (FIFO by `received_at`)
  - `tests/server/deduction.test.ts`
- **Claude prompt:**
  > Read `API.md` (`transitionOrder`), `BUSINESS_RULES.md` (L01, L08), `DATA_MODEL.md` (`stock_movements` append-only), `FAVO_PRD_v3.md` §10 R5. Implement `deductForOrder(orderId, txn)`. For each `order_items` row, resolve its `menu_item_id → recipes → recipe_ingredients`, find the currently-active lot for each `inventory_item_id` (FIFO by `received_at`, `state='active'`), and insert one `stock_movements` row per ingredient with `kind='deduction'`, `delta = -quantity_consumed`, `related_order_id`, `at = now()`, `by_staff_id = session.staffId`. Use `SELECT … FOR UPDATE` on each lot row inside the same transaction to prevent the race in R5. If a lot is exhausted (running total ≤ 0 after this deduction), set `inventory_lots.state = 'depleted'` and promote the next sealed lot to `active`. Every deduction calls `writeAudit({ entityKind: 'inventory_lot', action: 'deduction', before, after })`. Wire `src/server/orders/state-machine.ts` so `ordered → in_progress` runs `deductForOrder` inside the same transaction — failure rolls back the transition. If no active lot is available the transition fails with code `OUT_OF_STOCK` and a useful error. Vitest tests: (a) happy path deducts expected quantities; (b) concurrent transitions on two orders for the same item don't double-spend (use `Promise.all`); (c) OUT_OF_STOCK propagates and rolls back the state change; (d) audit row written per deduction; (e) lot auto-promotes when depleted.
- **Acceptance criteria:**
  - Transitioning a cappuccino S to `in_progress` deducts 7 g beans + 150 ml milk + 1 cup + 1 lid in one txn
  - Concurrency test passes; total deducted matches total consumed
  - `OUT_OF_STOCK` blocks the transition and writes no `stock_movements` rows
  - Every deduction has a matching `audit_log` row
- **Dependency:** G8

---

#### G10 — Server actions: waste + emergency purchase

- **Owner:** Gian
- **Branch:** `feat/g-g10-waste-emergency`
- **PRD sections:** §07 (`logWaste`, purchases), §08 L08 L10
- **DB tables touched:** `waste_log` (insert), `stock_movements` (insert), `purchases` (insert), `inventory_lots` (insert on receipt), `audit_log`
- **Server actions:** `logWaste`, `recordPurchase`, `approveEmergencyPurchase`
- **Files to create / modify:**
  - `src/server/actions/waste.ts` — `logWaste({ category, inventoryLotId, quantity, reason })`
  - `src/server/actions/purchases.ts` — `recordPurchase({ sourceName, kind, items: [...], totalZar })` and `approveEmergencyPurchase(purchaseId)`
  - `tests/server/waste.test.ts`, `tests/server/purchases.test.ts`
- **Claude prompt:**
  > Read `API.md`, `BUSINESS_RULES.md` (L08, L10). Implement `logWaste`: in one transaction insert a `waste_log` row plus a paired `stock_movements` row with `kind='waste'` and `delta = -quantity`. Validate `quantity > 0` and that the lot exists and is `active` or `depleted` (waste can be on depleted lots — e.g. last-of-batch waste). `writeAudit` on both inserts. Implement `recordPurchase`: accepts a list of items, each creating a new `inventory_lots` row with `unit_cost_zar` and `quantity_received`; `purchases.kind` enum is `'standard' | 'emergency'`. **L10:** if `kind='emergency'`, require `session.role in ['admin','owner']` OR insert with `status='pending_admin_approval'` and reject lot creation until `approveEmergencyPurchase` runs. `approveEmergencyPurchase`: admin-only; sets `admin_approved_by`; promotes pending lots to `active`. Validate that money inputs are integer cents. Tests: (a) waste reduces effective stock by the correct quantity; (b) emergency purchase by a barista is held pending; (c) admin approval flips it to active and writes audit; (d) money validation rejects floats.
- **Acceptance criteria:**
  - Waste flow writes one `waste_log` + one `stock_movements` row in one txn
  - Emergency purchase by a non-admin stays pending until admin approves
  - DB CHECK on `purchases.admin_approved_by NOT NULL when kind='emergency' AND status='active'` is enforced
  - ≥ 8 Vitest tests, all green
- **Dependency:** G8, G9

---

#### G11 — Server actions: stock takes

- **Owner:** Gian
- **Branch:** `feat/g-g11-stock-takes`
- **PRD sections:** §07 (`runStockTake`), §08 L08, T01
- **DB tables touched:** `stock_takes`, `stock_take_lines`, `inventory_lots` (variance reconciliation), `stock_movements` (variance adjustment), `audit_log`
- **Server actions:** `runStockTake(kind)`, `recordStockTakeLine(takeId, lotId, counted)`, `closeStockTake(takeId)`
- **Files to create:**
  - `src/server/actions/stock-takes.ts`
  - `src/server/inventory/variance.ts` — `computeVariance(expected, counted)` returns pct and band per T01
  - `tests/server/stock-takes.test.ts`
- **Claude prompt:**
  > Read `API.md`, `BUSINESS_RULES.md` (L08, T01), `FAVO_PRD_v3.md` §06 (stock_takes shape). Implement `runStockTake({ kind })` creating a new row with `started_at = now()` and `by_staff_id = session.staffId`. For each active lot, compute `expected` from a running sum of `stock_movements` deltas (server-side query) and pre-create `stock_take_lines` rows with `counted = null`. `recordStockTakeLine` updates one line's `counted` and recomputes its variance. `closeStockTake` requires every line to have `counted` non-null; computes per-line variance, rolls up to `stock_takes.variance_pct` weighted by lot value, sets `completed_at`. For any variance outside ±5 % (T01) insert a corrective `stock_movements` row with `kind='adjustment'` and `writeAudit({ reason: 'stock_take_variance_adjustment' })`. Admin+ only. Tests: (a) creating a take prefills lines for every active lot; (b) closing before all lines are counted is rejected; (c) variance > 5 % inserts an adjustment row; (d) closed takes are immutable (re-close rejected).
- **Acceptance criteria:**
  - Stock take captures every active lot at creation
  - Close is gated by full coverage
  - Variance band classification matches T01 defaults (0–5 / 5–10 / 10+)
  - Adjustment rows are append-only `stock_movements`
- **Dependency:** G8, G9

---

#### G12 — Server actions: expenses + recipient management

- **Owner:** Gian
- **Branch:** `feat/g-g12-expenses-recipients`
- **PRD sections:** §06 (`expenses`, `stock_alert_recipients`), §07
- **DB tables touched:** `expenses`, `stock_alert_recipients`, `audit_log`
- **Server actions:** `logExpense`, `listExpenses`, `addStockAlertRecipient`, `removeStockAlertRecipient`, `listStockAlertRecipients`
- **Files to create:**
  - `src/server/actions/expenses.ts`
  - `src/server/actions/alert-recipients.ts`
  - `tests/server/expenses.test.ts`
- **Claude prompt:**
  > Read `API.md`, `DATA_MODEL.md` (`expenses`, `stock_alert_recipients`), `BUSINESS_RULES.md` (L08). Implement `logExpense({ category, amountZar, incurredAt })` — admin only. `incurredAt` defaults to `now()` in `Africa/Johannesburg`. Money validated as integer cents. `listExpenses({ from, to, category })` — admin read. `addStockAlertRecipient({ inventoryItemId, staffId })`: `inventoryItemId` nullable = global recipient. UNIQUE on `(inventory_item_id, staff_id)` — reject duplicates. `removeStockAlertRecipient(id)` soft-deletes is not required — hard delete is fine; the cron is fed by current rows only. Every mutation `writeAudit`. Tests: (a) expense with float Rand value rejected; (b) duplicate recipient rejected; (c) barista is 403.
- **Acceptance criteria:**
  - Admin can log and read expenses; barista is 403
  - Recipient list reflects mutations within one txn
  - Audit rows present for every mutation
- **Dependency:** G8

---

#### G13 — `GET /api/cogs/live` + SQL views

- **Owner:** Gian
- **Branch:** `feat/g-g13-cogs-live`
- **PRD sections:** §04 (live COGS criterion), §07 (`GET /api/cogs/live`), §10 R10
- **DB tables touched:** `orders`, `stock_movements`, `inventory_lots`, `expenses` (all read-only)
- **API endpoints:** `GET /api/cogs/live`
- **Files to create:**
  - `drizzle/0003_cogs_views/*` — SQL views: `v_daily_revenue`, `v_daily_cogs`, `v_daily_expenses`, `v_weekly_variance` (the last used by Phase 4 Grafana)
  - `src/app/api/cogs/live/route.ts` — admin-gated handler
  - `src/server/cogs/compute.ts` — `getCogsLive({ tz: 'Africa/Johannesburg' })`
  - `src/server/queue/notify.ts` — add channel `cogs_changes`; G9 and G12 fire pings here on every mutation
  - `tests/server/cogs.test.ts`
- **Claude prompt:**
  > Read `FAVO_PRD_v3.md` §04 §07 §10 R10, `BUSINESS_RULES.md` (L07 — midnight SAST is day boundary). Write SQL views in a Drizzle raw migration. `v_daily_revenue`: `SUM(orders.total_zar) WHERE state IN ('in_progress','ready','collected') AND (placed_at AT TIME ZONE 'Africa/Johannesburg')::date = current SAST day` (parameterise the date). `v_daily_cogs`: `SUM(-stock_movements.delta * inventory_lots.unit_cost_zar) WHERE kind='deduction' AND DATE(at AT TIME ZONE 'Africa/Johannesburg') = ?`. `v_daily_expenses`: SAST-day SUM. Implement `getCogsLive({ date })` returning `{ date, revenue_zar, cogs_zar, expenses_zar, gross_margin_zar, net_zar, profit: boolean, cost_estimated_warning: boolean }`. The warning is true if any lot used in today's COGS has `cost_estimated=true` in its audit history (R10). Implement `GET /api/cogs/live?date=YYYY-MM-DD` — admin only via `getSession()`. Cache-Control: no-store. Add a `pg_notify('cogs_changes', ...)` ping from G9 (deduction) and G12 (expenses) — A7 (Mia) consumes this to refresh the dashboard within 5 s of a mutation per §04. Tests: (a) revenue computed from seeded orders; (b) midnight SAST cuts cleanly; (c) `cost_estimated_warning` flips when a lot is recosted.
- **Acceptance criteria:**
  - `GET /api/cogs/live` returns within 200 ms on staging
  - Placing a test order produces a delta visible on the next request within 1 s
  - Endpoint rejects barista requests with 403
  - Views are migration-reversible
- **Dependency:** G8, G9, G12

---

#### G14 — `checkLowStock` + `generateWeeklyPnL` crons + Discord webhook

- **Owner:** Gian
- **Branch:** `feat/g-g14-crons`
- **PRD sections:** §07, §08 T05 L09, §09 Phase 2 acceptance
- **DB tables touched:** `inventory_items` (read), `stock_alert_recipients` (read), `customers` / `staff.push_subscription`, `orders` `expenses` `stock_movements` (read for weekly), `audit_log`
- **Crons:** `checkLowStock()` every 15 min; `generateWeeklyPnL()` Sun 23:59 SAST
- **Files to create:**
  - `src/server/crons/check-low-stock.ts`
  - `src/server/crons/generate-weekly-pnl.ts`
  - `src/server/discord/webhook.ts` — `pingFavoOps({ title, fields })`
  - `cron.json` or Coolify cron config (per ARCHITECTURAL.md deploy pipeline)
  - `tests/server/crons.test.ts`
- **Claude prompt:**
  > Read `API.md`, `BUSINESS_RULES.md` (T05, L09), `FAVO_PRD_v3.md` §07 §09 §10. `checkLowStock`: every 15 min (T05). Query inventory items where running-stock ≤ `low_stock_threshold` (running-stock = `SUM(stock_movements.delta)` over the active lot). For each tripped item, look up matching `stock_alert_recipients` (both item-specific AND global recipients via `inventory_item_id IS NULL`) and send a Web Push to each recipient's staff `push_subscription`. **Reuse `sendPush` infrastructure from Phase 1 G7** — extend it to accept `recipientType: 'customer' | 'staff'`. Deduplicate: do not re-fire within 60 min for the same item unless stock has dropped further. Track last-fired in a new `low_stock_pings` table (small migration). `writeAudit` per push attempt. `generateWeeklyPnL`: Sun 23:59 SAST. Aggregate revenue, COGS, expenses for the week (Mon 00:00 – Sun 23:59 SAST). Insert into a `weekly_reports` table (small migration — fields: id, week_starting, revenue_zar, cogs_zar, expenses_zar, gross_margin_zar, net_zar, generated_at). On insert, `pingFavoOps` with the week's headline numbers — formatted as a Discord embed. Implement `src/server/discord/webhook.ts` using `DISCORD_WEBHOOK_FAVO_OPS`. Tests: (a) low-stock check fires push for an item below threshold; (b) dedupe blocks a second push within 60 min; (c) weekly cron rolls correctly across week boundaries.
- **Acceptance criteria:**
  - Pulling milk below threshold in staging produces a push to the seeded barista recipient within one cron tick
  - Discord webhook delivers an embed-formatted ping to `#favo-ops` on a manual `generateWeeklyPnL` run
  - Migrations for `low_stock_pings` and `weekly_reports` are reversible
- **Dependency:** G8, G9, G12, Phase 1 G7

---

#### G15 — Monthly P&L admin sign-off

- **Owner:** Gian
- **Branch:** `feat/g-g15-monthly-pnl`
- **PRD sections:** §04 (monthly P&L approval), §06, §07 (`approveMonthlyPnL`), §08 L11
- **DB tables touched:** `monthly_reports` (new), `audit_log`
- **Server actions:** `generateMonthlyPnL`, `approveMonthlyPnL(id)`
- **Files to create:**
  - `drizzle/0004_monthly_reports/*` — table with DB `CHECK (status != 'closed' OR admin_sig IS NOT NULL)`
  - `src/server/actions/monthly-pnl.ts`
  - `tests/server/monthly-pnl.test.ts`
- **Claude prompt:**
  > Read `FAVO_PRD_v3.md` §04 §06 §07, `BUSINESS_RULES.md` (L11). Add `monthly_reports` table: id, month (date — first of month), revenue_zar, cogs_zar, expenses_zar, gross_margin_zar, net_zar, status (enum: draft, closed), admin_sig (jsonb: signer_id + at), generated_at, closed_at. DB CHECK: closed requires admin_sig non-null (L11). Implement `generateMonthlyPnL(month)` admin — produces a draft. `approveMonthlyPnL(id)` — sets admin_sig and immediately transitions to closed with `closed_at = now()`. `writeAudit` on every sig. Tests: (a) closing without admin_sig is DB-blocked; (b) barista cannot sign; (c) double-signing is rejected (sig already set).
- **Acceptance criteria:**
  - DB CHECK is enforced — direct UPDATE to status='closed' without admin_sig fails
  - Approval flow is fully audited
  - Tests cover all RBAC paths
- **Dependency:** G13

---

### Mia — Admin frontend UI/UX

Owns: every Phase 2 admin screen. Builds against GY stubs immediately; swaps to real impls as Gian merges G9–G15.

---

#### A7 — Live COGS dashboard

- **Owner:** Mia
- **Branch:** `feat/a-a7-cogs-dashboard`
- **PRD sections:** §04 (primary success metric), §07 (`GET /api/cogs/live`), §09 Phase 2 acceptance
- **DB tables touched:** none direct
- **Endpoints consumed:** `GET /api/cogs/live`, SSE channel `cogs_changes`
- **Files to create:**
  - `src/app/admin/page.tsx` (replaces Phase 1 placeholder)
  - `src/components/admin/CogsDashboard.tsx`
  - `src/components/admin/KpiTile.tsx` (uses Nikao's N9 primitive)
  - `src/hooks/useCogsLive.ts` — initial fetch + SSE subscription to `cogs_changes`
  - `tests/components/CogsDashboard.test.tsx`
- **Claude prompt:**
  > Read `DESIGN.md`, `API.md`, `FAVO_PRD_v3.md` §04 §09. Replace the Phase 1 admin placeholder with the live COGS dashboard at `/admin`. Top row: four `KpiTile` (N9): Revenue, COGS, Expenses, Net. Margin tile shows a sparkline of the last 14 days from `getCogsLive` repeated per date. Profit tile colour is green/red bound to `net_zar > 0`. Beneath: a banner if `cost_estimated_warning` is true ("Some lot costs are best-estimate — see Inventory") per R10. Use `useCogsLive` to fetch on mount, then subscribe to SSE `cogs_changes`; refetch on each event. The widget must show fresh numbers within 5 s of a barista placing an order (PRD §09 acceptance). Money formatting via `formatZar`. Vitest component test mocks the hook and asserts profit colour flips at `net_zar = 0`.
- **Acceptance criteria:**
  - Dashboard loads within 1 s on staging
  - Placing a test order via POS reflects on the dashboard within 5 s
  - Cost-estimate warning banner appears when applicable
  - Test passes
- **Dependency:** N7, N8, N9, GY (real impl from G13)

---

#### A8 — Inventory management UI (items + lots)

- **Owner:** Mia
- **Branch:** `feat/a-a8-inventory-ui`
- **PRD sections:** §06, §08 (L08, T04)
- **DB tables touched:** `inventory_items` (read), `inventory_lots` (read, edit via action)
- **Server actions consumed:** `listInventory`, `setItemThreshold`, `updateLotCost`, `listLots`
- **Files to create:**
  - `src/app/admin/inventory/page.tsx`
  - `src/components/admin/InventoryTable.tsx`
  - `src/components/admin/LotDrawer.tsx` — view/edit lot cost (R10 recosting)
  - `src/components/admin/ThresholdEditor.tsx`
- **Claude prompt:**
  > Read `DATA_MODEL.md`, `API.md`, `BUSINESS_RULES.md` (T04). Table of inventory items at `/admin/inventory`. Columns: name, kind, current stock, threshold (editable inline via `setItemThreshold`), last-restock-date, low-stock badge (N8). Tapping a row opens a side drawer showing all lots for that item, each with origin, batch_number, roast_date, received_at, state, unit_cost_zar (editable per R10), quantity_received, quantity_remaining (computed client-side from movements). Updating a cost calls `updateLotCost(lotId, newCostZar)` which `writeAudit`s and pings `cogs_changes`. Use shadcn `Table`, `Sheet`, `Input`. Format costs as `R12,50` via `formatZar`. Test: editing a threshold issues one server-action call and updates the table in-place.
- **Acceptance criteria:**
  - All 8 seeded items render with correct stock + threshold + badge
  - Editing a cost flips the dashboard's cost-estimate warning when all lots are recosted
  - Audit row written on every edit
- **Dependency:** A1 (Phase 1 shadcn), A2 (Phase 1 admin shell), N8, GY (real impls from G8 + new server actions in G12)

---

#### A9 — Stock take workflow UI

- **Owner:** Mia
- **Branch:** `feat/a-a9-stock-take`
- **PRD sections:** §07 (`runStockTake`), §08 T01
- **DB tables touched:** none direct
- **Server actions consumed:** `runStockTake`, `recordStockTakeLine`, `closeStockTake`, `listStockTakes`
- **Files to create:**
  - `src/app/admin/stock-takes/page.tsx` — list past + current
  - `src/app/admin/stock-takes/[id]/page.tsx` — walk-lots flow
  - `src/components/admin/StockTakeCounter.tsx` — large numeric input per lot
  - `src/components/admin/VarianceSummary.tsx` — uses N8 variance bands
- **Claude prompt:**
  > Read `API.md`, `BUSINESS_RULES.md` T01, `DATA_MODEL.md`. List view at `/admin/stock-takes` with a "Start weekly take" CTA. New take creates rows via `runStockTake('weekly')` and routes to `/admin/stock-takes/[id]`. That page walks lots one-at-a-time (mobile-friendly — admin counts on a phone). For each lot show name, batch, expected stock, and a giant numeric input for `counted`. Save calls `recordStockTakeLine(takeId, lotId, counted)` and advances. Skip and back buttons. Final screen: variance summary using N8 colour bands (0–5 / 5–10 / 10+); "Close take" triggers `closeStockTake`. Validation: cannot close until every lot has a non-null counted. Money irrelevant here — variance is %. Test: full walkthrough with a fake list of 3 lots ends in a close that calls the server action once.
- **Acceptance criteria:**
  - Admin can complete a take end-to-end on an iPhone viewport
  - Variance bands match T01 colours
  - Close is gated by full coverage
- **Dependency:** A2, N8, GY (real impl from G11)

---

#### A10 — Expense + purchase logging UI

- **Owner:** Mia
- **Branch:** `feat/a-a10-expenses-purchases`
- **PRD sections:** §06 (`expenses`, `purchases`), §08 L10
- **DB tables touched:** none direct
- **Server actions consumed:** `logExpense`, `listExpenses`, `recordPurchase`, `approveEmergencyPurchase`
- **Files to create:**
  - `src/app/admin/expenses/page.tsx`
  - `src/app/admin/purchases/page.tsx`
  - `src/components/admin/ExpenseForm.tsx`
  - `src/components/admin/PurchaseForm.tsx` — emergency toggle with warning
  - `src/components/admin/PendingApprovalsBanner.tsx` — surfaces emergency purchases awaiting admin sign-off
- **Claude prompt:**
  > Read `API.md`, `BUSINESS_RULES.md` (L10), `DATA_MODEL.md`. Expenses page: list table + "New expense" dialog with category select, amount (Rand → cents via `parseZar`), date defaulting to today SAST. Purchases page: list + "Record purchase" dialog. Source name (free text), kind (standard/emergency), then a repeatable line for each lot received with inventory item, quantity, unit cost. **L10 visual gate:** emergency toggle shows a yellow warning "Emergency purchases require admin approval." If a non-admin submits emergency, show toast "Submitted — pending admin approval". A `PendingApprovalsBanner` on every admin page shows count of pending emergency purchases; admins can one-tap approve via `approveEmergencyPurchase`. Money formatting via `formatZar`. Vitest test: parser rejects floats below cent-precision; emergency by non-admin still submits but UI reflects pending state.
- **Acceptance criteria:**
  - Logged expense reflects on COGS dashboard within 5 s
  - Emergency purchase by a non-admin is held; admin sees banner; tapping approves
  - All money inputs are cents under the hood
- **Dependency:** A2, N8, GY (real impl from G10, G12)

---

#### A11 — Recipe management UI

- **Owner:** Mia
- **Branch:** `feat/a-a11-recipes`
- **PRD sections:** §06 (`recipes`, `recipe_ingredients`)
- **DB tables touched:** none direct
- **Server actions consumed:** `getRecipe`, `updateRecipeIngredient`, `bumpRecipeVersion`
- **Files to create:**
  - `src/app/admin/menu/[id]/recipe/page.tsx`
  - `src/components/admin/RecipeEditor.tsx`
- **Claude prompt:**
  > Read `DATA_MODEL.md` (`recipes`, `recipe_ingredients`). Link from the Phase 1 menu page (A5) to a per-item recipe view. Show current ingredients with quantity, unit, tolerance %. Edit-in-place; saving via `updateRecipeIngredient` does not bump version (it's a correction). "New version" button calls `bumpRecipeVersion` — clones the recipe with `version+1`, lets the admin edit before publishing. Future orders use the latest version. Confirm with Gian that these server actions exist in his task list — if not, request `src/server/actions/recipes.ts` as a small sub-task on G8 or open a follow-up. Test: editing a tolerance writes one server-action call and shows a success toast.
- **Acceptance criteria:**
  - Admin can update Cappuccino S beans quantity from 7 g → 8 g
  - New version flow clones and supersedes
  - Audit row written
- **Dependency:** A2, A5 (Phase 1 menu UI), GY

---

#### A12 — Low-stock recipient management UI

- **Owner:** Mia
- **Branch:** `feat/a-a12-recipients`
- **PRD sections:** §06 (`stock_alert_recipients`), §07, §08 T04
- **DB tables touched:** none direct
- **Server actions consumed:** `listStockAlertRecipients`, `addStockAlertRecipient`, `removeStockAlertRecipient`
- **Files to create:**
  - `src/app/admin/inventory/recipients/page.tsx`
  - `src/components/admin/RecipientsEditor.tsx`
- **Claude prompt:**
  > Read `API.md`, `DATA_MODEL.md`. Two-column UI: left = inventory items + a "Global" pseudo-row at top; right = staff list with checkboxes. Toggling a checkbox calls `addStockAlertRecipient` or `removeStockAlertRecipient`. "Global" recipients receive every low-stock alert. Test for the optimistic update: toggle reverts on server error.
- **Acceptance criteria:**
  - Admin can configure recipients per item and globally
  - Toggling is immediate (optimistic) but reconciles on server response
  - Audit rows written per change
- **Dependency:** A2, GY (real impl from G12)

---

#### A13 — Monthly P&L approval UI

- **Owner:** Mia
- **Branch:** `feat/a-a13-monthly-pnl`
- **PRD sections:** §04 (monthly P&L dual approval), §07, §08 L11
- **DB tables touched:** none direct
- **Server actions consumed:** `generateMonthlyPnL`, `approveMonthlyPnL`, `listMonthlyReports`
- **Files to create:**
  - `src/app/admin/reports/monthly/page.tsx`
  - `src/components/admin/MonthlyReportRow.tsx`
  - `src/components/admin/DualSignBlock.tsx`
- **Claude prompt:**
  > Read `FAVO_PRD_v3.md` §04 §08 L11, `API.md`. List monthly reports at `/admin/reports/monthly` — admin read. Columns: month, revenue, COGS, expenses, net, status. "Generate" button visible to admin only — creates a draft for the previous closed month. Per-row sign block: shows admin_sig state with signer name + at, plus a "Sign as Admin" button (visible to admin). Signing immediately closes the report with a green badge. Confirmation modal with the report numbers — irreversible. Test: a barista cannot see the sign button.
- **Acceptance criteria:**
  - Admin sign closes the report; status flips to closed with timestamp
  - DB CHECK in G15 visibly prevents direct edits
- **Dependency:** A2, GY (real impl from G15)

---

### Mine — POS frontend & customer-facing UI

POS-side Phase 2 work: surface inventory state to the barista (low-stock badges, out-of-stock disabling), give them a waste-logging flow, route low-stock pushes to their device, and add a small daily summary.

---

#### M8 — POS waste logging UI

- **Owner:** Mine
- **Branch:** `feat/m-m8-waste-logging`
- **PRD sections:** §07 (`logWaste`), §08 L08, §06 (`waste_log`)
- **DB tables touched:** none direct
- **Server actions consumed:** `logWaste`
- **Files to create:**
  - `src/components/pos/WasteDialog.tsx` — entry from queue card kebab menu and from active-order kebab
  - `src/app/pos/waste/page.tsx` — standalone waste page for non-order waste (dropped cup, broken bag of beans)
- **Claude prompt:**
  > Read `API.md`, `BUSINESS_RULES.md` (L08), `DATA_MODEL.md` (`waste_log`). Add a "Report waste" entry from (a) the active order kebab (M6) — preselects the order's lot via the recipe, (b) the queue card kebab, (c) a standalone `/pos/waste` route from the POS shell. Dialog: category select (dropped, wrong_order, broken, remake, bean_quality_failure), inventory lot select (defaults to relevant active lots), quantity input with unit displayed inline, free-text reason. Submit calls `logWaste`. Toast on success. Test: opening dialog from an active order preselects beans + milk + cup as candidate lots.
- **Acceptance criteria:**
  - All three entry points lead to the same dialog
  - Submitted waste reflects on the COGS dashboard within 5 s
  - Audit row written
- **Dependency:** Phase 1 M6, GY (real impl from G10)

---

#### M9 — POS inventory awareness (low-stock + OOS)

- **Owner:** Mine
- **Branch:** `feat/m-m9-pos-inventory-awareness`
- **PRD sections:** §10 R5 (race), §08 T04
- **DB tables touched:** none direct
- **Server actions consumed:** `listInventoryStatus()` (lightweight summary; request as a sub-task to G12 if missing)
- **Files to create:**
  - `src/components/pos/StockBadge.tsx` — uses N8 colours
  - `src/components/pos/StockBanner.tsx` — POS top-of-screen banner when any item is OOS
  - `src/hooks/useStockStatus.ts` — polls every 30 s + invalidates on SSE `inventory_changes`
- **Claude prompt:**
  > Read `DESIGN.md`, `BUSINESS_RULES.md` (T04). On the order builder (M3) overlay a StockBadge (N8) on each menu tile. If any required ingredient for that item is below threshold show a yellow "Low" badge; if any required ingredient is at zero show a red "Out" badge and disable the tile. Top-of-shell banner: lists items currently out, dismissible per-session. Hook `useStockStatus` polls `listInventoryStatus` every 30 s plus subscribes to SSE channel `inventory_changes` (Gian extends G9 to emit on every stock_movement). Test: setting beans to 0 disables Cappuccino tiles within 1 poll cycle.
- **Acceptance criteria:**
  - Cappuccino tiles grey out when beans stock = 0
  - Banner shows when any required ingredient is OOS
  - Recovery (restock) re-enables tiles within 30 s
- **Dependency:** Phase 1 M3, M5, N8, GY

---

#### M10 — POS low-stock push subscription

- **Owner:** Mine
- **Branch:** `feat/m-m10-pos-push-subscribe`
- **PRD sections:** §05 (Push), §07 (`POST /api/push/subscribe`), §09 Phase 2 acceptance
- **DB tables touched:** none direct (extends Phase 1 G7's subscribe endpoint to staff)
- **API endpoints consumed:** `POST /api/push/subscribe` (with `recipientType: 'staff'`)
- **Files to create:**
  - `src/components/pos/StaffPushOptIn.tsx` — shown once after PIN login if `Notification.permission !== 'granted'`
  - `src/lib/push/staff-subscribe.ts`
- **Claude prompt:**
  > Read `FAVO_PRD_v3.md` §05 §07 §09, Phase 1 N5. Mirror N5's customer push opt-in but for staff. After a barista logs in via PIN, if `Notification.permission !== 'granted'` show a one-time card on the POS home: "Get pinged when stock is low or an order needs attention." On accept, register a PushSubscription and POST to `/api/push/subscribe` with `recipientType: 'staff', staffId: session.staffId`. Confirm with Gian that G7 + G14 extend the endpoint to handle staff. Persist a "asked once" flag in localStorage so the card doesn't re-show every shift; show it again if permission is revoked. Test: opt-in flow calls the API with the staff id.
- **Acceptance criteria:**
  - Staff device receives a low-stock push when an admin manually triggers the cron in staging
  - Card only shows once per device unless permission is revoked
- **Dependency:** Phase 1 G7, G14

---

#### M11 — POS bean-lot indicator

- **Owner:** Mine
- **Branch:** `feat/m-m11-pos-lot-indicator`
- **PRD sections:** §06 (`inventory_lots.origin`), specialty-coffee brand thread
- **DB tables touched:** none direct
- **Server actions consumed:** `getActiveBeanLot()` (request small action from Gian)
- **Files to create:**
  - `src/components/pos/ActiveBeanCard.tsx` — small POS shell tile showing the bean's origin, batch number, and roast date
- **Claude prompt:**
  > Read `DATA_MODEL.md` (`inventory_lots`), `DESIGN.md`. In the POS shell top bar add a small card showing the currently-active espresso bean lot: origin name (e.g. "Yirgacheffe · Konga"), batch number, days since roast (yellow at >14 d per T02). This is a brand-aligned detail — FAVO is specialty-coffee-focused and the barista should know which beans are in the hopper. Confirm `getActiveBeanLot()` exists in `src/server/actions/inventory.ts` — request from Gian if not. Test: a lot 15 days post-roast shows the freshness warning per N8.
- **Acceptance criteria:**
  - Card appears on every POS screen and refreshes on lot promotion (G9)
  - Freshness warning fires correctly per T02
- **Dependency:** Phase 1 M1, N8, GY

---

#### M12 — POS daily summary view

- **Owner:** Mine
- **Branch:** `feat/m-m12-daily-summary`
- **PRD sections:** §07 (`GET /api/cogs/live`), §09
- **DB tables touched:** none direct
- **Endpoints consumed:** `GET /api/cogs/live`
- **Files to create:**
  - `src/app/pos/today/page.tsx`
  - `src/components/pos/TodayCard.tsx`
- **Claude prompt:**
  > Build a `/pos/today` page barista-readable view of today's volume: order count, revenue (read from the same `/api/cogs/live` endpoint Mia uses), waste events count. Big numbers, no charts. Refresh-on-pull on iPad. Test: rendering pulls the endpoint exactly once on mount.
- **Acceptance criteria:**
  - Page loads in under 1 s
  - Numbers match the admin dashboard
- **Dependency:** Phase 1 M1, GY (real data from G13)

---

#### M13 — POS waste shortcut on cancel + remake

- **Owner:** Mine
- **Branch:** `feat/m-m13-cancel-waste-shortcut`
- **PRD sections:** §07 (`cancelOrder`), §08 L02
- **Files to create / modify:** extends M6 (active order view)
- **Claude prompt:**
  > Read `BUSINESS_RULES.md` (L02). When a barista cancels an order via Phase 1 M6, surface an "Also report waste?" prompt. If yes, prefill M8's waste dialog with the order's recipe ingredients and category `wrong_order` or `remake`. The two operations (cancel + waste) are independent server calls — handle partial failure with toasts. Test: cancel without waste leaves no waste rows; cancel with waste produces N waste rows.
- **Acceptance criteria:**
  - Cancel without waste: 0 waste rows
  - Cancel with remake: waste rows for each recipe ingredient
- **Dependency:** Phase 1 M6, M8

---

### Nikao — Data viz, status visual system, report templates, customer PWA polish

Owns: design primitives Mia and Mine consume.

---

#### N7 — Chart primitives + design tokens for data viz

- **Owner:** Nikao
- **Branch:** `feat/n-n7-charts`
- **PRD sections:** §04 (live COGS visualisation), `DESIGN.md`
- **Files to create:**
  - `src/components/shared/charts/Sparkline.tsx`
  - `src/components/shared/charts/BarChart.tsx`
  - `src/components/shared/charts/DonutChart.tsx`
  - `src/lib/charts/tokens.ts` — chart colour palette derived from N1's design tokens
- **Claude prompt:**
  > Read `DESIGN.md` and N1's `src/lib/design-tokens.ts`. Wrap Recharts (already in the artifact-allowed CDN list) in three opinionated components — Sparkline, BarChart, DonutChart — that take typed data and apply FAVO's palette. Each has at least three colour roles (positive, neutral, negative) using semantic tokens. All charts must be accessible: include an ARIA `title` and `desc` summarising the data. Storybook stories for each. Test: rendering with empty data shows an empty-state placeholder, not a crash.
- **Acceptance criteria:**
  - Storybook stories render without console errors
  - Charts respect dark/light mode if Phase 4 adds it later (CSS vars only)
  - Empty data is handled gracefully
- **Dependency:** N1 (Phase 1)

---

#### N8 — Status badge + variance band visual system

- **Owner:** Nikao
- **Branch:** `feat/n-n8-status-system`
- **PRD sections:** §08 T01 T02 T04, `DESIGN.md`
- **Files to create:**
  - `src/components/shared/StatusBadge.tsx` — variants: ok, low, out, fresh, ageing, stale, variance-ok, variance-investigate, variance-critical
  - `src/lib/status/variance-band.ts` — `varianceBand(pct: number)` returns 'ok' | 'investigate' | 'critical' per T01
  - `src/lib/status/freshness.ts` — `freshness(roastDate)` returns 'fresh' | 'ageing' | 'stale' per T02
- **Claude prompt:**
  > Read `BUSINESS_RULES.md` (T01, T02, T04), `DESIGN.md`. Define a status badge component with named variants matching FAVO's domain states. Variant colours pull from semantic tokens (positive/warn/negative). Pure helper functions `varianceBand(pct)` and `freshness(date)` so Mia and Mine compute consistently. Storybook stories per variant. Tests for the helpers: boundary conditions (5.00 %, 5.01 %, 14 d, 15 d).
- **Acceptance criteria:**
  - Variants render with consistent sizing and contrast
  - Helpers' boundaries match T01 / T02 exactly
- **Dependency:** N1

---

#### N9 — Dashboard layout primitives

- **Owner:** Nikao
- **Branch:** `feat/n-n9-dashboard-tiles`
- **PRD sections:** §04, `DESIGN.md`
- **Files to create:**
  - `src/components/shared/dashboard/KpiTile.tsx` — label, big number, sub-label, trend arrow
  - `src/components/shared/dashboard/SparklineTile.tsx`
  - `src/components/shared/dashboard/AlertTile.tsx` — for low-stock and approval banners
  - `src/components/shared/dashboard/TileGrid.tsx` — responsive 4-col → 2-col → 1-col
- **Claude prompt:**
  > Read `DESIGN.md`. Build four primitives Mia drops into the COGS dashboard (A7). KpiTile takes `{ label, valueZar?, valueText?, sub?, trend? }` and uses `formatZar` from N1. SparklineTile wraps N7's Sparkline plus a single value summary. AlertTile takes `{ severity, title, action? }` — severity bound to N8's variant colours. TileGrid is a CSS-grid layout that collapses gracefully. Storybook stories. Test: KpiTile with `valueZar: 12345` renders as `R123,45`.
- **Acceptance criteria:**
  - Tiles compose into a sensible dashboard with no Mia-side custom CSS
  - Grid collapses cleanly between 1024 / 768 / 480 widths
- **Dependency:** N1, N7, N8

---

#### N10 — Print / PDF report template

- **Owner:** Nikao
- **Branch:** `feat/n-n10-report-template`
- **PRD sections:** §07 (`GET /api/reports/export`), §04 (monthly P&L), `DESIGN.md`
- **Files to create:**
  - `src/components/shared/report/MonthlyReportTemplate.tsx` — React component rendered to PDF in Phase 3 via Playwright PDF or similar
  - `src/components/shared/report/Receipt.tsx` — a small receipt template for refund records
  - `src/lib/report/format.ts` — money + date helpers specific to print
- **Claude prompt:**
  > Read `FAVO_PRD_v3.md` §04 §07, `DESIGN.md`. Design React components that render print-clean (A4) for the monthly P&L (used by Phase 3 export) and for refund receipts. No interactivity. Use only semantic tokens; no scripts. The template includes FAVO branding, period, revenue/COGS/expenses/net, admin signature block (signer name + at timestamp). The receipt shows order id, line items, total, refund amount, reason, requested_by, approved_by. Storybook stories with sample data; Playwright snapshot test renders the page and asserts visible strings.
- **Acceptance criteria:**
  - Page renders cleanly in print preview at A4
  - All numbers formatted in ZAR with comma decimal
  - Storybook stories pass visual review
- **Dependency:** N1

---

#### N11 — Customer PWA stock-aware messaging

- **Owner:** Nikao
- **Branch:** `feat/n-n11-customer-stock-messaging`
- **PRD sections:** §02 (problem & why now), §08 L04 L05
- **Files to create / modify:**
  - `src/app/(customer)/menu/page.tsx` — public read-only menu using current stock state
  - `src/components/customer/MenuItemCard.tsx` — variant for out-of-today items
- **Claude prompt:**
  > Read `BUSINESS_RULES.md` (L04 L05). The customer PWA is read-only — but it should reflect today's reality. Build a `/menu` page on the customer surface listing the 5 menu items with current prices and a friendly "Back tomorrow" pill on any item where all required ingredients are at zero (use a small `getPublicMenu()` server action — coordinate with Gian to expose this, read-only, no auth required). Do not say "out of stock" — say "Back tomorrow" or "Sold out for today" depending on whether the item is expected to be restocked. Static export-friendly; works without JS. Test: rendering with a fake stock map produces the right pills.
- **Acceptance criteria:**
  - Customer PWA `/menu` reflects current stock within one poll cycle
  - JS-disabled render still works
  - Tone is hospitable, not transactional
- **Dependency:** N1 (Phase 1), GY (request public read action)

---

## 6. Phase 2 verification — integration walk-through

Run on Sun 31 May evening, after all PRs are in `main`.

| Step | Tool | Owner |
|---|---|---|
| 1. `bun db:migrate && bun db:seed:phase2` against staging | Gian | Gian |
| 2. Admin opens `/admin` — COGS dashboard renders with seeded baseline | Mia | Mia |
| 3. Barista PIN-logs in, places a Cappuccino + Extra Shot, transitions to in_progress | Mine | Mine |
| 4. Confirm `stock_movements` rows exist for beans / milk / cup / lid | Gian (SQL) | Gian |
| 5. COGS dashboard reflects new COGS within 5 s | Mia + Gian | Mia |
| 6. Admin opens Inventory → manually deducts milk lot down to below threshold via stock-take | Mia | Mia |
| 7. Wait for next `checkLowStock` tick (or trigger manually) | Gian | Gian |
| 8. Push notification received on the barista's device within one tick | Mine + Gian | Mine |
| 9. Admin logs an expense (R150 utilities) | Mia | Mia |
| 10. COGS dashboard's Net tile drops by R1.50 within 5 s | Mia | Mia |
| 11. Manually trigger `generateWeeklyPnL` in staging | Gian | Gian |
| 12. Discord ping arrives in `#favo-ops` with the embed | Gian | Gian |
| 13. Admin starts a stock-take, walks 3 lots, closes — variance row inserted; band correct per T01 | Mia | Mia |
| 14. Admin generates a draft monthly P&L; admin signs, status flips to closed | Mia | Mia |
| 15. Audit coverage query returns 0 | Gian (SQL) | Gian |

Codified as Playwright spec `tests/e2e/phase2-acceptance.spec.ts` (owner: Gian).

---

## 7. Quality bars (per PRD §11)

- ≥ 35 Vitest unit tests cumulative (Phase 1 + Phase 2). Of the Phase 2 increment: Gian ~10, Mia ~4, Mine ~3, Nikao ~3.
- ≥ 14 Playwright E2E tests cumulative. Phase 2 adds: order flow with deduction, OUT_OF_STOCK rejection, stock-take walkthrough, COGS live refresh, low-stock push, weekly cron Discord ping, monthly P&L admin sign-off.
- Audit coverage query returns 0 at end of Phase 2.
- No raw card data in any new logging path.

---

## 8. Risk acknowledgements for Phase 2

From PRD §10:

- **R5 (race on concurrent deduction)** — G9 ships `SELECT … FOR UPDATE`. Verified by concurrent-test in `tests/server/deduction.test.ts`.
- **R6 (inventory variance > 15 % in week 1)** — Out of build scope; mitigated operationally by daily admin check-in. We expose the variance numbers (A9) and bands (N8).
- **R10 (COGS inaccurate week 1 — costs not seeded)** — G8 seeds best-estimate costs with `cost_estimated=true` in audit; A8 lets admin recost; A7 surfaces a warning until recosted. Admin gets a one-page checklist post-launch for cost calibration.

---

## 9. Day-by-day cadence

| Day | Hours | What lands |
|---|---|---|
| Sat 30 May AM | 09:00–12:00 | Foundation: G8, GY, N7, N8, N9 in `main` |
| Sat 30 May PM | 13:00–18:00 | G9, G10, G12, A7, A8, A11, M8, N10, N11 in flight |
| Sun 31 May AM | 09:00–13:00 | G11, G13, G14, A9, A10, A12, M9, M10, M11 in flight |
| Sun 31 May PM | 13:00–17:00 | G15, A13, M12, M13 in flight |
| Sun 31 May EVE | 17:00–19:00 | Integration walk-through, Playwright spec, merge gate |

If anything slips into Monday, Phase 3 absorbs it — Phase 3 customer PWA work is mostly independent of Phase 2's admin side.

---

*End of FAVO Café Phase 2 Build Plan.*
