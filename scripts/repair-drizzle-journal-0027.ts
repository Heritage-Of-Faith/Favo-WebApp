// One-time journal repair (2026-07-09).
//
// When the AT-145 migration was renumbered 0026→0027 after PR #211 claimed
// 0026 first, its SQL had already been applied to production under the old
// file identity — drizzle.__drizzle_migrations row 28 recorded the OLD file's
// timestamp (1783419042305) and hash. The regenerated 0027 file carries a
// newer folderMillis (1783425247744), so `drizzle-kit migrate` believes 0027
// is unapplied and re-runs it, failing on "column already exists".
//
// Fix: point row 28 at the renumbered file's timestamp + hash. No schema SQL
// runs — this only makes the journal say what is already true.
//
// Run: DATABASE_URL="$DATABASE_URL_SESSION" bun scripts/repair-drizzle-journal-0027.ts

import postgres from "postgres";
import { createHash } from "crypto";
import { readFileSync } from "fs";

const OLD_CREATED_AT = "1783419042305"; // what prod recorded for the pre-renumber file
const NEW_CREATED_AT = "1783425247744"; // 0027's folderMillis in drizzle/meta/_journal.json

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set — use DATABASE_URL_SESSION (port 5432).");

const newHash = createHash("sha256")
  .update(readFileSync("drizzle/0027_at145_customisation_inventory_effects.sql"))
  .digest("hex");

const sql = postgres(url, { prepare: false, max: 1 });

const updated = await sql`
  UPDATE drizzle.__drizzle_migrations
  SET created_at = ${NEW_CREATED_AT}, hash = ${newHash}
  WHERE created_at = ${OLD_CREATED_AT}
  RETURNING id, created_at
`;

if (updated.length !== 1) {
  console.error(`Expected exactly 1 row, matched ${updated.length} — no changes kept, investigate.`);
  process.exit(1);
}
console.log(`Repaired journal row id=${updated[0].id} → created_at=${updated[0].created_at}`);
await sql.end();
