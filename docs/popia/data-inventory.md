# FAVO Café — POPIA Data Inventory (Internal)

**Classification:** Internal  
**Owner:** Nikao du Toit  
**Last reviewed:** 17 June 2026

This document maps every personal information (PI) field stored by FAVO to its database table, retention period, and RLS access rules. It is the basis for responding to subject access requests.

---

## Customer PI fields

| Field | Table | Column | Retention | RLS — Read | RLS — Write |
|---|---|---|---|---|---|
| Email address | `customers` | `email` | Until anonymisation request | customer (own), admin, manager, owner | System (register action) |
| Full name | `customers` | `name` | Until anonymisation request | customer (own), barista (RO), admin, manager, owner | System (register action) |
| Phone number | `customers` | `phone` | Until anonymisation request | customer (own), barista (RO), admin, manager, owner | System (register action) |
| Password hash | `customers` | `password_hash` | Until anonymisation request | System only (never returned to client) | System (register/password-change) |
| Loyalty points | `customers` | `loyalty_points` | Indefinitely | customer (own), admin, manager, owner | System (loyalty earn/redeem actions) |
| Account created at | `customers` | `created_at` | Indefinitely | customer (own), admin, manager, owner | System |

## Order history

| Field | Table | Column | Retention | RLS — Read | RLS — Write |
|---|---|---|---|---|---|
| Order records | `orders` | all columns | 5+ years (tax) | customer (own), barista, admin, manager, owner | barista, admin |
| Order items | `order_items` | all columns | 5+ years (tax) | customer (own), barista, admin, manager, owner | barista, admin |
| Payment records | `payments` | amount, method, status | 5+ years (tax) | admin, manager, owner, finance | System (payment actions) |

## Loyalty, wallet, and packs

| Field | Table | Column | Retention | RLS — Read | RLS — Write |
|---|---|---|---|---|---|
| Wallet balance | `wallets` | `balance_zar` | Indefinitely | customer (own), admin, manager, owner | System (wallet actions) |
| Wallet transactions | `wallet_transactions` | all columns | Indefinitely (append-only) | customer (own), admin, manager, owner | System (wallet actions) |
| Pack purchases | `coffee_packs` | all columns | Indefinitely | customer (own), admin, manager, owner | System (pack purchase actions) |
| Pack redemptions | `pack_redemptions` | all columns | Indefinitely (append-only) | customer (own), admin, manager, owner | System (redemption actions) |

## Push subscriptions

| Field | Table | Column | Retention | RLS — Read | RLS — Write |
|---|---|---|---|---|---|
| Push endpoint | `push_subscriptions` | `endpoint` | Until revoked | System (push delivery), admin | System (subscribe/unsubscribe actions) |
| Push keys | `push_subscriptions` | `p256dh`, `auth` | Until revoked | System only | System |
| Customer link | `push_subscriptions` | `customer_id` | Until revoked | admin, manager, owner | System |

## Audit log (append-only, contains PI)

The `audit_log` table records every mutation. Rows contain `before`/`after` JSONB snapshots which may include personal information (e.g. name changes, email corrections).

| Field | Retention | Note |
|---|---|---|
| All audit rows | Indefinitely (cannot be deleted) | Legal obligation — financial audit trail |
| PII in `before`/`after` columns | Anonymised on request | POPIA-request row inserted; original preserved |

---

## Subject access request — what to export

When processing a SAR, export the following for the customer:

1. `customers` row for their `customer_id`
2. All `orders` + `order_items` where `customer_id` matches
3. All `wallet_transactions` via `wallets.customer_id`
4. All `coffee_packs` + `pack_redemptions`
5. All `loyalty_transactions`
6. Audit log rows where `entity_id = customer_id` AND `entity_kind = 'customer'`

Export as PDF or CSV. Redact `password_hash` before sending.

---

## Fields exempt from deletion (legal retention)

The following fields cannot be fully erased due to tax and financial record-keeping obligations:

- All `orders`, `order_items`, `payments` records
- All `wallet_transactions`, `pack_redemptions`
- All `audit_log` rows

For these, the deletion procedure is **anonymisation** — see `subject-rights.md`.
