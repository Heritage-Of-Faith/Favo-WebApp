# FAVO Café — Subject Rights Procedure (Internal)

**Classification:** Internal  
**Owner:** Nikao du Toit  
**Last reviewed:** 17 June 2026

This document describes how HOFMI/FAVO staff handle data subject rights requests under POPIA (South African Protection of Personal Information Act, 4 of 2013).

---

## 1. Receiving a request

Requests arrive at **privacy@hofmi.org**. The responsible party (Nikao or Gian) must:

1. Acknowledge receipt within **3 business days**
2. Verify the requester's identity (ask them to confirm their registered email address)
3. Locate their `customer_id` in the database
4. Respond fully within **30 calendar days**

Valid request types:
- **Access** — copy of all PI held
- **Correction** — fix inaccurate or incomplete PI
- **Deletion / Anonymisation** — erase PI (subject to retention constraints below)
- **Objection** — objecting to processing

---

## 2. Access request

1. Run the export query from `data-inventory.md` (Subject access request section)
2. Redact `password_hash` from the output
3. Export as PDF (preferred) or CSV
4. Send via encrypted email to the verified address
5. Log the action in the audit log:

```sql
-- Pseudocode — use writeAudit() in code
INSERT INTO audit_log (
  entity_kind, entity_id, action, actor_id, actor_role, reason
) VALUES (
  'customer', '<customer_id>', 'popia.access_request',
  '<admin_staff_id>', 'owner', 'POPIA subject access request ref <request_id>'
);
```

---

## 3. Correction request

1. Update the relevant field via the admin panel (name, phone, email)
2. The Server Action will write an audit row automatically
3. Confirm the change to the requester in writing

---

## 4. Deletion / Anonymisation request

FAVO's audit log is **legally append-only** (Business Rule L12). Orders and financial records must be retained for tax purposes (minimum 5 years). Full deletion is not possible for these records.

What we can do:
- **Anonymise the customer record** — overwrite name, email, phone with redaction markers
- **Insert a POPIA redaction row** in the audit log for every existing audit row that contains the customer's PI

### Step-by-step procedure

**Step 1 — Update the customer record**

```sql
UPDATE customers
SET
  name    = '[REDACTED]',
  email   = 'redacted-<customer_id>@popia.hofmi.internal',
  phone   = '0000000000',
  password_hash = ''
WHERE id = '<customer_id>';
```

**Step 2 — Revoke push subscriptions**

```sql
DELETE FROM push_subscriptions WHERE customer_id = '<customer_id>';
```

**Step 3 — Insert POPIA redaction audit row** (one row per request, not per original audit entry)

```sql
INSERT INTO audit_log (
  entity_kind, entity_id, action, actor_id, actor_role,
  after, reason
) VALUES (
  'customer', '<customer_id>',
  'popia.anonymisation_completed',
  '<admin_staff_id>', 'owner',
  '{"note": "[REDACTED:popia-request-<request_id>]"}',
  'POPIA erasure request — customer account anonymised. Financial records (orders, wallet, audit history) retained per tax law.'
);
```

**Step 4 — Confirm** in writing to the requester that:
- Their account has been anonymised
- Financial records (order history, wallet transactions) are retained as required by law
- The approximate retention period for financial records

### What remains after anonymisation

| Data | What stays | Why |
|---|---|---|
| Order records | Amounts, timestamps, item IDs | Tax/financial audit |
| Wallet transactions | Amounts, timestamps | Financial ledger |
| Audit log entries | Amounts, timestamps, action types | Legal obligation |
| Customer name/email/phone | Replaced with `[REDACTED]` | Not needed for tax |

---

## 5. Objection request

For marketing or push notification objections:

1. Revoke push subscription (if applicable):

```sql
DELETE FROM push_subscriptions WHERE customer_id = '<customer_id>';
```

2. Log via `writeAudit` with action `popia.objection_processed`
3. Confirm in writing

---

## 6. Escalation

If a requester is unsatisfied with our response or if a request is unusually complex, escalate to:

- **Matt (Owner)** — matt@hofmi.org
- **Information Regulator of South Africa** — inforeg.org.za / complaints@inforegulator.org.za

---

## 7. Record-keeping

Every completed rights request must have:
- The original email request (archived)
- An audit log entry confirming the action taken
- A reference ID (format: `POPIA-YYYY-NNN`, e.g. `POPIA-2026-001`)
