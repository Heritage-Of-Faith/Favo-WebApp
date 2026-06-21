// Standalone bun script — runs the loyalty reconciliation job and prints results.
// Usage: bun scripts/reconcile-loyalty.ts
// Requires DATABASE_URL in environment (set via .env.local or Vercel env vars).

import { reconcileLoyalty } from "@/server/actions/loyalty";

const result = await reconcileLoyalty();
if (!result.ok) {
  console.error("Reconciliation failed:", result.message);
  process.exit(1);
}
console.log(`Checked: ${result.data.checked}, Drifted: ${result.data.drifted}`);
if (result.data.rows.length) {
  console.table(result.data.rows);
}
