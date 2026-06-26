# Data Model

Schema lives in `db/schema.ts`. Enums in `db/enums.ts`. Migrations in `drizzle/`.
Money: integer cents in columns suffixed `_zar`. Timestamps: `timestamp with time zone`, default `now()`.

## 34 tables

Wave 1/2 tables are live on `main`. Wave 3 tables (marked below) landed in the loyalty + wallet + packs vertical.

| Table | Purpose | Key columns |
|---|---|---|
| `orders` | Unit of sale | id, customer_id (null=guest), staff_id, state, placed_at, completed_at, total_zar, yoco_payment_id, is_staff_discount, payment_mode |
| `order_items` | Line items | id, order_id, menu_item_id, quantity, unit_price_zar, modifications (jsonb) |
| `menu_items` | Sellable items | id, name, category, active, current_price_zar, recipe_id |
| `menu_customisations` | Per-item mods | id, menu_item_id, name, price_delta_zar |
| `recipes` | Drink definition | id, menu_item_id, version |
| `recipe_ingredients` | Recipe consumption | id, recipe_id, inventory_item_id, quantity, unit, tolerance_pct |
| `inventory_items` | Stock SKUs | id, name, kind, unit, low_stock_threshold, origin |
| `inventory_lots` | Batches / containers | id, inventory_item_id, source_name, batch_number, roast_date, received_at, state, opened_at, closed_at, unit_cost_zar (numeric, rate only), quantity_received |
| `stock_movements` | Stock changes (append-only) | id, inventory_lot_id, delta, kind, related_order_id, at, by_staff_id |
| `stock_takes` | Counts | id, kind, started_at, completed_at, by_staff_id, variance_pct |
| `stock_take_lines` | Per-lot count | id, stock_take_id, inventory_lot_id, expected, counted, variance |
| `stock_alert_recipients` | Low-stock alert routing | id, inventory_item_id (null=global), staff_id |
| `customers` | Registered customers | id, auth_id, email, name, phone, push_subscription (jsonb), loyalty_points, wallet_zar (CHECK >= 0), created_at |
| `loyalty_transactions` | Earn/redeem log (append-only) | id, customer_id, order_id, delta, kind, at |
| `staff` | Staff accounts | id, name, role, pin_hash, active, push_subscription (jsonb) |
| `staff_entitlement_log` | Free coffee claims | id, staff_id, applied_by_staff_id, order_id, day · **UNIQUE(staff_id, day)** |
| `payments` | Yoco transactions | id, order_id, yoco_checkout_id, yoco_payment_id (UNIQUE), amount_zar, status, webhook_received_at |
| `refunds` | Refund records | id, order_id, amount_zar, reason, requested_by, approved_by, status |
| `waste_log` | Waste events | id, category, inventory_lot_id, quantity, reason, by_staff_id, at |
| `purchases` | Stock buys | id, source_name, inventory_lot_id, received_at, total_zar, kind, admin_approved_by, status |
| `operating_hours` | Display-only hours | id, day_of_week, open_time, close_time, is_closed, note |
| `expenses` | Non-stock costs | id, category, amount_zar, incurred_at, logged_by |
| `price_history` | Price changes (append-only) | id, menu_item_id, price_zar, effective_from, effective_until |
| `audit_log` | All-mutation log (append-only) | id, entity_kind, entity_id, action, actor_id, actor_role, at, before (jsonb), after (jsonb), reason |
| `monthly_reports` | Monthly P&L with admin sign-off | id, month (UNIQUE, YYYY-MM-DD), revenue_zar, cogs_zar, expenses_zar, gross_margin_zar, net_zar, status, admin_sig (jsonb), generated_at, closed_at |
| `low_stock_pings` | Low-stock push dedup log | id, inventory_item_id, staff_id, fired_at, stock_at_fire |
| `weekly_reports` | Weekly P&L archival | id, week_starting (UNIQUE, ISO Monday), revenue_zar, cogs_zar, expenses_zar, gross_margin_zar, net_zar, generated_at |
| `pending_charges` | Yoco checkout intent for wallet top-ups + coffee packs | id, yoco_checkout_id (UNIQUE), kind, customer_id, amount_zar, status, metadata (jsonb), created_at |
| `coffee_packs` | Prepaid drink packs (90-day expiry) | id, customer_id, menu_item_id, qty_original, qty_remaining, expires_at, pending_charge_id, created_at |
| `pack_redemptions` | Pack drink redemption log (append-only, reversals via reversed_at) | id, pack_id, customer_id, order_id, order_line_ref, redeemed_at, reversed_at |
| `wallet_transactions` | Wallet ledger (append-only) | id, customer_id, delta_zar (signed cents), kind, related_order_id, related_pending_charge_id, description, at |
| `sync_conflicts` | Offline sync conflict log | id, kind, order_id, client_payload (jsonb), server_state (jsonb), status, opened_at, resolved_at, resolved_by, resolution_note |
| `outbox_log` | Offline POS order queue | id, client_uuid (UNIQUE), customer_id, staff_id, payload (jsonb), received_at, applied_at, conflict_id |
| `magic_link_tokens` | Customer email auth tokens | id, email, token_hash (UNIQUE), expires_at, used_at |

### Container model (milk & beans)
Milk and beans are tracked as **physical containers** (bottles/bags), not by ml/g.
Each container is one `inventory_lots` row with `unit='cup'` on its item:
- **Lifecycle** via `lot_state`: `active` (sealed/on-shelf) → `open` (in use) → `closed` (finished). At most one `open` container per item, enforced by partial unique index `uq_one_open_lot_per_item (inventory_item_id) WHERE state='open'`.
- `quantity_received` = expected cups the container yields; `unit_cost_zar` = cost per cup (container cost ÷ expected cups); opening `restock` movement = +expected cups.
- Each coffee inserts one `stock_movements` row `delta=-(drinks)`, `kind='deduction'` against the open container (recipe quantity ignored for cup items). Cups made by a container = `-SUM(delta WHERE kind='deduction')`.
- Closing a container early writes a COGS-neutral `kind='adjustment'` to zero leftover cups. COGS is unchanged: `v_daily_cogs` sums `-delta × unit_cost_zar`.
- Cups, lids, syrups and other items keep the per-unit/gram recipe deduction.

## Enums (in `db/enums.ts`)
`order_state` · `staff_role` · `menu_category` · `inventory_kind` · `inventory_unit` (g·kg·ml·l·unit·bag·**cup**) · `lot_state` (active·depleted·expired·quarantined·**open**·**closed**) · `stock_movement_kind` · `stock_take_kind` · `payment_status` · `refund_status` · `waste_category` · `purchase_kind` · `expense_category` · `loyalty_kind` · `charge_kind` · `wallet_txn_kind` · `sync_conflict_kind` · `sync_conflict_status`

### Loyalty enum values (AT-126 verified)
- `loyalty_kind`: `earn` · `redeem` · `adjustment` · `expiry`
- `wallet_txn_kind`: `topup` · `spend` · `refund` · `adjustment`

## Append-only invariants
| Table | Mechanism |
|---|---|
| `audit_log` | Trigger denies UPDATE + DELETE forever |
| `stock_movements` | Policy: INSERT-only |
| `loyalty_transactions` | Policy: INSERT-only |
| `price_history` | Policy: INSERT-only |
| `wallet_transactions` | Policy: INSERT-only |
| `pack_redemptions` | INSERT-only; reversals via `reversed_at` (null → timestamp) |

Void by inserting a follow-up row (or setting `reversed_at`), never by delete.

## RLS summary
| Role | Access |
|---|---|
| customer | SELECT own `orders`, `loyalty_transactions`. No writes. |
| barista | RW orders, order_items, waste_log, staff_entitlement_log. RO customers(name, phone). No DELETE. |
| admin | + price_history, operating_hours, stock_alert_recipients, refund approval, emergency purchase approval, monthly_reports admin_sig, all financial reports |

Tenant isolation: every row keyed/policied to `tenant_id = 'hofmi'` (PRD L13).

## Audit helper (required on every mutation)
```ts
import { writeAudit } from '@/server/audit'
await writeAudit({
  entityKind, entityId, action,
  actorId, actorRole,
  before, after, reason
})
```
Failure to write audit must fail the transaction.

## Money + time conventions
- Columns suffixed `_zar` are integer **cents**. Never `numeric`.
- Wall-clock semantics in `Africa/Johannesburg`. Storage in `timestamp with time zone`.
- Midnight SAST is revenue day boundary (PRD L07).
