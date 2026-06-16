# FAVO Café — Incident Response Playbook

**Owner:** Mia Ligthelm (AT-91, A21)  
**Phase:** HOFMI-FAVO-P4  
**Last updated:** 17 June 2026  
**Version:** 1.0 (launch day)

> **Who this is for:** Anyone on-call when something breaks. You do not need to be a developer to follow the "OH NO" tree. If a branch ends at "page Gian", call him — don't try to improvise.

---

## "OH NO" — decision tree

Start here. Pick the branch that matches what you're seeing.

```
Something is wrong
│
├─ The entire app is down / won't load
│   └─ → SEE § 1  App down
│
├─ Payments are failing / customers can't pay
│   └─ → SEE § 2  Payment broken
│
├─ Push notifications not arriving on customer phones
│   └─ → SEE § 3  Push not arriving
│
├─ The POS queue is stuck / orders not updating
│   └─ → SEE § 4  Queue stuck
│
├─ Offline orders placed at POS are not appearing in admin
│   └─ → SEE § 5  Offline orders not syncing
│
├─ Inventory numbers look wrong / variance alert is red
│   └─ → SEE § 6  Inventory variance / COGS alert
│
├─ A staff PIN was shared or may be compromised
│   └─ → SEE § 7  Staff PIN compromise
│
├─ A suspicious Yoco webhook showed up in the audit log
│   └─ → SEE § 8  Suspected webhook replay
│
├─ Admin COGS dashboard shows "costs not confirmed" warning
│   └─ → SEE § 9  COGS costs not seeded
│
└─ Something else / not sure
    └─ → Check https://favo.hofmi.org/api/healthz first
        ├─ Returns {"ok":true}  →  App is running. Read through §§ 1–9 for the closest match.
        └─ Does not return     →  SEE § 1  App down
```

---

## § 1 — App down (R1)

### How would I notice this?
- `https://favo.hofmi.org` returns an error page, blank page, or timeout
- `/api/healthz` does not return `{"ok":true}`
- Coolify sends a deployment failure alert to `#favo-ops`
- Staff cannot reach the POS or admin panel

### First 5 minutes
1. Visit `https://favo.hofmi.org/api/healthz` in a browser
2. If it returns `{"ok":true}`: the app is alive — the symptom may be a browser cache issue. Try a hard refresh (Ctrl+Shift+R) or incognito window
3. If it does not respond: open Coolify → Projects → **hofmi-favo** → **favo-webapp** → check the **Deployments** tab for a failed build
4. Post in `#favo-ops`: "App appears down — investigating. Health check: [paste response]"

### When to escalate
Page Gian immediately if:
- `/api/healthz` is not responding and you can see a failed deployment
- The previous deployment was more than 15 minutes ago (not a fresh deploy issue)
- You see `FATAL` errors in the Coolify build log

### Restoration
- **Self-serve (if latest deploy failed):** In Coolify → Deployments → select the last known-good deployment SHA → click **Redeploy**. See `docs/deploy-runbook.md` §2 for exact steps.
- **Otherwise:** Page Gian. On-call contact: gian@hofmi.org / `#favo-ops` Discord (ping @gian)

### Post-mortem trigger
Any outage > 5 minutes: Gian writes a post-mortem in `#favo-ops` within 24 hours. Template: what broke, when, customer impact, root cause, fix, prevention.

---

## § 2 — Payment broken (R2 / R8)

### How would I notice this?
- Customers get an error after tapping "Pay"
- Yoco payment status page shows degraded or down: `status.yoco.com`
- The audit log shows a spike of `payment.failed` rows
- Staff report cash payments needed unexpectedly

### First 5 minutes
1. Check `https://status.yoco.com` — if Yoco is reporting an incident, this is their problem, not ours
2. If Yoco is healthy: open Grafana Loki and search `{service="favo-webapp"} |= "webhook"` for errors in the last 15 minutes
3. Try a test payment on the POS with a known-good card
4. Post in `#favo-ops`: "Payments failing — Yoco status: [link]. Loki errors: [paste]"

### When to escalate
- Yoco is healthy but payments still fail → Page Gian
- You see `"signature verification failed"` in Loki → page Gian immediately (potential replay attack — see § 8)
- Any `500` errors from `/api/payments/yoco/webhook` → page Gian

### Restoration
- **Yoco outage:** No action needed on our side. Staff take orders with "paid in person — reconcile later" note. Gian will run the 24-hour reconciliation from the audit log when Yoco recovers
- **Webhook secret compromised:** Gian rotates the secret in Infisical → redeploys. Zero downtime if done within the Coolify rolling deploy window

### Post-mortem trigger
Any payment disruption lasting > 10 minutes, or any suspected replay attack, triggers a post-mortem within 24 hours.

---

## § 3 — Push notifications not arriving (R4)

### How would I notice this?
- Customers are not receiving "order ready" notifications
- Staff have to verbally call every order number
- The audit log shows `push.sent` rows but customers don't receive them

### First 5 minutes
1. Ask a customer nearby: "Did you get a notification when your order was ready?" — confirm the symptom is real
2. Check if the customer has notifications enabled: they can see this in Android Chrome settings → Site settings → Notifications → `favo.hofmi.org`
3. Check the VAPID config: Gian can verify `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is correctly set in the Coolify environment variables
4. Check `/api/push/subscribe` is returning `200` for a fresh opt-in (use browser DevTools Network tab)
5. Post in `#favo-ops`: "Push not delivering. VAPID check needed"

### When to escalate
- VAPID keys look correct but push still fails → page Gian
- Multiple customers on different networks report the same issue → page Gian
- `/api/push/subscribe` returns any non-200 → page Gian

### Restoration
- If the customer's subscription is stale (phone was reset, browser data cleared): they need to opt in again via the customer dashboard — the "Enable notifications" button will re-register
- If VAPID keys were rotated without resubscribing customers: Gian redeploys with the old key pair, or we ask all customers to re-opt-in after redeploying with new keys

### Post-mortem trigger
Push failure during a Sunday rush (high-traffic window) triggers a post-mortem. Threshold: > 5 customers affected in one service period.

---

## § 4 — Queue stuck / SSE not updating (R9)

### How would I notice this?
- The POS queue board stops updating — new orders don't appear without a page refresh
- Staff refresh the page and it catches up, then stops again
- The browser console shows repeated SSE reconnection attempts

### First 5 minutes
1. Open browser DevTools → Network tab → filter by `stream`
2. Find the `/api/queue/stream` request — it should be an ongoing EventStream
3. If the connection shows as "Pending" but no events are arriving, the SSE heartbeat (30s) may have been missed
4. **Immediate fix for staff:** Refresh the page — the client reconnects and receives a full poll of current state on reconnect. No orders are lost
5. Post in `#favo-ops`: "Queue SSE appears stuck. Staff refreshing to recover"

### When to escalate
- Refreshing does not restore the queue (missing orders after refresh) → page Gian immediately
- All POS terminals are stuck simultaneously → page Gian (may be a PG LISTEN/NOTIFY issue)

### Restoration
- **Self-serve:** Page refresh always restores state (SSE reconnect sends a full poll). There is no data loss; this is an availability issue only
- **Gian-level:** If PG LISTEN/NOTIFY is lagging under Sunday peak load, Gian can restart the connection pool or increase PgBouncer's pool size

### Post-mortem trigger
SSE disruption > 10 minutes during service (Sunday peak) triggers investigation. Gian reviews PG LISTEN/NOTIFY metrics.

---

## § 5 — Offline orders not syncing (R3)

### How would I notice this?
- Orders placed offline at the POS (no internet at the time) have not appeared in the admin panel
- Staff remember placing orders that are missing
- `/admin/sync-conflicts` shows open conflicts

### First 5 minutes
1. Open `/admin/sync-conflicts` — this is the first place to look
2. Review the open conflicts list: each row shows what conflicted and when
3. For each conflict: read the "Local" vs "Server" description and pick the correct version (last-write-wins is the default, but manager review is required when flagged)
4. Resolve each conflict with an explanation and click **Resolve**
5. Post in `#favo-ops`: "N sync conflicts found. Resolving now. Details: [brief description]"

### When to escalate
- You cannot determine which version of a conflict is correct → ask Mia or page Gian
- Conflicts involve payment amounts (not just order state) → page Gian before resolving
- More than 10 conflicts from a single period → page Gian (may indicate a systemic sync issue)

### Restoration
- Conflicts are resolved in `/admin/sync-conflicts`. Each resolution writes an audit row automatically
- No data is lost — the conflict table retains both versions until resolved

### Post-mortem trigger
> 5 conflicts from a single service session → Gian investigates the sync logic and network reliability at the venue.

---

## § 6 — Inventory variance / COGS alert (R5 / R6)

### How would I notice this?
- Admin dashboard shows a red or yellow variance flag
- Discord `#favo-ops` receives a `[closeDaily] MISMATCH` ping
- T01 bands: 0–5% fine, 5–10% investigate, 10%+ critical

### First 5 minutes
1. Open `/admin/inventory` — look for ingredients with a "Mismatch" or "Low" badge
2. Physically check the ingredient on the shelf — is the system number wrong, or is the shelf actually empty?
3. If the physical count is wrong: do a stock take at `/admin/stock-takes` → New stock take
4. If the physical count is right and the system is wrong: the recipe deduction may be misconfigured — note the ingredient and contact Gian

### When to escalate
- Variance > 10% with no obvious explanation → page Gian
- Variance involves a high-cost item (specialty beans, milk) → contact Gian to recalibrate
- Daily variance has been consistently 5–10% for > 3 days → Gian reviews `recipe_ingredients.tolerance_pct`

### Restoration
- Short-term: stock take corrects the baseline
- Long-term: Gian adjusts tolerance bands (T01) or recipe yield percentages (T02)

### Post-mortem trigger
Any single-day variance > 15% triggers a post-mortem. Gian reviews ingredient deduction logs in the audit table.

---

## § 7 — Staff PIN compromise (R7)

### How would I notice this?
- A staff member reports sharing their PIN (or it was observed)
- An order or discount appears in the audit log at a time when no staff member should have been working
- An audit row shows an entitlement claim (discount, stock adjustment) from an unexpected time

### First 5 minutes
1. Do NOT wait — act immediately
2. Contact Mia (mia@hofmi.org) or Gian (gian@hofmi.org) to revoke the PIN
3. Note the affected staff ID and the approximate time of the suspected compromise
4. Do not confront the staff member before speaking to Mia

### When to escalate
Always escalate to Mia immediately. If Mia is unavailable, page Gian.

### Restoration
1. Mia or Gian goes to `/admin/staff` → find the staff member → **Reset PIN**
2. Have the staff member choose a new PIN privately — do not transmit it over WhatsApp, email, or Discord
3. Gian reviews the full audit trail for the affected period for any suspicious actions
4. If discount abuse is suspected: Gian compares `orders.discount_zar` and `audit_log` entries for that staff ID

### Post-mortem trigger
Every PIN compromise triggers a review. Gian runs: `SELECT * FROM audit_log WHERE actor_id = <staff_id> AND created_at > <compromise_time>` and shares findings with Mia.

---

## § 8 — Suspected webhook replay attack (R8)

### How would I notice this?
- Loki shows `"signature verification failed"` errors from `/api/payments/yoco/webhook`
- An order appears marked "paid" in the audit log but the customer has not actually paid
- `yoco_payment_id` appears more than once in the orders table (idempotency failure would show this)

### First 5 minutes
1. Do NOT try to fix this yourself — page Gian immediately
2. Post in `#favo-ops`: "@gian Suspected webhook replay. Loki: [paste error]. Time: [now]"
3. Do not process any card payments until Gian confirms the webhook secret is intact

### When to escalate
Immediately. Every time. This is a security incident.

### Restoration
Gian's steps:
1. Rotate the Yoco webhook secret in Infisical
2. Redeploy to pick up the new secret
3. Review audit log for any `payment.confirmed` rows that lack a corresponding `yoco_payment_id` in the Yoco dashboard
4. For any suspicious "paid" orders: contact Yoco support with the payment ID for verification

### Post-mortem trigger
Every suspected replay attack triggers a post-mortem within 24 hours, regardless of whether actual fraud occurred.

---

## § 9 — COGS costs not seeded / "costs not confirmed" warning (R10)

### How would I notice this?
- Admin dashboard shows a yellow "Costs not confirmed — COGS may be inaccurate" banner
- The COGS figure looks too low (zero or near-zero) even after orders have been placed

### First 5 minutes
1. This is a configuration issue, not a system failure — there is no customer impact
2. Note which ingredients have no cost entered
3. Contact Gian with a list: "These ingredients have no cost: [list from `/admin/inventory`]"

### When to escalate
- If the banner has been showing for > 24 hours after launch: contact Gian to seed the ingredient costs
- If COGS figures are being used to make a financial decision (e.g. the monthly P&L): do not sign off until costs are confirmed

### Restoration
Gian updates `inventory_lots` with the correct costs per unit. The COGS dashboard recalculates from that point forward. Historical orders before the seed will show estimated COGS; Gian will note this in the post-launch reconciliation.

### Post-mortem trigger
If costs are still not seeded 48 hours after launch, Gian escalates to Matt (owner sign-off required to unblock the P&L).

---

## Reference — healthz and monitoring

| Check | URL / command | Expected |
|---|---|---|
| App health | `https://favo.hofmi.org/api/healthz` | `{"ok":true}` |
| Yoco status | `https://status.yoco.com` | No active incidents |
| Coolify deploy log | Coolify → hofmi-favo → favo-webapp → Deployments | Build: success |
| Loki (webhook errors) | Grafana Explore → `{service="favo-webapp"} |= "webhook"` | No errors |
| Sync conflicts | `https://favo.hofmi.org/admin/sync-conflicts` | 0 open conflicts |
| Audit log | `https://favo.hofmi.org/admin/audit` | No anomalous entries |

---

## Contacts

| Person | Role | Contact |
|---|---|---|
| Gian | Lead developer — all technical escalations | gian@hofmi.org / @gian in `#favo-ops` |
| Mia | System admin — staff management, incident triage | mia@hofmi.org |
| Matt | Owner — sign-off on financial / security incidents | matt@hofmi.org |
| Nikao | Customer experience | nikao@hofmi.org |
| Yoco support | Payment issues | support.yoco.com |

**On-call rotation:** Gian is primary on-call for launch week (16–23 June 2026). After that, rotation posted in `#favo-ops`.

---

## Related documents

- `docs/ops-runbook.md` — daily/weekly/monthly duties for Nkuli
- `docs/deploy-runbook.md` — exact deploy procedure and rollback steps (Gian only)
- `docs/admin-prod-smoke.md` — Mia's launch-day smoke checklist
- `docs/popia/subject-rights.md` — POPIA data subject request procedure
