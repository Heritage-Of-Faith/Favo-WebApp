// AT-169 — the scheduler on/off switch.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/server/jobs/registry", () => ({ JOBS: [] }));
vi.mock("@/server/jobs/store", () => ({ auditJobStore: {} }));
vi.mock("@/server/jobs/alert", () => ({ pushAdminsOnFailure: vi.fn() }));
import { schedulerEnabled } from "@/server/jobs/start";

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
