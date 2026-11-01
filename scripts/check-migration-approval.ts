#!/usr/bin/env bun
// CI gate — AT-170, owner decision by Nikao, 21 Oct 2026.
//
// Fails if any migration from GATED_FROM_IDX on matches a risky pattern
// (DROP, column type change, DELETE/TRUNCATE/UPDATE, or payments / orders /
// order_items) without `-- favo:requires-approval` in its header. Without this
// the marker could be forgotten, and a risky migration would auto-apply on
// the next container start.
//
// Run: bun scripts/check-migration-approval.ts   (exit 0 = pass, 1 = fail)

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  APPROVAL_MARKER,
  GATED_FROM_IDX,
  unmarkedRiskyMigrations,
  type MigrationFile,
} from "../src/server/deploy/migration-approval";

const folder = process.argv[2] ?? "drizzle";
const journal: { idx: number; tag: string }[] = JSON.parse(
  readFileSync(join(folder, "meta", "_journal.json"), "utf8"),
).entries;

const files: MigrationFile[] = journal.map((e) => ({
  idx: e.idx,
  tag: e.tag,
  sql: readFileSync(join(folder, `${e.tag}.sql`), "utf8"),
}));

const offenders = unmarkedRiskyMigrations(files);
if (offenders.length > 0) {
  console.error(`✖ risky migration(s) without the approval marker (gated from idx ${GATED_FROM_IDX}):`);
  for (const o of offenders) console.error(`  - drizzle/${o.tag}.sql: ${o.reasons.join(", ")}`);
  console.error(
    `Add "-- ${APPROVAL_MARKER} <reason>" to the file's leading comment block. It will then need FAVO_APPROVE_MIGRATION=<tag> to apply (docs/production-env-checklist.md).`,
  );
  process.exit(1);
}
const gated = files.filter((f) => f.idx >= GATED_FROM_IDX).length;
console.log(`✓ migration approval markers: ${gated} gated migration(s) checked, none unmarked`);
