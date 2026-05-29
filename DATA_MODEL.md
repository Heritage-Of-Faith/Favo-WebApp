# Data Model

Schema lives in `db/schema.ts`. Enums in `db/enums.ts`. Migrations in `drizzle/`.
Money: integer cents in columns suffixed `_zar`. Timestamps: `timestamp with time zone`, default `now()`.

## 24 tables

| Table | Purpose | Key columns |
|---|---|---|
| `orders` | Unit of sale | id, customer_id (null=guest), staff_id, state, placed_at, completed_at, total_zar, yoco_payment_id, is_staff_discount |
| `order_items` | Line items | id, order_id, menu_item_id, quantity, unit_price_zar, modifications (jsonb) |
| `menu_items` | Sellable items | id, name, category, active, current_price_zar, recipe_id |
| `menu_customisations` | Per-item mods | id, menu_item_id, name, price_delta_zar |
| `recipes` | Drink definition | id, menu_item_id, version |
| `recipe_ingredients` | Recipe consumption | id, recipe_id, inventory_item_id, quantity, unit, tolerance_pct |
| `inventory_items` | Stock SKUs | id, name, kind, unit, low_stock_threshold, origin |
| `inventory_lots` | Batches | id, inventory_item_id, source_name, batch_number, roast_date, received_at, state |
| `stock_movements` | Stock changes (append-only) | id, inventory_lot_id, delta, kind, related_order_id, at, by_staff_id |
| `stock_takes` | Counts | id, kind, started_at, completed_at, by_staff_id, variance_pct |
| `stock_take_lines` | Per-lot count | id, stock_take_id, inventory_lot_id, expected, counted, variance |
| `stock_alert_recipients` | Low-stock alert routing | id, inventory_item_id (null=global), staff_id |
| `customers` | Registered customers | id, email, name, phone, push_subscription (jsonb), loyalty_points, created_at |
| `loyalty_transactions` | Earn/redeem log (append-only) | id, customer_id, order_id, delta, kind, at |
| `staff` | Staff accounts | id, name, role, pin_hash, active |
| `staff_entitlement_log` | Free coffee claims | id, staff_id, applied_by_staff_id, order_id, day · **UNIQUE(staff_id, day)** |
| `payments` | Yoco transactions | id, order_id, yoco_payment_id, amount_zar, status, webhook_received_at |
| `refunds` | Refund records | id, order_id, amount_zar, reason, requested_by, approved_by, status |
| `waste_log` | Waste events | id, category, inventory_lot_id, quantity, reason, by_staff_id, at |
| `purchases` | Stock buys | id, source_name, inventory_lot_id, received_at, total_zar, kind, admin_approved_by |
| `operating_hours` | Display-only hours | id, day_of_week, open_time, close_time, is_closed, note |
| `expenses` | Non-stock costs | id, category, amount_zar, incurred_at, logged_by |
| `price_history` | Price changes (append-only) | id, menu_item_id, price_zar, effective_from, effective_until |
| `audit_log` | All-mutation log (append-only) | id, entity_kind, entity_id, action, actor_id, actor_role, at, before (jsonb), after (jsonb), reason |

## Enums (in `db/enums.ts`)
`order_state` · `staff_role` · `menu_category` · `inventory_kind` · `inventory_unit` · `lot_state` · `stock_movement_kind` · `stock_take_kind` · `payment_status` · `refund_status` · `waste_category` · `purchase_kind` · `expense_category` · `loyalty_kind`

## Append-only invariants
| Table | Mechanism |
|---|---|
| `audit_log` | Trigger denies UPDATE + DELETE forever |
| `stock_movements` | Policy: INSERT-only |
| `loyalty_transactions` | Policy: INSERT-only |
| `price_history` | Policy: INSERT-only |

Void by inserting a follow-up row, never by edit.

## RLS summary
| Role | Access |
|---|---|
| customer | SELECT own `orders`, `loyalty_transactions`. No writes. |
| barista | RW orders, order_items, waste_log, staff_entitlement_log. RO customers(name, phone). No DELETE. |
| admin | + price_history, operating_hours, stock_alert_recipients, refund approval, emergency purchase approval, monthly_reports admin_sig |
| finance | SELECT-only except `monthly_reports.finance_sig` |
| owner | admin + finance |

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
