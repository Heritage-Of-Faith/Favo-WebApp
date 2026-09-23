#!/usr/bin/env bun
/**
 * scripts/verify-v7.ts — the machine-checkable half of PRD v7.0 conformance.
 *
 * Put this at `scripts/verify-v7.ts` in the repo root and run `bun scripts/verify-v7.ts`.
 * Add it to `package.json` as `"verify": "bun scripts/verify-v7.ts"` and to the
 * `check` script so it runs on every commit:
 *     "check": "bun typecheck && bun lint && bun test:unit && bun verify"
 *
 * WHY THIS EXISTS
 * ---------------
 * Claude writes the code, so review throughput — not typing — is the constraint.
 * Every gate below is a thing a human would otherwise have to read a diff to check.
 * A gate that passes costs nothing; a gate that fails names the file and the line.
 *
 * WHAT IT IS NOT
 * --------------
 * It is not a substitute for reviewing money logic. It catches *shapes*, not
 * arithmetic. FIXTURE-A and FIXTURE-B (REQ-117/118) are the arithmetic bar, and
 * they live in the test suite, written by a human.
 *
 * Exit code 0 = all gates pass. 1 = at least one FAIL. Warnings never fail the run.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

type Severity = "FAIL" | "WARN";
type Result = { name: string; ok: boolean; severity: Severity; detail: string };

const results: Result[] = [];
const SRC = "src/ db/";

class GrepError extends Error {}

/**
 * Run a shell command and return stdout.
 *
 * grep exits 1 on "no match" (normal here — usually the passing case) and 2 on
 * a malformed pattern. Those must NOT be conflated: a bad pattern that returns
 * "" makes a mustBeAbsent() gate pass silently, which is exactly the failure
 * this whole script exists to prevent. Ask me how I know.
 */
function sh(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 1) return ""; // genuine no-match
    throw new GrepError(`command failed with exit ${status}: ${cmd}`);
  }
}

function record(name: string, ok: boolean, detail: string, severity: Severity = "FAIL") {
  results.push({ name, ok, severity, detail });
}

/**
 * A "must be gone" gate. v7.0 §10.1 specifies several of these as literal greps.
 * `paths` defaults to src/ and db/ because migration history legitimately keeps
 * references to tables that later migrations drop.
 */
function mustBeAbsent(name: string, pattern: string, paths = SRC, severity: Severity = "FAIL") {
  let hits: string;
  try {
    hits = sh(`grep -rIn '${pattern}' ${paths}`).trim();
  } catch (e) {
    return record(name, false, `GATE IS BROKEN — ${(e as Error).message}`, "FAIL");
  }
  record(
    name,
    hits === "",
    hits === ""
      ? "no matches"
      : `${hits.split("\n").length} match(es):\n      ${hits.split("\n").slice(0, 8).join("\n      ")}`,
    severity
  );
}

function mustBePresent(name: string, pattern: string, paths = SRC, severity: Severity = "FAIL") {
  let hits: string;
  try {
    hits = sh(`grep -rIn '${pattern}' ${paths}`).trim();
  } catch (e) {
    return record(name, false, `GATE IS BROKEN — ${(e as Error).message}`, "FAIL");
  }
  record(name, hits !== "", hits !== "" ? `found: ${hits.split("\n")[0]}` : `NO match for /${pattern}/`, severity);
}

function fileMustNotContain(name: string, file: string, pattern: string, severity: Severity = "FAIL") {
  if (!existsSync(file)) return record(name, false, `${file} does not exist`, severity);
  const body = readFileSync(file, "utf8");
  const re = new RegExp(pattern);
  record(name, !re.test(body), re.test(body) ? `${file} still matches /${pattern}/` : "clean", severity);
}

function fileMustContain(name: string, file: string, pattern: string, severity: Severity = "FAIL") {
  if (!existsSync(file)) return record(name, false, `${file} does not exist`, severity);
  const body = readFileSync(file, "utf8");
  const re = new RegExp(pattern);
  record(name, re.test(body), re.test(body) ? "present" : `${file} does not match /${pattern}/`, severity);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. BUILD INTEGRITY — the gate that makes every other gate meaningful
// ─────────────────────────────────────────────────────────────────────────────
// With `ignoreBuildErrors: true`, a half-finished deletion of ~4,700 lines
// builds green with live type errors in it, including in the offline path.
// This is the single highest-value line in the file.
fileMustNotContain(
  "next.config: ignoreBuildErrors is gone",
  "next.config.ts",
  "ignoreBuildErrors\\s*:\\s*true"
);
fileMustContain(
  "next.config: output is standalone (needed for the container)",
  "next.config.ts",
  'output\\s*:\\s*["\']standalone["\']',
  "WARN"
);
// §9 targets an always-on VM on Transformate. Something has to build the image.
record(
  "Dockerfile exists (§9 deploys a container; nothing in this repo builds one)",
  existsSync("Dockerfile"),
  existsSync("Dockerfile") ? "present" : "no Dockerfile in repo root",
  "WARN"
);
// §9.2: Postgres is co-located on the same host, direct connection — the
// PgBouncer workaround is REMOVED and prepared statements re-enabled. This gate
// is a WARN because it must stay TRUE until the move and FALSE after it; it
// flips deliberately, in the same change that switches the connection.
record(
  "db/index.ts still has prepare:false (correct pre-move; remove it WITH the Transformate switch)",
  existsSync("db/index.ts") && /prepare:\s*false/.test(readFileSync("db/index.ts", "utf8")),
  existsSync("db/index.ts")
    ? (/prepare:\s*false/.test(readFileSync("db/index.ts", "utf8"))
        ? "present — right for the Supabase pooler"
        : "absent — correct ONLY if the direct-connection move has landed")
    : "db/index.ts not found",
  "WARN"
);
// favo.hofmi.org never existed. §9.3: the public URL is favo.hofmi.net.
mustBeAbsent("no favo.hofmi.org (that domain never existed)", "favo\\.hofmi\\.org", "src/ db/", "WARN");

// ─────────────────────────────────────────────────────────────────────────────
// 2. DELETION GATES — v7.0 §10.1, as literal greps
// ─────────────────────────────────────────────────────────────────────────────
// Each of these replaces a human reading a large deletion diff.
mustBeAbsent("loyalty is gone", "loyalt");
mustBeAbsent("coffee packs are gone", "coffee_pack\\|coffeePack\\|packRedemption\\|purchasePack");
mustBeAbsent("pending_charges is gone", "pending_charges\\|pendingCharges");
mustBeAbsent("sync_conflicts is gone", "sync_conflicts\\|syncConflicts");
mustBeAbsent("magic_link_tokens is gone", "magic_link_tokens\\|magicLinkToken");
mustBeAbsent("Discord is gone", "discord\\|DISCORD");
mustBeAbsent("retry-deferred cron is gone", "retryDeferred\\|retry-deferred\\|retry_deferred");

// L02 — no refunds, ever. The remedy for a wrong charge is a comped drink.
// NB: this pattern deliberately does not match the word "refundable", which is
// legitimate in blessing-fund copy ("non-refundable").
mustBeAbsent(
  "refunds are gone (table, enum, stubs, API call, webhook branch)",
  "refundStatus\\|createRefund\\|requestRefund\\|approveRefund\\|refund_status\\|refund\\.succeeded\\|formatRefundLine\\|canApproveRefund\\|pgTable(\"refunds\"\\|'refunded'"
);

// The word itself, not just the code. v7.0 requires it nowhere.
mustBeAbsent("the word 'wallet' appears nowhere", "wallet\\|Wallet", "src/ db/ tests/");

// ─────────────────────────────────────────────────────────────────────────────
// 3. THINGS THAT MUST SURVIVE THE DELETION PASS
// ─────────────────────────────────────────────────────────────────────────────
// The offline idempotency guarantee. Easy to lose while ripping out the
// reconciliation layer that sits next to it.
mustBePresent("outbox_log.client_uuid UNIQUE survives", "clientUuid", "db/schema.ts");
mustBePresent("the offline outbox itself survives", "outboxLog\\|outbox_log", "db/ src/");
mustBePresent("deductForOrder is still modification-aware (0027)", "substitutesInventoryItemId", "src/server/orders/deduction.ts");
mustBePresent("opening_sessions keeps UNIQUE(session_date, opens_at)", "session_date.*opens_at\\|sessionDate.*opensAt", "db/schema.ts drizzle/0029_at134_opening_sessions.sql");

// ─────────────────────────────────────────────────────────────────────────────
// 4. MONEY SHAPE — REQ-101, REQ-106, REQ-109
// ─────────────────────────────────────────────────────────────────────────────
// REQ-101: integer cents everywhere, with exactly one sanctioned exception.
{
  const numericMoney = sh(
    `grep -rIn 'numeric(' db/schema.ts 2>/dev/null | grep -i '_zar' | grep -v 'unit_cost_zar'`
  ).trim();
  record(
    "REQ-101: no numeric() money column except inventory_lots.unit_cost_zar",
    numericMoney === "",
    numericMoney === "" ? "only the sanctioned exception" : numericMoney,
  );
}
// And the exception must still be there — someone "tidying" it to integer cents
// would silently destroy sub-cent ingredient costs.
mustBePresent(
  "the unit_cost_zar numeric(10,4) exception is intact",
  'numeric("unit_cost_zar"',
  "db/schema.ts"
);

// REQ-106: one rounding point, per order, at order_cogs. There is no `order_cogs`
// in the repo today and four different files round at four different grains.
mustBePresent("REQ-106: an order_cogs column/field exists", "order_cogs\\|orderCogs", "db/ src/");
{
  const periodRounding = sh(
    `grep -rIln 'ROUND(SUM(\\|Math.round(.*sum\\|round(sum' src/ drizzle/ 2>/dev/null`
  ).trim();
  record(
    "REQ-106: no period-grain rounding of COGS (ROUND outside SUM)",
    periodRounding === "",
    periodRounding === "" ? "none found" : `rounds at period grain in:\n      ${periodRounding.split("\n").join("\n      ")}`,
  );
}

// REQ-109: an absent cost input must REFUSE and name the item — never be filtered
// out. A filter makes COGS smaller and profit larger, silently.
{
  const silentDrop = sh(
    `grep -rIn 'unit_cost_zar IS NOT NULL\\|unitCostZar.*isNotNull' src/ drizzle/ 2>/dev/null`
  ).trim();
  record(
    "REQ-109: absent cost inputs are not silently filtered out",
    silentDrop === "",
    silentDrop === "" ? "no IS NOT NULL filter on cost" : silentDrop,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE THREE RENDER STATES — REQ-110, REQ-129, REQ-131
// ─────────────────────────────────────────────────────────────────────────────
// zeroes ≠ UNAVAILABLE ≠ provisional. Today only the first exists.
mustBePresent("REQ-129: UNAVAILABLE is a real render state", "UNAVAILABLE", "src/");
mustBePresent("REQ-131: cost_source exists on the lot", "cost_source\\|costSource", "db/schema.ts");
// REQ-110: provisional must never render green. This catches the specific live
// defect: tone keyed off the sign of net alone, ignoring the estimate flag.
{
  const nakedGreen = sh(
    `grep -rIn 'netZar >= 0\\|netZar > 0' src/components/ 2>/dev/null`
  ).trim();
  record(
    "REQ-110: net tone is not keyed off the sign of net alone",
    nakedGreen === "",
    nakedGreen === "" ? "clean" : `green-on-estimates risk:\n      ${nakedGreen}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. PAYMENT SAFETY — REQ-011, REQ-071, REQ-153
// ─────────────────────────────────────────────────────────────────────────────
// REQ-071: no Yoco key of any kind reaches the client bundle.
mustBeAbsent("REQ-071: no NEXT_PUBLIC_ Yoco key in the client bundle", "NEXT_PUBLIC_YOCO");

// REQ-011: one successful payment per order, enforced by the database.
{
  const hasIdx = sh(
    `grep -rIl "status = 'successful'\\|status='successful'" drizzle/*.sql 2>/dev/null`
  ).trim();
  record(
    "REQ-011: partial unique index on (order_id) WHERE status='successful'",
    hasIdx !== "",
    hasIdx !== "" ? `declared in ${hasIdx.split("\n")[0]}` : "no partial unique index found in drizzle/",
  );
}

// REQ-153 / REQ-149: a net-R0 order writes no payment row and sends nothing to a
// terminal. Today createOrder inserts one unconditionally, whatever the total.
//
// WEAK GATE, DELIBERATELY MARKED AS SUCH. It matches any zero-total branch in
// the file, and one already exists at orders.ts:343 for a different purpose, so
// it passes on today's broken code. It is here to catch a *regression* once the
// behaviour is right — never as evidence that it is. The real bar is a test:
// "a weekday order produces zero rows in payments". Do not read a green tick
// here as REQ-153 being satisfied.
mustBePresent(
  "REQ-153 (weak proxy): a zero-total branch exists in createOrder",
  "totalZar > 0\\|totalZar === 0\\|isFree\\|payment_mode.*free\\|paymentMode.*free",
  "src/server/actions/orders.ts",
  "WARN"
);

// ─────────────────────────────────────────────────────────────────────────────
// 7. AUTH — the three one-line fixes that are easy to defer and shouldn't be
// ─────────────────────────────────────────────────────────────────────────────
fileMustContain("staff sessions have an explicit maxAge", "auth.ts", "maxAge");
mustBePresent(
  "loginWithPin is rate limited",
  "checkRateLimit",
  "src/server/actions/auth.ts"
);
{
  // Two route gates must not coexist — only one runs, and which one is undefined.
  const both = existsSync("proxy.ts") && existsSync("src/middleware.ts");
  record(
    "exactly one route gate (proxy.ts XOR src/middleware.ts)",
    !both,
    both ? "BOTH proxy.ts and src/middleware.ts exist — only one runs, and the role check is in proxy.ts" : "single gate",
  );
}
record(
  "the audit-coverage test endpoint is gone from production code",
  !existsSync("src/app/api/admin/audit-coverage/route.ts"),
  existsSync("src/app/api/admin/audit-coverage/route.ts")
    ? "still present — no session check, secret via query param"
    : "removed",
  "WARN"
);

// ─────────────────────────────────────────────────────────────────────────────
// 8. STANDING PROHIBITIONS — §7 of CLAUDE.md, as code
// ─────────────────────────────────────────────────────────────────────────────
mustBeAbsent("no cron writes payments.status", "resolvedBy:\\s*[\"']retry_cron");
mustBeAbsent("no voided payment status", "voided", "db/enums.ts src/lib/types.ts");

// ─────────────────────────────────────────────────────────────────────────────
// 9. TEST-COUNT BAND — the cheapest regression check in the project
// ─────────────────────────────────────────────────────────────────────────────
// Baseline 942 (101 files) at main@3902e61. The deletion pass removes ~190.
// Below the floor means collateral damage; above the ceiling means a deletion
// was skipped. A human would argue about this for twenty minutes.
const BASELINE = 942;
const FLOOR = 740;
const CEILING = 760;
if (process.env.VERIFY_TEST_COUNT === "1") {
  const out = sh("bun test:unit 2>&1 | tail -20");
  const m = out.match(/Tests\s+(\d+)\s+passed/);
  if (!m) {
    record("test count is measurable", false, "could not parse vitest summary", "WARN");
  } else {
    const n = Number(m[1]);
    const inBand = n >= FLOOR && n <= CEILING;
    const preDeletion = n === BASELINE;
    record(
      `test count in the post-deletion band (${FLOOR}–${CEILING})`,
      inBand || preDeletion,
      preDeletion
        ? `${n} — still at the pre-deletion baseline, deletion pass not started`
        : inBand
          ? `${n} passed, in band`
          : n < FLOOR
            ? `${n} is BELOW ${FLOOR} — likely collateral damage, not deletion`
            : `${n} is ABOVE ${CEILING} — a deletion was probably skipped`,
      "WARN"
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// REPORT
// ─────────────────────────────────────────────────────────────────────────────
const fails = results.filter((r) => !r.ok && r.severity === "FAIL");
const warns = results.filter((r) => !r.ok && r.severity === "WARN");
const passes = results.filter((r) => r.ok);

console.log("\n  FAVO v7.0 conformance gates\n  " + "─".repeat(58));
for (const r of results) {
  const tag = r.ok ? "  ok  " : r.severity === "FAIL" ? " FAIL " : " warn ";
  console.log(`  [${tag}] ${r.name}`);
  if (!r.ok) console.log(`      ${r.detail}`);
}
console.log("  " + "─".repeat(58));
console.log(`  ${passes.length} passed · ${fails.length} failed · ${warns.length} warnings\n`);

if (fails.length > 0) {
  console.log("  Gates that FAIL block the commit. Each names its file and line.");
  console.log("  If you believe a gate is wrong, say so — do not weaken the gate.\n");
  process.exit(1);
}
process.exit(0);
