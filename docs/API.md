# API Surface

Server Actions for mutations (`src/server/actions/*`). Route handlers for queries + webhooks. SSE for the live POS queue.

| Endpoint / Action | Kind | Auth | Behaviour |
|---|---|---|---|
| `loginWithPin(pin)` | Server action | public | Bcrypt-compare against `staff.pin_hash`. Emit session on success. Audit row in both branches. |
| `searchCustomer(query)` | Server action | barista | ILIKE name + exact phone. Returns id, name, phone, loyalty_points. |
| `createOrder(input)` | Server action | barista | Insert order in `ordered`. Returns id + Yoco payment intent. **No stock deduction.** |
| `transitionOrder(id, toState)` | Server action | barista | State machine: ordered→in_progress→ready→collected. `in_progress` deducts stock: milk/beans = 1 cup per drink from the open container (auto-opens next sealed); other items = recipe quantity. `ready` fires Web Push + accrues loyalty + pg_notify. |
| `cancelOrder(id, reason)` | Server action | barista/admin | Valid only when state == ordered; 409 otherwise. |
| `applyStaffDiscount(orderId, beneficiaryStaffId)` | Server action | barista | Cappuccino + weekday only. 100% off. Inserts `staff_entitlement_log` (UNIQUE per day). |
| `POST /api/payments/yoco/webhook` | Route handler | HMAC | Verify `YOCO_WEBHOOK_SECRET`. Idempotent on `yoco_payment_id`. |
| `GET /api/queue/stream` | SSE | barista | `LISTEN order_changes`. Heartbeat every 30 s. Client auto-reconnects. |
| `GET /api/cogs/live` | Route handler | admin | Live revenue, COGS, expenses, margin, profit flag. |
| `logWaste(input)` | Server action | barista | Insert `waste_log` + `stock_movements(kind='waste')` atomically. |
| `runStockTake(kind)` | Server action | admin+ | Create `stock_takes`; walk `active`+`open` lots; compute variance on close. |
| `openContainer(itemId)` | Server action | barista/admin | Container model (milk/beans): open the FIFO-oldest sealed container. 409 if one already open, 404 if none sealed. |
| `closeContainer(lotId)` | Server action | barista/admin | Close an open container; leftover cups written off with a COGS-neutral `adjustment`. 404 if the lot doesn't exist; 409 unless open. |
| `listOpenContainers()` | Server action | barista/admin | Per cup-item: the open container + sealed count. Drives the POS open-containers card. |
| `checkLowStock()` | Cron 15 m | system | Push to `stock_alert_recipients` when stock ≤ threshold. |
| `requestRefund(orderId, reason)` | Server action | any staff | Insert pending refund. |
| `approveRefund(id)` | Server action | admin | Trigger Yoco refund. Full amount only. |
| `setMenuItemPrice(id, priceZar)` | Server action | admin | Close current `price_history` row; insert new. |
| `redeemLoyalty(customerId, orderId)` | Server action | barista | Require ≥ 100 pts. Full redemption only — `total_zar = 0`. |
| `topUpWallet(customerId, amountZar)` | Server action | barista | Yoco intent; webhook credits wallet. |
| `purchasePack(customerId, menuItemId, qty)` | Server action | barista | Yoco intent; on success insert `coffee_packs` (90 d expiry). |
| `closeDaily()` | Cron 23:59 SAST | system | Reconcile payments vs stock. Block + Discord ping on mismatch. |
| `generateWeeklyPnL()` | Cron Sun 23:59 | system | Archival report + Discord ping. |
| `approveMonthlyPnL(id)` | Server action | admin | Set admin_sig. Report closed immediately. |
| `GET /api/reports/export?format=csv\|pdf` | Route handler | admin | Sales, COGS, inventory variance. |
| `POST /api/push/subscribe` | Route handler | barista (P1) → customer (P3) | Store `PushSubscription` on customer. |

## Conventions
- All actions use `"use server"`.
- Inputs validated with **Zod** at entry. Return tagged unions: `{ ok: true, data } | { ok: false, code, message }`.
- Every mutation calls `writeAudit()` from `src/server/audit.ts`. Failure to audit fails the transaction.
- RBAC checked server-side via `getSession()` (`src/lib/auth/session.ts`). UI is advisory only.
- Concurrency: state transitions use `SELECT … FOR UPDATE` to avoid races.
- Idempotency: webhooks key on provider id (e.g. `yoco_payment_id`); duplicate payload is a no-op.
- Never log/echo PAN, CVV, expiry — not in Loki, Raindrop, audit, or anywhere.

## Shared types
`src/lib/types.ts` is the single source of truth for cross-layer shapes: `Order`, `OrderState`, `OrderItem`, `MenuItem`, `MenuCustomisation`, `Customer`, `Staff`, `StaffRole`, `YocoPaymentIntent`, `QueueEvent`.

## SSE payload shape
```ts
type QueueEvent =
  | { type: 'state_change'; orderId: string; state: OrderState; at: string }
  | { type: 'heartbeat'; at: string }
```
