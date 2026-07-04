# Handover — FAVO loose ends + backend↔frontend coverage

**Date:** 2026-07-04 · **Author:** Claude Code · **For:** the next session (new Claude window or a teammate)

---

## TL;DR (read first)

PR **#208 is merged to `main`** (squash `43125cc`), migrations **0020–0025 are applied to live** Supabase, and the `/converge` Refine Loop is **closed** (8/8 rounds; post-merge verified — 909 unit tests green on `main`, prod deploy healthy). Everything an automated adversary could bite on the **code / CI / DB / merge** surface is done and shipped.

What's left splits into four buckets, none blocking, all needing a human or a follow-up decision:

- **A · Live-operation drills** — SC01/SC02/SC03/SC04/SC05/SC08. Can only be measured against real café operation / real hardware. Not code.
- **B · Backend↔frontend coverage** — the audit found **100% clean frontend→backend wiring** and **3 orphaned backend functions** with no UI counterpart. Decide: wire a UI, or mark them intentionally deferred.
- **C · Security housekeeping** — rotate the live Supabase DB password (it was pasted into a session transcript).
- **D · Non-gating leftovers** — N7/N8/N9/N10 + a couple of small items, all previously flagged as optional.

---

## Where everything is

| Thing | Location |
|---|---|
| Repo | `github.com/Heritage-Of-Faith/Favo-WebApp` · local: `/Users/nikaodutoit/Documents/AI /FAVO/Favo-WebApp` (note the space) |
| Branch | `main` @ `43125cc` (fix branch `fix/n-converge-prd-r2-blocking-fixes` is now fully merged & redundant) |
| Source of truth | `docs/FAVO_PRD_v4.md` (§04 success criteria, §08 L01–L16) |
| Converge log + dashboard | `refine-loop/prd-perfection/LOOP.md` · `refine-loop/prd-perfection/index.html` (open in a browser) |
| Prior handover (graduation) | `docs/HANDOVER_CONVERGE_PRD_GRADUATION.md` |
| Load-test runbook | `docs/load-testing-sunday-peak.md` (SC02, k6) |
| Deployed app | `favo-web-app.vercel.app` (serves `main`) |
| Live DB | Supabase project **Flavo-Real** (eu-west-1, PG 17) |
| Toolchain | `bun` → `/Users/nikaodutoit/.bun/bin/bun` · `gh` → `/Users/nikaodutoit/.local/bin/gh` (has `workflow` scope) |
| PINs (seed/test) | barista `1234` · admin `4321` |
| ⚠ `.env.local` | Now holds **REAL live Supabase creds** (was placeholder). `bun test:db` refuses this host unless `FAVO_DB_TEST_OK=1` — do NOT set that against prod. |

---

## Bucket A — Live-operation drills (need real café / hardware)

These are PRD §04 success criteria whose verification is a live measurement, not code. The code paths + queries all exist and are merged; what's missing is a real measurement. Each has a named collapsing act.

| ID | Target | How to verify (the act that closes it) |
|---|---|---|
| **SC01** | Live COGS updates ≤5s, no manual step | Admin COGS dashboard open on the live URL; a barista places a test order (Yoco **test** card or the new "Mark as paid" manual button); COGS increments within ~5s with no refresh. |
| **SC02** | Sunday peak: 45 orders / 85 min, queue stable | Follow `docs/load-testing-sunday-peak.md` (k6) against a **staging** target with Yoco in test mode. NOT against prod. |
| **SC03** | Order-to-cup **p50 ≤ 5 min** (normal day) | `SELECT * FROM v_order_fulfillment_percentiles ORDER BY sast_date DESC;` — read `p50_minutes` on a **real** trading day. ⚠ Today's rows are seed/test data → degenerate values (p50 up to 108 min); the view is correct, the data isn't representative yet. |
| **SC04** | Order-to-cup **p95 ≤ 10 min** (Sunday peak) | Same view, read `p95_minutes` on a genuine Sunday-peak day. |
| **SC05** | Push ≤10s of barista "ready" | On a phone: log into the customer site as a test customer, **Allow** notifications; POS advances that customer's order to ready; push arrives within 10s. |
| **SC08** | Offline: 0 orders lost | On the POS tablet, Wi-Fi off, place 3–5 orders, Wi-Fi on, wait ~30s; confirm all appear in admin, none lost. |

**Reading SC03/04 live** (the view is real and already accumulating data):
```
cd "/Users/nikaodutoit/Documents/AI /FAVO/Favo-WebApp"
DATABASE_URL='<real transaction-pooler URL>' /Users/nikaodutoit/.bun/bin/bun -e '
  import postgres from "postgres";
  const sql = postgres(process.env.DATABASE_URL,{prepare:false,max:1});
  console.log(await sql`select * from v_order_fulfillment_percentiles order by sast_date desc limit 14`);
  await sql.end();'
```

---

## Bucket B — Backend↔frontend coverage audit

Full read-only cross-reference of every Server Action + API route against its frontend callers (main @ `43125cc`).

### Result
- **Frontend → backend: 100% clean.** Every UI import/call of `@/server/actions/*` and every `fetch("/api/*")` resolves to an existing, exported backend symbol. **No broken wiring.**
- **`confirmManualPayment` (the recent addition): correctly wired** — `src/components/pos/ChargeOrderDialog.tsx` imports it (line 24) and calls it (line 59), checks `res.ok`, then settles. ✅
- **`/api/reports/export`** is wired (`src/components/admin/ReportExportForm.tsx:57`).
- ~50 Server Actions across orders / loyalty / customers / staff / menu / inventory / stock-takes / purchases / P&L / audit / hours are all WIRED to a UI.

### The 3 genuine gaps — backend built, NO frontend counterpart (verified by grep)
| Backend symbol | File | What it does | Decision needed |
|---|---|---|---|
| `topUpWallet` | `src/server/actions/loyalty.ts:176` | Creates a Yoco checkout to top up a customer's wallet (L16) | ✅ **WIRED 2026-07-04** — `WalletTopUpDialog.tsx` + "Top up" button on the POS customer bar (`POSWorkspace.tsx`). |
| `resolveStuckCharge` | `src/server/actions/loyalty.ts:397` | Admin recovery: manually activate a pending charge whose webhook never arrived (BUG-O2) | ✅ **WIRED 2026-07-04** — new `listStuckCharges` query + `StuckChargesSection.tsx` on the admin Sync-Conflicts page (per-row Resolve button). |
| `subscribeStaffPush` | `src/server/actions/staff-push.ts:24` | Registers a staff device for push (low-stock alerts) | ✅ **Already wired** (audit was stale) — `StaffPushOptIn.tsx` (task M10) → `enableStaffPush()` → `subscribeStaffPush`, rendered in `POSWorkspace.tsx`. No action needed. |

### Intentional non-gaps (do NOT "fix")
- `requestRefund` / `approveRefund` — deliberately return `{ok:false, NOT_SUPPORTED}` per **L02** (no refunds). No UI should call them; flag it if any ever does.
- `accrueOrderLoyalty`, `reverseOrderLoyalty`, `activatePendingCharge` — **internal/server-to-server** (webhook, cron, other actions). Correctly have no direct UI caller.

### To finish the audit rigorously (recommended for the new session)
The above is a strong first-pass (one read-only agent + a grep spot-check). To make it airtight:
1. For each of the 3 orphans, `git log`/PLANNING check whether it was scoped as Phase 3 — the answer decides "wire it" vs "document as deferred."
2. Reverse direction is already clean, but re-confirm after any new UI work: `grep -rn 'from "@/server/actions' src/app src/components` and check each import resolves.
3. Consider a tiny CI guard (a test that imports every `src/server/actions/*` export and asserts it's referenced somewhere in `src/app|src/components`, allowlisting the internal/stub set) so coverage can't silently regress.

---

## Bucket C — Security housekeeping

- **Rotate the live Supabase DB password.** During graduation the real `DATABASE_URL` (plus `AUTH_SECRET` and the VAPID private key) were pasted into a chat transcript. Rotate the DB password in Supabase → Project Settings → Database → Reset password, then update `DATABASE_URL` in Vercel env vars (and locally). Consider rotating `AUTH_SECRET` too.

---

## Bucket D — Non-gating leftovers (optional, previously flagged)

- **N7** — `closeDaily` (`src/server/crons/close-daily.ts`) pages but has no hard block; confirm that's the intended behavior.
- **N8** — emergency-purchase pending-approval flow polish (L10).
- **N9** — bump `drizzle-orm` `^0.41.0` → `≥0.45.2` (`package.json:38`).
- **N10** — Yoco webhook replay-window hardening.
- Pack category / T&Cs copy; remove any harmless `::text` no-op casts if you touch those views.
- **No wallet-debit-for-order feature exists** — L06's "wallet debit earn" clause has nothing to hook until that payment path is built (relevant if you wire `topUpWallet` above and later add wallet-pay-for-order).

---

## How to resume in a new session

Paste something like:
> "Continue FAVO loose ends. Read `docs/HANDOVER_LOOSE_ENDS.md`. `main` is at `43125cc`, PR #208 merged, migrations 0020–0025 live, converge loop closed. Help me with [Bucket B backend/frontend gaps / the SC drills / rotate the DB password]."

Notes for whoever picks it up:
- **Bucket B** is the most code-shaped and doable from a dev machine — start there. Decide wire-vs-defer for `topUpWallet` / `resolveStuckCharge` / `subscribeStaffPush`; if wiring, follow the existing action→dialog patterns (e.g. `ChargeOrderDialog.tsx` for `confirmManualPayment`, `AdjustLoyaltyDialog.tsx` for `adjustLoyalty`).
- **Bucket A** needs the café + a phone + a k6 run — a session can guide + interpret but can't perform the taps.
- Gate for any new code: `bun typecheck` · `bun lint` · `bun test:unit` (all green on `main` today: 909 tests). Branch off `main`, one task per PR, WI key in the commit.
