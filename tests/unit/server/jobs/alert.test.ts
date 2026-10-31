// AT-169 — the failure push names the job and period, never the raw error
// (a DB error can carry row values; it belongs in the audit row, not on a lock screen).

import { describe, it, expect } from "vitest";
import { buildJobFailurePayload } from "@/server/jobs/alert";

describe("buildJobFailurePayload", () => {
  it("names job and period and points at the audit row, without the error text", () => {
    const payload = JSON.parse(buildJobFailurePayload("closeDaily", "2026-10-20", 'duplicate key value (customer "Thandeka")'));
    expect(payload.title).toContain("closeDaily");
    expect(payload.body).toContain("2026-10-20");
    expect(payload.body).toContain("scheduled_job closeDaily:2026-10-20");
    expect(payload.body).not.toContain("Thandeka");
    expect(payload.body).not.toContain("duplicate key");
  });
});
