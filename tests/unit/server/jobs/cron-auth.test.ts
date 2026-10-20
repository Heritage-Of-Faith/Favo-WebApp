// AT-169 — one auth scheme for the manual /api/crons/* triggers, and the
// scheduler on/off switch.

import { describe, it, expect, afterEach, vi } from "vitest";
import { requireCronSecret } from "@/server/jobs/cron-auth";

vi.mock("@/server/jobs/registry", () => ({ JOBS: [] }));
vi.mock("@/server/jobs/store", () => ({ auditJobStore: {} }));
vi.mock("@/server/jobs/alert", () => ({ pushAdminsOnFailure: vi.fn() }));
import { schedulerEnabled } from "@/server/jobs/start";

const req = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/crons/close-daily", { method: "POST", headers });

afterEach(() => vi.unstubAllEnvs());

describe("requireCronSecret", () => {
  it("answers 503 — not a silent 401 — when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = requireCronSecret(req({ authorization: "Bearer " }));
    expect(res?.status).toBe(503);
  });

  it("accepts the Bearer secret", () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect(requireCronSecret(req({ authorization: "Bearer s3cret" }))).toBeNull();
  });

  it.each([
    ["no header", {}],
    ["wrong secret", { authorization: "Bearer nope" }],
    ["the legacy x-cron-secret header", { "x-cron-secret": "s3cret" }],
    ["the raw secret without Bearer", { authorization: "s3cret" }],
  ])("rejects %s with 401", (_label, headers) => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect(requireCronSecret(req(headers as Record<string, string>))?.status).toBe(401);
  });
});

describe("schedulerEnabled", () => {
  it("is on in production and off elsewhere by default", () => {
    expect(schedulerEnabled({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(true);
    expect(schedulerEnabled({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(false);
    expect(schedulerEnabled({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).toBe(false);
  });

  it("honours an explicit SCHEDULER_ENABLED either way", () => {
    expect(schedulerEnabled({ NODE_ENV: "production", SCHEDULER_ENABLED: "false" } as NodeJS.ProcessEnv)).toBe(false);
    expect(schedulerEnabled({ NODE_ENV: "development", SCHEDULER_ENABLED: "true" } as NodeJS.ProcessEnv)).toBe(true);
  });
});
