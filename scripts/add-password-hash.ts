// One-shot migration: add password_hash to customers table.
// Run: bun scripts/add-password-hash.ts

import postgres from "postgres";

const url = process.env.DATABASE_URL_SESSION;
if (!url) throw new Error("DATABASE_URL_SESSION not set");

const sql = postgres(url, { max: 1, ssl: "require" });

try {
  await sql`ALTER TABLE customers ADD COLUMN IF NOT EXISTS password_hash text`;
  console.log("✓ password_hash column added (or already existed)");
} finally {
  await sql.end();
}
