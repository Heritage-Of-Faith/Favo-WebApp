# FAVO Café — Phase 3 Build Plan

**Phase:** P3 · Customer PWA + Loyalty + Offline Mode
**Dates:** Days 5–6 · Mon 1 – Tue 2 Jun 2026
**WI:** `HOFMI-FAVO-P3`
**Repo:** `github.com/hofmi-ai/favo`
**Default branch:** `main`
**Reference docs (every dev reads before starting):** `CLAUDE.md`, `DESIGN.md`, `ARCHITECTURAL.md`, `DATA_MODEL.md`, `API.md`, `BUSINESS_RULES.md`, `PLANNING.md`, `FAVO_PRD_v3.md`

Phases 1 and 2 have shipped and are merged to `main`. Phase 3 builds on top of: full order flow with deduction, audit, SSE, live COGS, low-stock alerts, monthly P&L.

---

## 1. Phase 3 acceptance test (from PRD §09)

> Customer receives magic link, logs in, sees last 3 orders and 45 loyalty points. Barista redeems 100 pts for customer — order total becomes R0. WAN cable unplugged for 30 minutes, 5 orders taken via IndexedDB — all reconcile on reconnect with no data loss.

Plus the locked rules that activate this phase:

- L05 — customer PWA stays read-only
- L06 — loyalty: 5 pts per R10, min 100 to redeem, 100 pts = R20, full redemption only
- L16 — wallet top-ups + coffee packs are counter-only; packs expire 90 days

Plus the risk mitigated this phase:

- R3 — offline sync conflict resolution (LWW + flagged in `sync_conflicts`, admin resolves daily)

---

## 2. Team & load distribution

| Dev | Phase 3 task count | Why this shape |
|---|---|---|
| **Gian** | 7 | New schema (wallets, packs, sync), customer auth, sync endpoint, exports, loyalty wiring |
| **Nikao** | 6 | Customer surface is the bulk of Phase 3: real login, dashboard, push, wallet/packs view |
| **Mine** | 6 | POS gains the Service Worker + outbox, plus loyalty / wallet / packs counter flows |
| **Mia** | 5 | Admin surface lighter this phase: hours editor, exports UI, customer admin, sync conflict resolution |

Total: 24 tasks. Lighter than Phase 2 (was 26) — most of the user-visible work is on the customer side and is Nikao's natural ownership.

---

## 3. Branching, CI, merge order

Same conventions as Phases 1–2:

- Branch: `feat/<initial>-<task-id>-<kebab-name>`
- Squash-merge to `main` with `[HOFMI-FAVO-P3] {ID} — {title}`
- CI gate: `bun typecheck` · `bun lint` · `bun test:unit`
- Playwright (`bun test:e2e:ci`) required for: G19 (loyalty), G20 (sync), M14 (offline outbox), the full Phase 3 acceptance spec

### Foundation — lands in `main` Mon morning before parallel work starts

| Order | Task | Why first |
|---|---|---|
| 1 | **G16** — Magic link auth (Auth.js Email provider) | Unblocks every customer-facing screen Nikao builds |
| 2 | **G17** — New schema: `wallets`, `wallet_transactions`, `coffee_packs`, `pack_redemptions`, `sync_conflicts`, `outbox_log` + cost columns | Required by G18, G19, G20, all wallet/pack UI |
| 3 | **GZ** — Server-action signature stubs for new actions (typed fixtures: `redeemLoyalty`, `topUpWallet`, `purchasePack`, `listCustomerOrders`, `getCustomerSummary`, `submitOutbox`, `listSyncConflicts`, `resolveSyncConflict`, `exportReport`) | UI devs build N13/N16/M14/M16/M17/M18/A15/A16/A17/A18 in parallel from day one |

No new design tokens required — Phase 1 N1, Phase 2 N7/N8/N9 still apply.

After these three PRs land (target: Mon 10:00), everything below runs in parallel.

---

## 4. Dependency graph

```
G16 (magic link) ──┬─► N12 (customer login)
                   ├─► N13 (customer dashboard)
                   └─► N14 (real push opt-in, replaces N5 staging stub)

G17 (schema) ──┬─► G18 (wallet + packs server actions)
                ├─► G19 (loyalty earn/redeem)
                ├─► G20 (sync endpoint + conflict flagging)
                └─► G21 (exports — reads from existing tables + new)

GZ (stubs) ──► all UI tasks (M*, A*, N*)

G19 (redeemLoyalty) ──► M18 (POS redemption flow)
G18 (wallet/packs) ──► M16, M17 (POS flows) + N17 (customer view)
G20 (sync endpoint) ──► M14 (POS Service Worker + outbox) + A18 (admin conflicts UI)
G21 (exports + N10 template from P2) ──► A15 (admin exports UI)
G22 (hours actions) ──► A14 (admin hours editor) — N4/N11 from earlier phases display
```

After Mon morning foundation: no dev waits on any other dev.

---

## 5. Developer cards

---

### Gian — Backend & server logic

Owns: customer auth, new schema, server actions for loyalty/wallet/packs/sync, exports endpoint, ops cron extensions.

---

#### G16 — Customer magic link auth

- **Owner:** Gian
- **Branch:** `feat/g-g16-magic-link`
- **PRD sections:** §05 (Auth — email magic link), §07, §08 L05
- **DB tables touched:** `customers` (insert on first login), `audit_log`
- **Server actions / endpoints:** Auth.js Email provider on customer surface; `requestMagicLink(email)`, `verifyMagicLink(token)` (Auth.js handles these)
- **Files to create / modify:**
  - `src/auth.ts` — add Email provider scoped to `/customer/*` routes only
  - `src/server/email/magic-link.ts` — uses Resend or a transactional SMTP via env (`RESEND_API_KEY` — add to ARCHITECTURAL.md)
  - `src/app/api/auth/[...nextauth]/route.ts` — wire the provider
  - `src/lib/auth/customer-session.ts` — `getCustomerSession()` returning `{ customerId, email } | null`
  - `middleware.ts` — extend Phase 1 gate: customer surface allowed if `customerSession` exists OR the route is public (landing, /menu)
  - `tests/auth/magic-link.test.ts`
- **Claude prompt:**
  > Read `ARCHITECTURAL.md`, `FAVO_PRD_v3.md` §05 §07 §08 L05. Extend Phase 1 Auth.js v6 with an Email provider scoped to customer routes. On first link click, upsert a `customers` row by email (name + phone are collected after first login via a `/customer/setup` page — Nikao's N12). Token TTL 15 min, single-use. Use Resend if available, otherwise nodemailer over a transactional SMTP — read provider config from env. Send a plain-text + HTML email using Nikao's brand tokens. `getCustomerSession()` returns a typed session keyed on `customerId`. Update `middleware.ts`: customer surface is gated behind `customerSession` for `/customer/dashboard`, `/customer/wallet`, etc.; landing and `/menu` remain public. Audit row on every link request and every successful verify. Tests: (a) link request creates a token row; (b) expired token rejected; (c) reused token rejected; (d) new email creates a customer row on first verify.
- **Acceptance criteria:**
  - End-to-end magic link flow works in staging (real email)
  - Single-use + 15-min TTL enforced
  - Audit rows present
- **Dependency:** Phase 1 G4 (Auth.js base)

---

#### G17 — Schema: wallets, packs, sync conflicts, outbox log

- **Owner:** Gian
- **Branch:** `feat/g-g17-loyalty-schema`
- **PRD sections:** §06 (extends), §08 L06 L16, §10 R3
- **DB tables touched:** new — `wallets`, `wallet_transactions`, `coffee_packs`, `pack_redemptions`, `sync_conflicts`, `outbox_log`, `magic_link_tokens`
- **Files to create:**
  - `drizzle/0005_phase3_schema/*`
  - `db/schema.ts` — add new tables
  - `db/enums.ts` — `wallet_txn_kind` (topup, spend, refund), `pack_status` (active, depleted, expired), `sync_conflict_kind` (duplicate_order, state_collision, payment_mismatch), `sync_conflict_status` (open, resolved)
- **Claude prompt:**
  > Read `DATA_MODEL.md`, `BUSINESS_RULES.md` (L06 L16), `FAVO_PRD_v3.md` §10 R3. Add tables: `wallets` (id, customer_id UNIQUE, balance_zar integer cents default 0, updated_at). `wallet_transactions` (id, wallet_id, delta_zar signed integer, kind enum, related_order_id nullable, related_payment_id nullable, at, by_staff_id) — append-only by RLS policy. `coffee_packs` (id, customer_id, menu_item_id, qty_total, qty_remaining, purchase_price_zar, purchased_at, expires_at — set to `now() + 90 days` on insert per L16, status enum). `pack_redemptions` (id, coffee_pack_id, order_id, redeemed_at) — append-only. `sync_conflicts` (id, kind enum, order_id nullable, client_payload jsonb, server_state jsonb, status enum, opened_at, resolved_at nullable, resolved_by nullable, resolution_note). `outbox_log` (id, client_uuid UNIQUE, customer_id nullable, staff_id, payload jsonb, received_at, applied_at nullable, conflict_id nullable). `magic_link_tokens` (id, email, token_hash, expires_at, used_at nullable) for G16. RLS: customer reads own `wallets`, `wallet_transactions`, `coffee_packs`. Barista writes wallet_transactions on counter ops. Admin reads/resolves sync_conflicts. Audit triggers extend to new tables. Tests assert append-only behaviour on the new append-only tables.
- **Acceptance criteria:**
  - Migration applies cleanly + has working down script
  - RLS denies a customer reading another customer's wallet
  - UPDATE/DELETE on `wallet_transactions`, `pack_redemptions` rejected by policy
- **Dependency:** Phase 1 G1, G2

---

#### G18 — Server actions: wallet top-up + coffee pack purchase

- **Owner:** Gian
- **Branch:** `feat/g-g18-wallet-packs`
- **PRD sections:** §07 (`topUpWallet`, `purchasePack`), §08 L16, §10 R8
- **DB tables touched:** `wallets`, `wallet_transactions`, `coffee_packs`, `pack_redemptions`, `payments`, `audit_log`
- **Server actions:** `topUpWallet(customerId, amountZar)`, `purchasePack(customerId, menuItemId, qty)`, `redeemFromPack(orderId, packId)`, `getWalletBalance(customerId)`, `listCustomerPacks(customerId)`
- **Files to create:**
  - `src/server/actions/wallet.ts`
  - `src/server/actions/packs.ts`
  - `src/server/yoco/intent.ts` — extend to support `intentKind: 'order' | 'wallet_topup' | 'pack_purchase'` carried in metadata
  - `src/app/api/payments/yoco/webhook/route.ts` — extend Phase 1 webhook to dispatch on `intentKind`
  - `tests/server/wallet.test.ts`, `tests/server/packs.test.ts`
- **Claude prompt:**
  > Read `API.md`, `BUSINESS_RULES.md` (L16), `FAVO_PRD_v3.md` §07 §10 R8. `topUpWallet({ customerId, amountZar })`: barista-only; creates a Yoco intent with metadata `intentKind: 'wallet_topup', customerId`. The webhook handler (extended from Phase 1 G6) reads `intentKind` and, on `success`, in one txn inserts `wallet_transactions(delta = +amount, kind='topup')` and updates `wallets.balance_zar`. **Idempotency:** keep keying on `yoco_payment_id` per R8 — repeated webhooks no-op. `purchasePack({ customerId, menuItemId, qty })`: barista-only; Yoco intent with metadata `intentKind: 'pack_purchase'`. On webhook success insert `coffee_packs` with `qty_total = qty_remaining = qty`, `expires_at = now() + interval '90 days'` (L16), price = qty × current menu price. `redeemFromPack({ orderId, packId })`: validate pack belongs to order's customer, is `active`, not expired, has `qty_remaining > 0`, and the order contains a line item matching `pack.menu_item_id`. Decrement `qty_remaining`; if 0, flip to `depleted`. Insert `pack_redemptions` and set the matching order line's `unit_price_zar = 0`. Every mutation `writeAudit`. Tests: (a) duplicate webhook is no-op; (b) expired pack rejected; (c) pack mismatched to order item rejected; (d) wallet balance computed from txns equals stored balance after replay.
- **Acceptance criteria:**
  - Wallet top-up: Yoco test card → wallet credits within 2 s of webhook
  - Pack purchase: lot created with `expires_at` exactly 90 days out (SAST)
  - Redemption: line price set to 0; pack qty decrements
- **Dependency:** G17, Phase 1 G6 (Yoco webhook)

---

#### G19 — Loyalty earn (on ready) + redemption

- **Owner:** Gian
- **Branch:** `feat/g-g19-loyalty`
- **PRD sections:** §07 (`redeemLoyalty`, `transitionOrder` loyalty hook), §08 L06, §09 Phase 3 acceptance
- **DB tables touched:** `customers` (loyalty_points), `loyalty_transactions` (append-only), `orders`, `audit_log`
- **Server actions:** `redeemLoyalty(customerId, orderId)`; modifies `transitionOrder()` from Phase 1 G5 + Phase 2 G9
- **Files to create / modify:**
  - `src/server/loyalty/accrual.ts` — `accrueForOrder(orderId, txn)` called from state machine on `ready`
  - `src/server/actions/loyalty.ts` — `redeemLoyalty`
  - `src/server/orders/state-machine.ts` — extend Phase 1/2 transitions to call `accrueForOrder`
  - `tests/server/loyalty.test.ts`
- **Claude prompt:**
  > Read `API.md`, `BUSINESS_RULES.md` (L06), `FAVO_PRD_v3.md` §07 §09. `accrueForOrder(orderId, txn)`: if `order.customer_id` is non-null and `order.is_staff_discount = false` and the order's total is > 0 (skip free orders), compute points = `floor(total_zar / 1000) * 5` (R10 of cents = 1000 cents → 5 pts per L06). In one transaction insert `loyalty_transactions(delta = +points, kind='earn', order_id)` and `UPDATE customers SET loyalty_points = loyalty_points + points`. Wire this into the state machine so `transitionOrder(_, 'ready')` runs it — same transaction as the existing `sendOrderReadyPush()` from Phase 1 G7. `redeemLoyalty({ customerId, orderId })`: barista-only. Validate `customer.loyalty_points >= 100` (L06 minimum). Insert `loyalty_transactions(delta = -100, kind='redeem')` and decrement `customers.loyalty_points`. Set `orders.total_zar = 0` and mark the redemption in the order's audit row. **Full redemption only** per L06 — no partial. `writeAudit` on both. Tests: (a) order of R45 earns 20 pts (4 × R10 × 5); (b) order of R8 earns 0 pts (rounds down); (c) staff discount order earns 0 pts; (d) free order earns 0 pts; (e) redeem with 99 pts rejected; (f) redeem applied → order total = 0; (g) idempotency: re-running accrual for the same order is a no-op.
- **Acceptance criteria:**
  - Acceptance walk-through: 9 orders of ~R50 each → 45 loyalty points
  - Redemption sets order total to R0 and decrements points by 100
  - No double-accrual on transition retries
- **Dependency:** G17, Phase 1 G5, Phase 2 G9

---

#### G20 — Offline sync: outbox endpoint + LWW + conflict flagging

- **Owner:** Gian
- **Branch:** `feat/g-g20-sync-endpoint`
- **PRD sections:** §05 (Offline POS), §09 Phase 3 acceptance, §10 R3
- **DB tables touched:** `outbox_log`, `orders`, `payments`, `sync_conflicts`, `audit_log`
- **Endpoints:** `POST /api/sync/orders` (batch), `POST /api/sync/orders/[clientUuid]/reconcile` (single retry)
- **Files to create:**
  - `src/app/api/sync/orders/route.ts`
  - `src/server/sync/apply-outbox.ts` — `applyOutboxItem(item)` with LWW
  - `src/server/sync/conflict.ts` — `flagConflict({ kind, item, serverState })`
  - `tests/server/sync.test.ts`
- **Claude prompt:**
  > Read `FAVO_PRD_v3.md` §05 §09, `BUSINESS_RULES.md` (L08), §10 R3. Accept `POST /api/sync/orders` with body `{ items: OutboxItem[] }`. Each `OutboxItem`: `{ clientUuid, clientWrittenAt, payload: CreateOrderInput, paymentMode: 'yoco_deferred' | 'wallet_spend' }`. Apply each item: (1) idempotency: if `outbox_log.client_uuid` exists with `applied_at` non-null, return success (no-op per R3); (2) otherwise insert `outbox_log` row and attempt to create the order via the existing Phase 1 `createOrder` path. For `paymentMode='yoco_deferred'`, mark the order with `state='ordered'` and `payments.status='deferred'`; downstream cron retries Yoco. For `wallet_spend`, debit the customer's wallet inside the same txn — if balance insufficient, flag `sync_conflicts(kind='payment_mismatch')` and leave the order in `ordered` for manual resolution. **LWW:** if an order already exists with the same `clientUuid` (re-sync after partial success), compare `clientWrittenAt` — apply only if newer than `orders.placed_at`. Otherwise flag `state_collision`. Every flagged conflict writes an `audit_log` row per R3. Return per-item result `{ clientUuid, status: 'applied' | 'duplicate' | 'conflict', conflictId? }`. Tests: (a) replaying 5 items twice creates 5 orders, not 10; (b) wallet underfunded flags conflict, no debit, no order; (c) LWW collision flagged correctly; (d) batch of 100 items finishes in < 3 s on staging.
- **Acceptance criteria:**
  - 5-item batch reconciles in < 1 s; 100-item batch < 3 s
  - Re-sending the same batch is a full no-op (acceptance test "no data loss")
  - Every conflict produces an `audit_log` row + a `sync_conflicts` row
- **Dependency:** G17, Phase 1 G5, Phase 1 G6

---

#### G21 — Report exports: CSV + PDF

- **Owner:** Gian
- **Branch:** `feat/g-g21-exports`
- **PRD sections:** §07 (`GET /api/reports/export`), §09 Phase 3 scope
- **DB tables touched:** `orders`, `stock_movements`, `inventory_lots`, `expenses`, `weekly_reports`, `monthly_reports` (all read-only)
- **Endpoints:** `GET /api/reports/export?format=csv|pdf&kind=sales|cogs|inventory|monthly_pnl&from=YYYY-MM-DD&to=YYYY-MM-DD`
- **Files to create:**
  - `src/app/api/reports/export/route.ts`
  - `src/server/reports/sales-csv.ts`, `cogs-csv.ts`, `inventory-csv.ts`
  - `src/server/reports/pdf-renderer.ts` — renders Nikao's N10 template via Playwright PDF (server-side)
  - `tests/server/exports.test.ts`
- **Claude prompt:**
  > Read `API.md`, `FAVO_PRD_v3.md` §07 §09, and Nikao's N10 from Phase 2. Implement the export route. CSV: stream rows via `text/csv; charset=utf-8` with a BOM so Excel opens it cleanly. Headers per kind — sales: order_id, placed_at SAST, customer, total_zar (formatted as ZAR), state. COGS: date, revenue, cogs, expenses, net. Inventory: lot_id, item, origin, qty_remaining, last_movement_at. Monthly P&L: as per `monthly_reports`. PDF: render Nikao's N10 React template inside a headless Chromium via Playwright (`@playwright/test`'s `chromium.launch().newPage().setContent(...).pdf()`), A4, FAVO branding. Auth: admin only. Audit row per export request. Tests: (a) CSV row count matches a SQL count; (b) PDF size > 1 KB; (c) barista request 403; (d) date range validation.
- **Acceptance criteria:**
  - Admin downloads CSV — opens cleanly in Excel/Numbers with ZAR formatting intact
  - Admin downloads PDF — A4, branded, signed-block visible for monthly P&L
  - Audit row per export
- **Dependency:** G17, Phase 2 N10 (template), Phase 2 G15 (monthly_reports)

---

#### G22 — Operating hours admin server actions + Yoco-deferred retry cron

- **Owner:** Gian
- **Branch:** `feat/g-g22-hours-deferred-retry`
- **PRD sections:** §07, §08 L04, §10 R2
- **DB tables touched:** `operating_hours`, `orders`, `payments`, `audit_log`
- **Server actions:** `getOperatingHours`, `setOperatingHours(rows)`; cron `retryDeferredPayments()` every 5 min
- **Files to create:**
  - `src/server/actions/hours.ts` — extends Phase 1's read-only version with write
  - `src/server/crons/retry-deferred-payments.ts`
- **Claude prompt:**
  > Read `BUSINESS_RULES.md` (L04), `FAVO_PRD_v3.md` §07 §10 R2. `setOperatingHours(rows)`: admin+ only; upsert by `day_of_week`. **Per L04, this is display-only.** Never use these values to gate any order — comment explicitly to that effect. Audit row per change. `retryDeferredPayments` cron every 5 min: query `payments` where `status='deferred'`, attempt a fresh Yoco call (read Yoco SDK from Phase 1 G6). On success transition `payments.status='success'`. On 3rd consecutive failure flag the order in `sync_conflicts(kind='payment_mismatch')` for manual reconciliation. Audit row per attempt. Tests: (a) writing hours never affects order creation; (b) deferred → success → audit row.
- **Acceptance criteria:**
  - Admin can set hours; customer PWA (N15) reflects within one fetch
  - Deferred payments retry and resolve in staging
- **Dependency:** Phase 1 G6, G17

---

### Nikao — Customer PWA, customer-facing flows

Owns: the entire customer surface. Phase 1 left stubs (N5, N6); Phase 3 replaces them with the real thing.

---

#### N12 — Customer login + setup (real magic link)

- **Owner:** Nikao
- **Branch:** `feat/n-n12-customer-login`
- **PRD sections:** §05, §09 Phase 3 acceptance
- **DB tables touched:** none direct (calls Auth.js)
- **Files to create / modify:**
  - `src/app/(customer)/login/page.tsx` — replaces Phase 1 N6 placeholder
  - `src/app/(customer)/login/check-email/page.tsx`
  - `src/app/(customer)/setup/page.tsx` — name + phone capture on first login
  - `src/components/customer/MagicLinkForm.tsx`
- **Claude prompt:**
  > Read `DESIGN.md`, `FAVO_PRD_v3.md` §05 §09, and Phase 2 N7/N8/N9 if any UI primitives apply. Build a real customer login page: single email input, "Send me a link" CTA. On submit, call Auth.js `signIn('email', { email })` from G16 and route to `/customer/login/check-email`. The check-email page is a friendly "We sent a link to {email} — open it on this device to log in" with a copy-link helper for the demo. After successful verification, if `customer.name` is null, route to `/customer/setup` to collect name + phone (phone is what POS searches on per Phase 1 M2). Once setup is complete route to `/customer/dashboard` (N13). All flows render with JS for the form submit but the structural shell still renders without JS. Vitest tests for form validation; Playwright covered later in acceptance spec.
- **Acceptance criteria:**
  - End-to-end: enter email → receive link → click → land on setup → enter name + phone → land on dashboard
  - Phone number captured is searchable from POS within 1 s
- **Dependency:** G16, Phase 1 N1

---

#### N13 — Customer dashboard (orders + loyalty)

- **Owner:** Nikao
- **Branch:** `feat/n-n13-customer-dashboard`
- **PRD sections:** §07 (`getCustomerSummary`, `listCustomerOrders`), §09 Phase 3 acceptance
- **DB tables touched:** none direct
- **Server actions consumed:** `listCustomerOrders(limit=10)`, `getCustomerSummary` (loyalty pts, wallet balance, active packs)
- **Files to create:**
  - `src/app/(customer)/dashboard/page.tsx`
  - `src/components/customer/OrderHistoryList.tsx`
  - `src/components/customer/LoyaltyCard.tsx` — uses Phase 2 N9's KpiTile shape
  - `src/components/customer/PackList.tsx`
  - `src/components/customer/WalletCard.tsx`
- **Claude prompt:**
  > Read `API.md`, `DESIGN.md`, and Phase 2 N7/N8/N9. Build `/customer/dashboard` (auth-gated by `getCustomerSession`). Top: a row of three cards — Loyalty Points (with a small progress bar to next R20 redemption), Wallet Balance, Active Packs. Below: a list of the customer's last 10 orders with date/time (SAST), line items, total, and state. Empty states for first-time customers ("Your first order is on us — say hi at the counter!" copy approved per brand voice; or fall back to "No orders yet"). Format money with `formatZar`. Read-only — no buttons that mutate (L05). The acceptance spec verifies "sees last 3 orders and 45 loyalty points" — make sure the loyalty card prominently displays the integer.
- **Acceptance criteria:**
  - Loads in < 1 s on staging
  - Loyalty points number is the largest single element on the loyalty card
  - JS-disabled render shows the same content (server component)
- **Dependency:** G16, GZ (real from G19, G18)

---

#### N14 — Real customer push opt-in (replaces N5 staging stub)

- **Owner:** Nikao
- **Branch:** `feat/n-n14-customer-push`
- **PRD sections:** §05 (Push), §07 (`POST /api/push/subscribe`), §04 (push delivery within 10 s)
- **DB tables touched:** `customers.push_subscription`
- **Endpoints consumed:** `POST /api/push/subscribe`
- **Files to create / modify:**
  - `src/components/customer/PushOptIn.tsx` — replaces Phase 1 N5's staging-flagged variant
  - `src/app/(customer)/dashboard/page.tsx` — surfaces the opt-in if permission not granted
  - Remove the `NEXT_PUBLIC_STAGING` branch from N5
- **Claude prompt:**
  > Read `FAVO_PRD_v3.md` §04 §05 §07 and Phase 1 N5. The Phase 1 stub used a staging-only customer-id form because magic link auth wasn't live. Magic link is now real (G16) — remove the staging branch and gate the opt-in card on the authenticated `customerSession.customerId`. On `Notification.permission !== 'granted'`, show the card on the dashboard. Granting permission calls `POST /api/push/subscribe` with `{ customerId, subscription }`. Persist a per-device "asked once" flag so it doesn't re-show every visit; re-show if permission gets revoked. Vitest test that mocks `Notification.requestPermission` and asserts the POST shape.
- **Acceptance criteria:**
  - Granting permission stores the subscription against the right `customer_id`
  - The acceptance walk-through's push step (next order ready → push within 10 s) works against a real device
  - Staging-only stub is fully removed
- **Dependency:** G16, Phase 1 G7

---

#### N15 — Customer-side operating hours + open-now indicator

- **Owner:** Nikao
- **Branch:** `feat/n-n15-hours-display`
- **PRD sections:** §06, §08 L04
- **DB tables touched:** `operating_hours` (read)
- **Files to modify:**
  - `src/components/shared/OperatingHours.tsx` (extends Phase 1 N4)
  - `src/app/(customer)/dashboard/page.tsx` — embed the hours block
  - `src/app/(customer)/menu/page.tsx` — already extended in Phase 2 N11
- **Claude prompt:**
  > Read `BUSINESS_RULES.md` (L04) and Phase 1 N4. The base `OperatingHours` component already exists and computes "open now". For Phase 3, surface it prominently on the customer dashboard and refine the "open now / opens at HH:MM" copy. The text must never imply that the system blocks ordering based on time — it is informational only.
- **Acceptance criteria:**
  - Open-now indicator correct against synthetic clock
  - Copy never implies a system-level time gate
- **Dependency:** Phase 1 N4

---

#### N16 — Customer PWA Service Worker (push + cache)

- **Owner:** Nikao
- **Branch:** `feat/n-n16-customer-sw`
- **PRD sections:** §05 (PWA, Push), §09 Phase 3
- **Files to create:**
  - `src/app/sw.ts` (or `public/sw.js`) — push event handler + minimal cache strategy for landing/dashboard shells
  - `src/lib/sw/register.ts` — registers the SW on first customer-app load
- **Claude prompt:**
  > Read `FAVO_PRD_v3.md` §05 §09. Add a Service Worker scoped to the customer surface. Responsibilities: (1) receive `push` events and call `self.registration.showNotification(payload.title, { body, icon, data: { url } })`; (2) on `notificationclick` open or focus a window at `payload.data.url`; (3) cache landing + dashboard shells with a stale-while-revalidate strategy for installability. **Do not** cache POST endpoints or auth tokens. Register the SW from `src/lib/sw/register.ts` on the first authenticated customer page load. The POS Service Worker (M14) is separate and must not collide with this scope. Test: a manual `web-push` send from staging fires the local notification.
- **Acceptance criteria:**
  - Push notification visually appears on a real Android Chrome device within 10 s of a `ready` transition
  - Lighthouse PWA score ≥ 90
  - Service Worker scoped to `/customer/*` and `/` — does not register under `/pos/*`
- **Dependency:** Phase 1 N2, G16

---

#### N17 — Customer wallet + packs view (read-only)

- **Owner:** Nikao
- **Branch:** `feat/n-n17-customer-wallet-packs`
- **PRD sections:** §08 L05 L16, §09 Phase 3
- **DB tables touched:** none direct
- **Server actions consumed:** `getWalletBalance`, `listCustomerPacks`, `listWalletTransactions`
- **Files to create:**
  - `src/app/(customer)/wallet/page.tsx`
  - `src/app/(customer)/packs/page.tsx`
  - `src/components/customer/WalletTransactionList.tsx`
  - `src/components/customer/PackDetailCard.tsx`
- **Claude prompt:**
  > Read `BUSINESS_RULES.md` (L05 L16), `API.md`. Customer surface stays read-only per L05 — these pages display, never mutate. Wallet page: current balance (big), list of recent transactions (top-up vs spend with sign + date SAST). Packs page: each active pack shows item name, qty_remaining of qty_total, expires-in countdown (red when < 7 days). Expired packs visible in a collapsed "Expired" section. Copy reminds the customer that top-ups + packs are added at the counter (no in-app purchase per L16). Format money via `formatZar`. Empty states.
- **Acceptance criteria:**
  - Wallet balance matches the value computed from `wallet_transactions` deltas
  - Pack expiry countdown correct against SAST
  - No mutation entry points anywhere
- **Dependency:** G18

---

### Mine — POS frontend: Service Worker, offline outbox, counter flows

POS gains the heavyweight Phase 3 infra: Service Worker + IndexedDB outbox + sync UI. Plus barista-facing counter flows for loyalty redemption, wallet top-up, and pack purchase.

---

#### M14 — POS Service Worker + IndexedDB outbox

- **Owner:** Mine
- **Branch:** `feat/m-m14-pos-offline`
- **PRD sections:** §05 (Offline POS), §09 Phase 3 acceptance, §10 R3
- **DB tables touched:** none direct (server side is G20)
- **Endpoints consumed:** `POST /api/sync/orders`
- **Files to create:**
  - `src/app/pos/sw.ts` — separate SW scoped to `/pos/*`
  - `src/lib/pos/outbox.ts` — `idb`-backed queue
  - `src/lib/pos/sync.ts` — `flushOutbox()` triggered on `online` event + manual button
  - `src/state/connectivity.ts` — Zustand store for connectivity state
- **Claude prompt:**
  > Read `FAVO_PRD_v3.md` §05 §09 §10 R3, `ARCHITECTURAL.md`. Add a POS-only Service Worker scoped to `/pos/*` — must not collide with Nikao's N16 customer SW. The SW caches the POS shell + menu page for offline reads. When `createOrder` is invoked and `navigator.onLine === false`, route the write to an IndexedDB outbox (`idb` library) instead of the server: store `{ clientUuid: uuid v4, clientWrittenAt: Date.now() SAST, payload, paymentMode }`. The Phase 1 order builder (M3) must transparently use the same store — if online, hit the server; if offline, write to outbox and return a synthetic order id the queue board (M5) can render with a "queued" badge. On `window 'online'` event AND on manual "Sync now" button, call `flushOutbox()`: batch the outbox via `POST /api/sync/orders` (G20), interpret per-item results, remove `applied` + `duplicate` from the queue, leave `conflict` for admin (A18) and show a Sonner warning. Connectivity store reflects the queue length. **Acceptance per PRD §09:** WAN out 30 min, 5 orders queued, reconcile cleanly on reconnect with zero loss. Vitest tests for the outbox + a Playwright test that simulates offline with `context.setOffline(true)`.
- **Acceptance criteria:**
  - Drill: WAN off 30 min → 5 orders queued → WAN on → all 5 reconcile in < 3 s with zero loss and zero duplicates
  - Conflict items remain in the local queue with a clear status
  - SW does not interfere with normal online flow (verified by Phase 1 acceptance spec re-run)
- **Dependency:** Phase 1 M3, G20

---

#### M15 — POS offline indicator + sync status UI

- **Owner:** Mine
- **Branch:** `feat/m-m15-pos-sync-ui`
- **PRD sections:** §05, §09
- **Files to create:**
  - `src/components/pos/ConnectivityPill.tsx` — top bar of POS shell
  - `src/components/pos/SyncDrawer.tsx` — opens on tap; shows queued orders + Sync-now button
- **Claude prompt:**
  > Build the connectivity pill (uses Phase 2 N8 colour bands: green = online + empty queue; yellow = online + queued; red = offline). Tap opens a side drawer listing queued orders with timestamp, total, and a per-item retry button. "Sync now" calls M14's `flushOutbox()`. Show progress toast during sync. Vitest test: queue length reflects in the pill within one render.
- **Acceptance criteria:**
  - Pill state matches connectivity + queue length within 300 ms
  - Drawer lists queued items in chronological order
- **Dependency:** M14

---

#### M16 — POS wallet top-up flow

- **Owner:** Mine
- **Branch:** `feat/m-m16-pos-wallet-topup`
- **PRD sections:** §07 (`topUpWallet`), §08 L16
- **DB tables touched:** none direct
- **Server actions consumed:** `topUpWallet`, `getWalletBalance`
- **Files to create:**
  - `src/components/pos/WalletTopUpDialog.tsx` — opened from active-order or from customer detail in M18
  - `src/components/pos/AmountKeypad.tsx` — Rand-entry numeric pad
- **Claude prompt:**
  > Read `API.md`, `BUSINESS_RULES.md` (L16). Dialog accessible from (a) the customer card in the order builder (M3) and (b) the customer detail view inside M18. Show current balance, an amount keypad for the top-up amount (preset chips: R50, R100, R200, R500), and a "Charge" CTA that calls `topUpWallet` and presents Phase 1's Yoco hosted-fields screen (M4) with `intentKind='wallet_topup'`. On success show new balance. Counter-only entry per L16 — no in-app top-up surfaces in the customer PWA. Test: keypad parses to integer cents.
- **Acceptance criteria:**
  - Top-up of R200 with test card → wallet shows new balance + R200,00
  - Customer PWA wallet page (N17) reflects within next fetch
- **Dependency:** Phase 1 M3, M4, G18

---

#### M17 — POS coffee pack purchase flow

- **Owner:** Mine
- **Branch:** `feat/m-m17-pos-packs`
- **PRD sections:** §07 (`purchasePack`), §08 L16
- **DB tables touched:** none direct
- **Server actions consumed:** `purchasePack`, `listCustomerPacks`
- **Files to create:**
  - `src/components/pos/PackPurchaseDialog.tsx`
  - `src/components/pos/PackRedeemPicker.tsx` — shown in order builder when customer has eligible active packs
- **Claude prompt:**
  > Read `API.md`, `BUSINESS_RULES.md` (L16). Pack purchase dialog: select coffee item (must be `category='coffee'`) and qty (default 10). Show total price = qty × current item price, expiry date (today + 90 d in SAST), and a Yoco Charge CTA (intentKind='pack_purchase'). PackRedeemPicker: in the order builder (M3), if the selected customer has any `active` pack whose `menu_item_id` matches a line item, show a one-tap "Redeem from pack" option per matching line. Calls `redeemFromPack` from G18; sets line price to 0 and updates pack qty in the UI optimistically. Test: redemption removes the line cost from the running total.
- **Acceptance criteria:**
  - Pack of 10 Americanos creates a `coffee_packs` row with `expires_at = today + 90 d SAST`
  - Redeem decrements `qty_remaining` and zeroes the line
- **Dependency:** Phase 1 M3, M4, G18

---

#### M18 — POS loyalty redemption flow

- **Owner:** Mine
- **Branch:** `feat/m-m18-pos-loyalty-redeem`
- **PRD sections:** §07 (`redeemLoyalty`), §08 L06, §09 Phase 3 acceptance
- **DB tables touched:** none direct
- **Server actions consumed:** `redeemLoyalty`, `getCustomerSummary`
- **Files to create / modify:**
  - `src/components/pos/CustomerCard.tsx` — extend M2 selection card to show loyalty pts + wallet balance + active packs
  - `src/components/pos/LoyaltyRedeemDialog.tsx`
- **Claude prompt:**
  > Read `API.md`, `BUSINESS_RULES.md` (L06), `FAVO_PRD_v3.md` §09 acceptance. Extend the Phase 1 customer selection (M2) to show: loyalty pts, wallet balance, active pack count. On the order builder (M3), if `customer.loyalty_points >= 100`, show a "Redeem 100 pts (R20 off)" button — only enabled when the running total is ≥ R20 (so we don't redeem on a R5 espresso; PRD permits but barista intuition is the gate). **Full redemption only per L06.** The dialog confirms, calls `redeemLoyalty(customerId, orderId)`, sets order total to R0 in the UI, decrements local points by 100. Sonner toast: "100 pts redeemed — R20 off". Test: button disabled at 99 pts; enabled at 100.
- **Acceptance criteria:**
  - Acceptance walk-through: 45-pt customer cannot redeem; 100-pt customer can; order total becomes R0
  - No partial redemption path anywhere
- **Dependency:** Phase 1 M2, M3, G19

---

#### M19 — POS offline-mode UX polish

- **Owner:** Mine
- **Branch:** `feat/m-m19-pos-offline-polish`
- **PRD sections:** §05, §09
- **Files to create / modify:**
  - `src/components/pos/OfflineBanner.tsx`
  - `src/app/pos/order/pay/page.tsx` — extend Phase 1 M4 to support deferred payment mode when offline
  - `src/components/pos/DeferredPaymentNotice.tsx`
- **Claude prompt:**
  > Read `FAVO_PRD_v3.md` §05 §10 R2. When the POS is offline, show a calm yellow banner at the top: "Working offline · {queue length} pending · Sync resumes when WAN returns." On the payment screen (M4), if offline, replace the Yoco hosted-fields with a "Take payment in person" notice and a confirmation that the order will queue with `paymentMode='yoco_deferred'`. The deferred retry cron (G22) clears these when WAN returns. Test: offline payment screen calls outbox.queue with the deferred mode.
- **Acceptance criteria:**
  - Offline order is queueable without Yoco
  - Banner accurate and dismissible per session
  - Reconnect → cron retries → payment status flips to `success` or to `sync_conflicts`
- **Dependency:** M14, Phase 1 M4, G22

---

### Mia — Admin frontend: hours, exports, customer admin, sync conflicts

---

#### A14 — Operating hours editor

- **Owner:** Mia
- **Branch:** `feat/a-a14-hours-editor`
- **PRD sections:** §06 (`operating_hours`), §08 L04
- **DB tables touched:** none direct
- **Server actions consumed:** `getOperatingHours`, `setOperatingHours`
- **Files to create:**
  - `src/app/admin/hours/page.tsx`
  - `src/components/admin/HoursEditor.tsx`
- **Claude prompt:**
  > Read `BUSINESS_RULES.md` (L04). Build a simple weekly editor at `/admin/hours`. Seven rows (Mon–Sun); per row: is_closed toggle, open_time, close_time, note. Save calls `setOperatingHours` with the full week. Inline copy clarifies that these values are display-only and never gate orders (L04). Test: toggling Sunday "closed" persists and reflects on customer PWA dashboard (N15) within next fetch.
- **Acceptance criteria:**
  - Admin saves → customer PWA reflects within 5 s
  - Inline copy mentions "display only — orders are never refused based on time"
- **Dependency:** Phase 1 A2, G22

---

#### A15 — Report exports UI

- **Owner:** Mia
- **Branch:** `feat/a-a15-reports-exports`
- **PRD sections:** §07, §09 Phase 3 scope
- **DB tables touched:** none direct
- **Endpoints consumed:** `GET /api/reports/export`
- **Files to create:**
  - `src/app/admin/reports/page.tsx`
  - `src/components/admin/ReportExportForm.tsx`
- **Claude prompt:**
  > Read `API.md`. Build an exports page at `/admin/reports`. Form: kind (sales / COGS / inventory / monthly P&L), date range, format (CSV / PDF). Submit triggers a download (set `target="_blank"` or use a hidden anchor — server returns appropriate Content-Disposition). Admin only. After a successful download show "Exported {kind} ({format})". Test: form submit hits the right URL.
- **Acceptance criteria:**
  - Admin can access; barista 403
  - All four kinds × two formats download successfully against staging
- **Dependency:** Phase 1 A2, G21

---

#### A16 — Customer admin (list + detail)

- **Owner:** Mia
- **Branch:** `feat/a-a16-customer-admin`
- **PRD sections:** §06 (`customers`), §05 (RLS), §07
- **DB tables touched:** `customers` (read; admin RLS)
- **Server actions consumed:** `listCustomers(query, page)`, `getCustomerDetail(id)` — request from Gian if not in GZ
- **Files to create:**
  - `src/app/admin/customers/page.tsx`
  - `src/app/admin/customers/[id]/page.tsx`
  - `src/components/admin/CustomerTable.tsx`
- **Claude prompt:**
  > Read `DATA_MODEL.md`, `API.md`. Build the customer admin list at `/admin/customers` with search by name or email. Detail page shows: contact, loyalty points history, wallet balance + transactions, active + expired packs, recent orders. Read-only — no edits in Phase 3 (POPIA-friendly: no admin tooling to mutate customer data without an audit-heavy flow). Confirm `listCustomers` and `getCustomerDetail` exist in Gian's GZ. Test: search "Louis" returns 1 row.
- **Acceptance criteria:**
  - Loads 100 customers in < 1 s
  - Detail page surfaces wallet / loyalty / packs accurately
- **Dependency:** Phase 1 A2, G16, G18, G19, GZ

---

#### A17 — Customer wallet + loyalty admin view (extends A16)

- **Owner:** Mia
- **Branch:** `feat/a-a17-customer-balances-admin`
- **PRD sections:** §08 L06 L16
- **Files to modify:** `src/app/admin/customers/[id]/page.tsx`, `src/components/admin/CustomerBalanceTabs.tsx`
- **Claude prompt:**
  > Extend A16's customer detail page with tabbed sub-views: Orders · Loyalty (transactions) · Wallet (transactions) · Packs (active + expired). Each tab pulls from the corresponding list action. Money formatted via `formatZar`. No mutation surfaces — L06 and L16 are barista-only.
- **Acceptance criteria:**
  - Tabs load lazily; switching is instant after first load
  - Numbers reconcile against the customer PWA dashboard (N13)
- **Dependency:** A16

---

#### A18 — Sync conflicts viewer + resolution

- **Owner:** Mia
- **Branch:** `feat/a-a18-sync-conflicts`
- **PRD sections:** §10 R3
- **DB tables touched:** `sync_conflicts` (read/update via action), `audit_log`
- **Server actions consumed:** `listSyncConflicts`, `resolveSyncConflict(id, note)`
- **Files to create:**
  - `src/app/admin/sync-conflicts/page.tsx`
  - `src/components/admin/ConflictRow.tsx` — JSON diff of `client_payload` vs `server_state` using Phase 1 A6's diff helper
- **Claude prompt:**
  > Read `FAVO_PRD_v3.md` §10 R3 and Phase 1 A6's diff renderer. List open conflicts with kind badge (N8 colour bands map: payment_mismatch=red, state_collision=yellow, duplicate_order=neutral). Detail panel: diff of `client_payload` vs `server_state`, plus a resolution note input and "Mark resolved" button (calls `resolveSyncConflict`). Status badge updates on resolve. Audit row written by the server action — confirmed in G20. Test: marking resolved removes the row from the open list and adds it to "Resolved this week".
- **Acceptance criteria:**
  - Conflicts surfaced within 5 s of being flagged by G20
  - Resolution writes an audit row
  - JSON diff renders cleanly
- **Dependency:** Phase 1 A2, A6, G20

---

## 6. Phase 3 verification — integration walk-through

Run on Tue 2 Jun evening, after all PRs are in `main`.

| Step | Tool | Owner |
|---|---|---|
| 1. `bun db:migrate && bun db:seed:phase3` against staging | Gian | Gian |
| 2. New customer enters email at `/customer/login`; receives magic link in inbox | Nikao | Nikao |
| 3. Clicks link → setup page → enters name "Louis" + phone | Nikao | Nikao |
| 4. Lands on `/customer/dashboard` — sees 0 orders, 0 pts | Nikao | Nikao |
| 5. Customer grants push permission on real device | Nikao | Nikao |
| 6. Barista PIN-logs in, places 9 orders of ~R50 each for Louis (via POS) | Mine + Gian | Mine |
| 7. After each `ready` transition, loyalty pts auto-accrue | Gian | Gian |
| 8. Customer dashboard refresh → 45 pts visible | Nikao | Nikao |
| 9. Barista tops up Louis's wallet by R200 (M16) → wallet shows R200,00 | Mine | Mine |
| 10. Barista buys Louis a pack of 10 Americanos (M17) → pack visible with 90-day expiry | Mine | Mine |
| 11. Place a 10th order — earn another 5 pts → 50 total (still under redeem threshold) | All | Gian |
| 12. Adjust Louis to 100 pts (admin tool, manual SQL is fine for the drill) | Gian | Gian |
| 13. Barista redeems 100 pts on next order (M18) → order total = R0 | Mine | Mine |
| 14. **Offline drill:** disable WAN on POS for 30 min, take 5 orders (deferred payment) | Mine | Mine |
| 15. Re-enable WAN → outbox flushes; 5 orders appear server-side; deferred retry cron clears payments | Mine + Gian | Gian |
| 16. Re-trigger sync to verify idempotency: 5 orders, not 10 | Mine | Mine |
| 17. Admin opens `/admin/sync-conflicts` — confirms zero open conflicts | Mia | Mia |
| 18. Admin opens `/admin/reports`, downloads sales CSV + monthly PDF | Mia | Mia |
| 19. Admin opens `/admin/hours`, sets Sunday closed → customer PWA reflects | Mia | Mia |
| 20. Audit coverage query returns 0 | Gian (SQL) | Gian |

Codified as Playwright spec `tests/e2e/phase3-acceptance.spec.ts` (owner: Gian).

---

## 7. Quality bars (per PRD §11)

- ≥ 50 Vitest unit tests cumulative across all phases. Of the Phase 3 increment: Gian ~10, Mine ~5, Nikao ~4, Mia ~3.
- ≥ 20 Playwright E2E tests cumulative. Phase 3 adds: magic link login, loyalty earn over multiple orders, full redemption, wallet top-up, pack purchase + redemption, offline drill, sync idempotency, conflict resolution, CSV + PDF export round-trip.
- Audit coverage query returns 0 at end of Phase 3.
- POPIA: customer PII (email, phone) never appears in logs.

---

## 8. Risk acknowledgements for Phase 3

From PRD §10:

- **R2 (Yoco outage during peak)** — G22's `retryDeferredPayments` + M19's deferred-payment notice + M14's outbox flow together implement the "deferred payment" path. Verified by step 14 of the walk-through.
- **R3 (offline sync conflict)** — G20's LWW + `sync_conflicts` table + A18's resolution UI. Verified by step 15-17.
- **R4 (push non-delivery)** — POS queue board (Phase 1 M5) remains the primary signal; customer PWA dashboard (N13) shows order state as fallback. Customer can ask at counter.

---

## 9. Day-by-day cadence

| Day | Hours | What lands |
|---|---|---|
| Mon 1 Jun AM | 09:00–12:00 | Foundation: G16, G17, GZ in `main` |
| Mon 1 Jun PM | 13:00–18:00 | G18, G19, G20, N12, N13, M16, M17, A14, A15 in flight |
| Tue 2 Jun AM | 09:00–13:00 | G21, G22, N14, N15, N16, M14, M15, A16, A17 in flight |
| Tue 2 Jun PM | 13:00–17:00 | N17, M18, M19, A18 in flight |
| Tue 2 Jun EVE | 17:00–19:00 | Integration walk-through (incl. 30-min offline drill), Playwright spec, merge gate |

If anything slips into Wednesday, Phase 4 is QA + deploy — Wednesday morning can absorb a small carry-over before the noon ship window.

---

*End of FAVO Café Phase 3 Build Plan.*
