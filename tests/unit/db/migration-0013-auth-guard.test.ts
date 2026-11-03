// G1 (docs/GO_LIVE_RUNBOOK.md §8): the Transformate database (PRD §9) has no
// Supabase auth schema. 0013's FK to auth.users must stay inside a guard that
// skips it when auth.users is absent, or a clean migration run fails at 0013.
// CI's "Migrate a clean database with no Supabase auth schema" step proves the
// behaviour; this test stops the guard being removed unnoticed.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const DRIZZLE = join(process.cwd(), "drizzle");
const sql0013 = readFileSync(join(DRIZZLE, "0013_loving_gamma_corps.sql"), "utf8");

/** drizzle runs each "--> statement-breakpoint" chunk as one statement. */
const statements = sql0013.split("--> statement-breakpoint");

describe("0013 customers_auth_id_fk is guarded (G1)", () => {
  it("adds the FK only inside a DO block that checks to_regclass('auth.users')", () => {
    const withFk = statements.filter((s) => s.includes("REFERENCES auth.users"));
    expect(withFk).toHaveLength(1);
    const stmt = withFk[0];
    expect(stmt).toMatch(/DO \$\$/);
    expect(stmt).toMatch(/IF to_regclass\('auth\.users'\) IS NOT NULL THEN\s+ALTER TABLE "customers" ADD CONSTRAINT "customers_auth_id_fk"/);
    expect(stmt).toMatch(/END IF;\s+END \$\$;/);
  });

  it("no migration references auth.users outside that guard", () => {
    const hits = readdirSync(DRIZZLE)
      .filter((f) => f.endsWith(".sql"))
      .flatMap((f) =>
        readFileSync(join(DRIZZLE, f), "utf8")
          .split("--> statement-breakpoint")
          .filter((s) => /\bauth\.users\b/.test(s) && !/to_regclass\('auth\.users'\) IS NOT NULL/.test(s))
          .map(() => f),
      );
    expect(hits).toEqual([]);
  });
});
