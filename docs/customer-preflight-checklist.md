# Customer Pre-flight Checklist — AT-92 (N18)

**Owner:** Nikao du Toit  
**Phase:** HOFMI-FAVO-P4  
**Due:** 07:30 on launch day (before deploy gate closes)  
**Run against:** staging (`https://staging.favo.hofmi.org`)

---

## Lighthouse targets

Run Lighthouse in Chrome DevTools (mobile preset) against each route below.

| Route | Performance | Accessibility | PWA Installable | Notes |
|---|---|---|---|---|
| `/` (landing) | ≥ 90 | ≥ 95 | — | |
| `/login` | ≥ 90 | ≥ 95 | — | |
| `/customer` (dashboard) | ≥ 90 | ≥ 95 | ✓ | Requires sign-in |
| `/pos/login` (POS shell) | ≥ 90 | ≥ 95 | — | |

**Pass criteria:** All four pages meet or exceed every applicable target.

---

## axe-core findings

Run `@axe-core/playwright` against each route. Zero serious or critical violations permitted at launch.

| Route | Serious | Critical | Notes |
|---|---|---|---|
| `/` | | | |
| `/login` | | | |
| `/customer` | | | |
| `/pos/login` | | | |

_Fill in before deploy gate closes. Any finding must have a remediation PR merged first._

---

## Playwright customer-flow spec

```bash
bun test:e2e:ci tests/e2e/customer-flow.spec.ts
```

| Test | Pass/Fail | Notes |
|---|---|---|
| Landing page loads with FAVO branding | | |
| Unauthenticated /customer redirects | | |
| Unauthenticated /wallet redirects | | |
| Unauthenticated /packs redirects | | |
| Sign-up page renders | | |
| Sign-up creates account + lands on dashboard | | |
| Sign-in page renders | | |
| Wrong password shows error | | |
| Dashboard renders loyalty section | | |
| Dashboard renders without JS errors | | |
| Wallet page renders | | |
| Packs page renders | | |
| PushOptIn visible when permissions granted | | |
| Sign-out redirects to /login | | |

---

## Remediation log

_Record any axe or Lighthouse findings and their fixes below._

| Finding | Severity | Fix (PR / commit) | Verified |
|---|---|---|---|
| | | | |

---

**Sign-off (Nikao):** _______________ Date: _______________
