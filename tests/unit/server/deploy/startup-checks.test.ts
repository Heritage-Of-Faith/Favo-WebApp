// AT-170 — release-time checks used by scripts/migrate.ts and /api/healthz.

import { describe, it, expect } from "vitest";
import { findJournalDrift, missingDatabaseEnv } from "@/server/deploy/startup-checks";

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

  it("is clean on a fresh database", () => {
    expect(findJournalDrift([], journal)).toEqual([]);
  });

  it("is clean when applied rows are a prefix of the journal (bigint created_at arrives as a string)", () => {
    expect(findJournalDrift([{ created_at: "100" }, { created_at: "200" }], journal)).toEqual([]);
  });

  it("is clean when everything is applied", () => {
    expect(findJournalDrift([{ created_at: 100 }, { created_at: 200 }, { created_at: 300 }], journal)).toEqual([]);
  });

  it("flags an applied row the journal does not list (the 0027 renumbering)", () => {
    const drift = findJournalDrift([{ created_at: 100 }, { created_at: 250 }], journal);
    expect(drift).toHaveLength(2);
    expect(drift[0]).toContain("created_at 250");
    // 0001_b (200) is older than the newest applied row and was never applied.
    expect(drift[1]).toContain("0001_b");
  });

  it("flags a file inserted out of order, which drizzle would skip silently", () => {
    const drift = findJournalDrift(
      [{ created_at: 100 }, { created_at: 300 }],
      journal,
    );
    expect(drift).toEqual([expect.stringContaining("0001_b")]);
  });
});
