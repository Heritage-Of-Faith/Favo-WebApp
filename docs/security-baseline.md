# FAVO Security Baseline — AT-82 (G24)

Established: 2026-06-13 | Branch: `feat/g-g24-security-pass` | Owner: Gian

This document records the zero-critical-findings baseline established before the
Phase 4 production deploy. It is the reference point for the security CI gate in
`.github/workflows/security.yml`. All future suppressions must be added here with
a reason; unexplained suppressions block merge.

---

## Security invariants (non-negotiable)

| ID | Invariant | Enforced by |
|---|---|---|
| §05 | PAN / CVV / expiry never in logs, audit rows, or DB | `pan-near-log`, `pan-in-audit` Semgrep rules |
| §05 | Card data via Yoco hosted-fields only — never touches FAVO server | Code review + `pan-near-log` |
| L08 | Every mutation writes an audit row | `mutation-without-audit` Semgrep rule |
| L12 | Audit log is append-only (trigger-enforced in DB) | DB trigger in `db/sql/` |
| SQL | No raw string interpolation in SQL | `raw-sql-no-params` Semgrep rule |

---

## Semgrep: FAVO custom rules

**Baseline date:** 2026-06-13  
**Result:** ✅ Zero ERROR-severity findings across `src/`, `db/`, `auth.ts`, `middleware.ts`

### Finding summary

| Rule | Findings | Suppressed | Notes |
|---|---|---|---|
| `pan-near-log` | 0 | 0 | No PAN literals in console/logger calls |
| `pan-in-audit` | 0 | 0 | No PAN literals in writeAudit calls |
| `mutation-without-audit` | 0 | 0 | All mutation functions call writeAudit |
| `raw-sql-no-params` | 0 | 0 | No `sql.raw()` calls; all SQL uses safe tagged template |

### Suppressed findings

*None.* No findings were suppressed at baseline. If you add a `// nosemgrep:` annotation
in future, document it below:

| File | Line | Rule | Reason |
|---|---|---|---|
| _(none)_ | — | — | — |

---

## Grype: dependency vulnerability scan

**Baseline date:** 2026-06-13  
**Result:** ✅ Zero critical CVEs detected

Grype scans `package.json` / `bun.lockb` against the NVD and GitHub Advisory Database.
The CI job is configured with `--fail-on critical`.

### Accepted findings

*None.* If a future scan finds a vulnerability that cannot be immediately patched
(e.g., no fix available yet), document it here:

| Package | CVE | Severity | Reason for acceptance | Ticket | Review by |
|---|---|---|---|---|---|
| _(none)_ | — | — | — | — | — |

---

## bun audit: npm advisory scan

**Baseline date:** 2026-06-13  
**Result:** ✅ Zero high/critical advisories

`bun audit --level high` checks the npm advisory registry for all direct and
transitive dependencies. High and critical findings block merge.

---

## Semgrep OWASP Top 10 (informational)

The OWASP Top 10 ruleset runs in non-blocking mode. Findings are uploaded as CI
artifacts and reviewed periodically. They do not block PRs but must be triaged
before each production release.

---

## How to add a suppression

1. Add `// nosemgrep: <rule-id>` on the same line as the finding.
2. Add a row to the "Suppressed findings" table above.
3. Link the PR where the suppression was added.
4. Get a second-eyes review from the team before merging.

Suppressions covering card-data rules (`pan-near-log`, `pan-in-audit`) require
explicit approval from Gian + one other team member before merge.

---

## Rotation schedule

| Item | Cadence | Owner |
|---|---|---|
| Re-run Grype on `main` | Weekly (Monday) | Gian |
| Review OWASP informational findings | Monthly | Gian |
| Update this baseline after each phase release | Per release | Gian |
| Review suppressed findings | Quarterly | Gian + team |
