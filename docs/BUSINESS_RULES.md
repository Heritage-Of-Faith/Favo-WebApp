# Business Rules

## Locked — require PRD amendment to change

| ID | Rule | Enforcement |
|---|---|---|
| L01 | No payment → no order. Failed payment cancels the order; no stock deducted. | Server action + state machine |
| L02 | Full refunds only in v1. | Server action validation |
| L03 | Staff free coffee: 1 per staff per weekday. 100% discount. Cappuccinos only. Barista may apply for self. | App + DB (`UNIQUE(staff_id, day)`) |
| L04 | Operating hours are display-only. System never rejects on time. | UI only — no server gate |
| L05 | Ordering is in-person only. Barista creates all orders. Customer PWA is read-only. | RLS + UI |
| L06 | Loyalty: 5 pts per R10. Min 100 to redeem. 100 pts = R20. Full redemption only. | Server action + audit |
| L07 | Midnight SAST is revenue day boundary. | Reporting queries |
| L08 | Every inventory adjustment writes an audit row. | Trigger |
| L09 | Stock reconciles before daily close. `closeDaily()` blocks + pages Discord on mismatch. | Cron |
| L10 | Emergency purchase requires admin approval (`admin_approved_by` not null). | DB CHECK |
| L11 | Monthly P&L requires admin sign-off to close. | DB CHECK |
| L12 | `audit_log` is append-only. UPDATE/DELETE trigger-denied forever. | Trigger |
| L13 | Data tenant-isolated to `hofmi`. | RLS |
| L14 | Staff entitlement: DB-enforced. Weekdays only. Cappuccinos only. | DB UNIQUE + app validation |
| L15 | Done tap by barista marks order ready. Done button must be the most prominent action on active-order view. | UI |
| L16 | Wallet top-ups + coffee packs in scope. Counter-only. Barista processes. Packs expire 90 d. | Server action |

## Tunable — Admin can change with a logged config change

| ID | Default | Tuning point |
|---|---|---|
| T01 | Variance bands: 0–5 % ok · 5–10 % investigate · 10 %+ critical | `config.variance_bands` |
| T02 | Bean freshness alert at 14 d post-roast | Per-lot origin |
| T03 | Sunday rush window 07:50–09:15 | `config.sunday_window` |
| T04 | Low-stock thresholds | `inventory_items.low_stock_threshold` |
| T05 | Low-stock check interval 15 min | Cron schedule |

## Universal invariants (apply everywhere, all the time)
- Never store, log, or echo PAN/CVV/expiry. Yoco hosted-fields only.
- Money is integer cents in `_zar` columns. Never `numeric`.
- All wall-clock semantics in `Africa/Johannesburg`; storage in `timestamp with time zone`.
- Every mutation writes an audit row. Failure to audit fails the transaction.
- RBAC enforced server-side. UI checks are advisory.
- Idempotency on every webhook key (`yoco_payment_id`, etc.).
