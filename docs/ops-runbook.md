# FAVO Café — Operations Runbook

**Owner:** Mia Ligthelm (AT-90, A20)  
**For:** Nkuli (café admin)  
**Last updated:** 17 June 2026  
**Version:** 1.0 (launch day)

This runbook tells you exactly what to do and when — every day, every week, every month. You don't need to be technical to follow it. Each section lists the screen you need to open and what to check.

---

## Quick reference — what to open

| Admin screen | URL | What it's for |
|---|---|---|
| Dashboard | `/admin` | Daily cost overview and KPI summary |
| Inventory | `/admin/inventory` | Current stock levels per ingredient |
| Stock takes | `/admin/stock-takes` | Enter physical counts to reconcile stock |
| Expenses | `/admin/expenses` | Log and review cash purchases |
| Monthly P&L | `/admin/reports/monthly` | Monthly profit and loss (needs two signatures) |
| Reports | `/admin/reports` | Download CSV/PDF exports |
| Hours | `/admin/hours` | Update opening and closing times |
| Customers | `/admin/customers` | Look up customer accounts |
| Sync conflicts | `/admin/sync-conflicts` | Review and resolve offline order issues |
| Audit log | `/admin/audit` | See a full history of every change made |

Sign in at `/admin` with your staff PIN.

---

## Daily duties (every day you open)

### Morning COGS check (08:00–08:15)

**Screen:** `/admin` (COGS dashboard)

Each morning, open the COGS dashboard and check:

1. The **Net** KPI tile — is today profitable so far? (It will be zero at opening; check after the first few orders)
2. The **variance flag** — if a red or yellow warning banner appears, investigate it (see "Investigating variance" below)
3. No Discord ping overnight saying `[closeDaily] MISMATCH` — if you see one, log the variance immediately

**Business rule:** T01 says 0–5% variance is fine, 5–10% needs investigation, 10%+ is critical. The system flags these for you.

**If everything looks fine:** Nothing to do. Carry on.

---

### Investigating flagged variance

**Screen:** `/admin/inventory`

If the dashboard shows a warning or Discord sent a mismatch ping:

1. Open Inventory and look for ingredients with a red "Low" or "Mismatch" badge
2. Cross-check with what's physically on the shelf
3. If the numbers are wrong, do a **stock take** (see weekly duties)
4. If you can't explain the difference, contact Gian (gian@hofmi.org) with a screenshot

**Business rule:** T01 — variance 10%+ is critical and must be investigated before the next close.

---

### Responding to low-stock push alerts

If your phone receives a FAVO low-stock notification:

1. Note which ingredient is flagged
2. Open `/admin/inventory` and find that ingredient
3. Check the physical shelf
4. If stock is genuinely low: either use what's left wisely or order more
5. If stock is fine but the system flagged it: the threshold may need tuning (see Quarterly duties)

**Business rule:** T04 — thresholds are set per ingredient. Gian can adjust them via the inventory settings.

---

### Verify closeDaily ran (every night, check next morning)

The system automatically runs `closeDaily` at 23:59 SAST every night. If it finds a stock mismatch, it sends a Discord message to `#favo-ops`.

**Check:** Open Discord → `#favo-ops` and look for any red ping. No message = all good.

---

## Weekly duties (every Sunday)

### Review weekly P&L Discord ping

Every Sunday evening, the system sends a `generateWeeklyPnL` summary to Discord.

1. Open Discord → `#favo-ops`
2. Read the summary — it shows revenue, COGS, and variance for the week
3. If variance is above 5%: open `/admin/inventory` and `/admin/expenses` to investigate
4. Record any action taken (even just "variance investigated, no issue found") in a message to `#favo-ops`

**Business rule:** T01 — you are personally responsible for investigating > 5% variance before Monday.

---

### Run a stock take

**Screen:** `/admin/stock-takes`

A stock take means counting what's physically on the shelf and entering those numbers into the system.

1. Go to `/admin/stock-takes`
2. Click **New stock take**
3. Work through each ingredient — count carefully and enter the actual number
4. Submit the stock take when done

The system will calculate the variance from what it expected and flag anything out of range.

**Tip:** Do this on Sunday when it's quiet, before the weekly P&L ping arrives.

---

## Monthly duties (first week of each new month)

### Generate last month's P&L

**Screen:** `/admin/reports/monthly`

1. Go to `/admin/reports/monthly`
2. Select the **previous** month from the dropdown
3. The report will show revenue, COGS, gross profit, and all expenses
4. Click **Sign as Admin** — this closes and archives the report immediately

**Business rule:** L11 — the monthly P&L requires admin sign-off to close. Once signed the report is archived and cannot be changed.

---

### Download monthly exports (optional)

**Screen:** `/admin/reports`

If you want a physical copy of the month's data:

1. Go to `/admin/reports`
2. Select **Monthly P&L** and choose PDF or CSV
3. Set the date range to last month
4. Click **Export** — the file will download to your device

---

## Quarterly duties (every three months)

### Review T-rule tunings

The system uses several threshold settings that may need adjusting as the café grows:

| Setting | Business rule | How to adjust |
|---|---|---|
| Variance bands (0–5% / 5–10% / 10%+) | T01 | Ask Gian to update `config.variance_bands` |
| Bean freshness alert window (14 days) | T02 | Ask Gian to update per-lot freshness config |
| Low-stock thresholds | T04 | Ask Gian to update `inventory_items.low_stock_threshold` |
| Sunday rush window | T03 | Ask Gian to update the rush window timing |

At each quarter-end: review whether the current thresholds are still appropriate. Did you get too many false alerts? Did something slip through unnoticed? Note your findings and share them with Gian.

---

## Annual duties (every January)

### Rotate staff PINs

All staff PINs should be rotated at the start of each year (or when a staff member leaves).

1. Go to `/admin/staff`
2. Find the staff member
3. Click **Reset PIN**
4. Have the staff member set a new PIN privately

**Important:** Never share PINs over WhatsApp, email, or Discord. Hand the new PIN to the person in person.

---

### Audit RBAC

Review who has which roles in the system:

1. Go to `/admin/staff`
2. Check each person's role — does it still match their actual responsibilities?
3. If someone's role needs changing (e.g. a barista promoted to admin), contact Gian

**Roles explained:**
| Role | What they can do |
|---|---|
| **barista** | Take orders, search customers, see today's orders |
| **admin** | Everything barista can do + COGS dashboard, stock takes, monthly P&L, staff management, all financial reports |

---

## When something looks wrong

See **`docs/incident-playbook.md`** for step-by-step guidance on what to do if:
- The app is down
- Payments are not working
- Push notifications are not arriving
- Orders are not syncing from the POS
- Any other urgent issue

**Gian's contact:** gian@hofmi.org (also in `#favo-ops` on Discord)

---

## Contacts

| Person | Role | Contact |
|---|---|---|
| Gian | Lead developer, deploy, infra | gian@hofmi.org / #favo-ops |
| Matt | Owner, sign-off authority | matt@hofmi.org |
| Mia | System admin, FAVO ops | mia@hofmi.org |
| Nikao | Customer experience | nikao@hofmi.org |
| Privacy enquiries | POPIA requests | privacy@hofmi.org |
