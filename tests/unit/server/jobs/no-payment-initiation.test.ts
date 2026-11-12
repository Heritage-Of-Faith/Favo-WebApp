// §9.6.2 rule 2, REQ-066, §12.3, DEC-29 — no scheduled job may start a
// payment, initiate a tender, create revenue or write payments.status.
//
// A source scan, not a behaviour test: it walks the static import graph of the
// job register (src/server/jobs/registry.ts) through src/ and db/ and asserts
// that nothing a job can reach calls a tender initiator or writes `payments`.
//
// The one documented exception is job 4 (src/server/crons/unconfirmed-
// payments.ts): REQ-066 lets a timer "attach a payment Yoco confirms exists",
// through resolveTenderByLookup (writer 2 of payments.status, §10.2.1). The
// walk does not descend from that file into the tender chain, and that file is
// itself held to the same forbidden-call list. DEC-29's jobs 8–10 get no
// exception at all: their whole graph may not import the tender, Yoco or fund
// modules.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../../..");

/**
 * Calls that start a payment or a tender (the send chain, §6.8), poll one, or
 * move fund money (§6.10) — CHANGED (review): the fund movers and pollers added.
 */
const FORBIDDEN_CALL = new RegExp(
  "\\b(" +
    [
      "beginTender", "sendToTerminal", "createCheckout", "startTender", "sendTender", "pollTender",
      "beginFundTender", "recordTenderResult", "pollTenderResult",
      "sendFundTopup", "pollFundTopup", "resolveFundTopupByLookup",
      "topUpDonorFund", "drawFromDonorFund", "sweepDonorFund", "compensateFundDraw",
    ].join("|") +
    ")\\s*\\(",
);
const SQL_PAYMENTS_WRITE = /\b(UPDATE|INSERT INTO|DELETE FROM)\s+payments\b/;

/** Every local name the payments table goes by: `payments`, `payments as p`, `const p = payments`. */
function paymentsAliases(src: string): string[] {
  const names = new Set(["payments"]);
  for (const m of src.matchAll(/\bpayments\s+as\s+(\w+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=\s*(?:schema\.)?payments\b/g)) names.add(m[1]);
  return [...names];
}

/** A Drizzle write (through any alias) or a SQL write to payments. */
function writesPayments(src: string): boolean {
  if (SQL_PAYMENTS_WRITE.test(src)) return true;
  return paymentsAliases(src).some((a) =>
    new RegExp(`\\.(update|insert|delete)\\(\\s*(?:schema\\.)?${a}\\s*\\)`).test(src),
  );
}
/** Modules a DEC-29 job may not reach at all. */
const PAYMENT_MODULE = /^@\/server\/(tender|yoco|funds)(\/|$)|^@\/server\/actions\/(tender|funds)$/;

/** Job 4's REQ-066 lookup: the walk does not descend from it into these. */
const JOB4 = "src/server/crons/unconfirmed-payments.ts";

function resolveSpec(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, "src", spec.slice(2));
  else if (spec.startsWith("@db/")) base = join(ROOT, "db", spec.slice(4));
  else if (spec.startsWith(".")) base = resolve(dirname(join(ROOT, from)), spec);
  else return null; // a package
  for (const c of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), base]) {
    if (existsSync(c) && c.match(/\.tsx?$/)) return c.slice(ROOT.length + 1);
  }
  return null;
}

/**
 * Value imports and re-exports (`import type` carries no code), plus dynamic
 * `import("…")` and `require("…")` — CHANGED (review): dynamic forms added.
 */
function importsOf(src: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)\s+(?!type\s)(?:[\s\S]*?\sfrom\s+)?["']([^"']+)["']/g;
  for (let m = re.exec(src); m; m = re.exec(src)) out.push(m[1]);
  for (const m of src.matchAll(/\b(?:import|require)\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) out.push(m[1]);
  return out;
}

function walk(entry: string, stop: (from: string, spec: string) => boolean = () => false) {
  const seen = new Map<string, string[]>();
  const queue = [entry];
  while (queue.length) {
    const f = queue.shift()!;
    if (seen.has(f)) continue;
    const specs = importsOf(readFileSync(join(ROOT, f), "utf8"));
    seen.set(f, specs);
    for (const s of specs) {
      if (stop(f, s)) continue;
      const r = resolveSpec(s, f);
      if (r && !seen.has(r)) queue.push(r);
    }
  }
  return seen;
}

/** Code only: a comment may name the chain (db/schema.ts: "read once … at beginTender"). */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const read = (f: string) => stripComments(readFileSync(join(ROOT, f), "utf8"));

describe("no scheduled job initiates a payment (§9.6.2 rule 2, REQ-066, DEC-29)", () => {
  const graph = walk("src/server/jobs/registry.ts", (from, spec) => from === JOB4 && PAYMENT_MODULE.test(spec));

  it("the walk reaches every job module", () => {
    for (const f of [
      "src/server/jobs/deferred-reminder.ts", "src/server/jobs/import-watch.ts", "src/server/jobs/shift-reminder.ts",
      "src/server/deferred/drizzle-store.ts", JOB4, "src/server/crons/close-daily.ts",
    ]) expect(graph.has(f), f).toBe(true);
  });

  it("nothing a job reaches calls a tender or payment initiator", () => {
    const hits = [...graph.keys()].filter((f) => FORBIDDEN_CALL.test(read(f)));
    expect(hits).toEqual([]);
  });

  it("nothing a job reaches writes the payments table", () => {
    const hits = [...graph.keys()].filter((f) => writesPayments(read(f)));
    expect(hits).toEqual([]);
  });

  it("only job 4 imports the tender chain (REQ-066's lookup), and nothing else in the register does", () => {
    const importers = [...graph.entries()].filter(([, specs]) => specs.some((s) => PAYMENT_MODULE.test(s))).map(([f]) => f);
    expect(importers).toEqual([JOB4]);
  });

  it.each([
    "src/server/jobs/deferred-reminder.ts",
    "src/server/jobs/import-watch.ts",
    "src/server/jobs/shift-reminder.ts",
  ])("DEC-29 job %s reaches no tender, Yoco or fund module at all", (entry) => {
    const g = walk(entry);
    const reached = [...g.entries()].flatMap(([f, specs]) => specs.filter((s) => PAYMENT_MODULE.test(s)).map((s) => `${f} -> ${s}`));
    expect(reached).toEqual([]);
    expect([...g.keys()].some((f) => /src\/server\/(tender|yoco|funds)\//.test(f))).toBe(false);
  });

  it("the scan's patterns catch what they claim to (self-check)", () => {
    expect(FORBIDDEN_CALL.test("await beginTender(deps, actor, id)")).toBe(true);
    expect(FORBIDDEN_CALL.test("sendToTerminal (x)")).toBe(true);
    expect(FORBIDDEN_CALL.test("const r = await resolveTenderByLookup(d, SYSTEM, id)")).toBe(false);
    for (const fn of ["sendFundTopup", "topUpDonorFund", "drawFromDonorFund", "sweepDonorFund", "compensateFundDraw", "pollTender", "pollFundTopup", "resolveFundTopupByLookup"]) {
      expect(FORBIDDEN_CALL.test(`await ${fn}(x)`), fn).toBe(true);
    }
    expect(writesPayments("tx.update(payments).set({ status: 'successful' })")).toBe(true);
    expect(writesPayments("db.select().from(payments)")).toBe(false);
    expect(writesPayments('import { payments as p } from "@db/schema";\nawait db.update(p).set({ status: "successful" });')).toBe(true);
    expect(writesPayments("const t = schema.payments;\nawait db.insert(t).values(row);")).toBe(true);
    expect(writesPayments('import { payments as p } from "@db/schema";\nawait db.select().from(p);')).toBe(false);
    expect(writesPayments("await db.execute(sql`UPDATE payments SET status = 'x'`)")).toBe(true);
    expect(importsOf('const m = await import("@/server/tender/tender");\nconst r = require("./r");')).toEqual(["@/server/tender/tender", "./r"]);
    expect(stripComments("// beginTender(x)\nfoo(); /* sendToTerminal(y) */")).not.toMatch(FORBIDDEN_CALL);
    expect(stripComments('fetch("https://a"); beginTender(z)')).toMatch(FORBIDDEN_CALL);
    expect(importsOf('import type { X } from "@/server/tender/types";\nimport { y } from "./y";')).toEqual(["./y"]);
  });
});
