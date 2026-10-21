// AT-170 — release-time checks used by scripts/migrate.ts and /api/healthz.

import { describe, it, expect } from "vitest";
import {
  findJournalDrift,
  missingDatabaseEnv,
  skipMigrationsDecision,
} from "@/server/deploy/startup-checks";

describe("missingDatabaseEnv", () => {
  it("passes when both URLs are set", () => {
    expect(missingDatabaseEnv({ DATABASE_URL: "postgres://a", DATABASE_URL_SESSION: "postgres://b" })).toEqual([]);
  });

  it("names DATABASE_URL_SESSION when it is unset", () => {
    expect(missingDatabaseEnv({ DATABASE_URL: "postgres://a" })).toEqual(["DATABASE_URL_SESSION"]);
  });

  it("treats a blank value as unset", () => {
    expect(missingDatabaseEnv({ DATABASE_URL: "  ", DATABASE_URL_SESSION: "" })).toEqual([
      "DATABASE_URL",
      "DATABASE_URL_SESSION",
    ]);
  });
});

describe("findJournalDrift", () => {
  const journal = [
    { tag: "0000_a", when: 100 },
    { tag: "0001_b", when: 200 },
    { tag: "0002_c", when: 300 },
  ];
  const clean = { problems: [], ahead: [] };

  it("is clean on a fresh database", () => {
    expect(findJournalDrift([], journal)).toEqual(clean);
  });

  it("is clean when applied rows are a prefix of the journal (bigint created_at arrives as a string)", () => {
    expect(findJournalDrift([{ created_at: "100" }, { created_at: "200" }], journal)).toEqual(clean);
  });

  it("is clean when everything is applied", () => {
    expect(findJournalDrift([{ created_at: 100 }, { created_at: 200 }, { created_at: 300 }], journal)).toEqual(clean);
  });

  it("refuses an unknown applied row inside the journal's range (the 0027 renumbering)", () => {
    const drift = findJournalDrift([{ created_at: 100 }, { created_at: 250 }], journal);
    expect(drift.ahead).toEqual([]);
    expect(drift.problems).toHaveLength(2);
    expect(drift.problems[0]).toContain("created_at 250");
    // 0001_b (200) is older than the newest applied row and was never applied.
    expect(drift.problems[1]).toContain("0001_b");
  });

  it("refuses a file inserted out of order, which drizzle would skip silently", () => {
    const drift = findJournalDrift([{ created_at: 100 }, { created_at: 300 }], journal);
    expect(drift.problems).toEqual([expect.stringContaining("0001_b")]);
  });

  it("allows a database ahead of the image (rollback): reported, not refused", () => {
    const drift = findJournalDrift(
      [{ created_at: 100 }, { created_at: 200 }, { created_at: 300 }, { created_at: "400" }, { created_at: 500 }],
      journal,
    );
    expect(drift).toEqual({ problems: [], ahead: [400, 500] });
  });

  it("still refuses an in-range unknown row when the database is also ahead", () => {
    const drift = findJournalDrift(
      [{ created_at: 100 }, { created_at: 150 }, { created_at: 200 }, { created_at: 300 }, { created_at: 400 }],
      journal,
    );
    expect(drift.ahead).toEqual([400]);
    expect(drift.problems).toEqual([expect.stringContaining("created_at 150")]);
  });

  it("still refuses an unapplied image file when the database is ahead", () => {
    const drift = findJournalDrift([{ created_at: 100 }, { created_at: 300 }, { created_at: 400 }], journal);
    expect(drift.ahead).toEqual([400]);
    expect(drift.problems).toEqual([expect.stringContaining("0001_b")]);
  });
});

describe("skipMigrationsDecision (one-shot per image)", () => {
  it("runs migrations when unset", () => {
    expect(skipMigrationsDecision({ IMAGE_SHA: "abc" })).toEqual({ skip: false });
  });

  it("skips, loudly, only when the value is this image's SHA", () => {
    const d = skipMigrationsDecision({ SKIP_MIGRATIONS: "abc", IMAGE_SHA: "abc" });
    expect(d.skip).toBe(true);
    expect(d.warning).toContain("NOT run");
  });

  it("ignores a value left over from an earlier image, and says so", () => {
    const d = skipMigrationsDecision({ SKIP_MIGRATIONS: "old", IMAGE_SHA: "new" });
    expect(d.skip).toBe(false);
    expect(d.warning).toContain("ignored");
  });

  it("never skips on a bare 1, or when the image SHA is unknown", () => {
    expect(skipMigrationsDecision({ SKIP_MIGRATIONS: "1", IMAGE_SHA: "abc" }).skip).toBe(false);
    expect(skipMigrationsDecision({ SKIP_MIGRATIONS: "abc" }).skip).toBe(false);
  });
});
