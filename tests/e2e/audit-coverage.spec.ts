/**
 * Standalone Audit Coverage Spec — AT-81 (G23)
 *
 * Run this spec after any integration or E2E flow to assert no mutations escaped
 * the audit log. Requires TEST_AUDIT_SECRET env var pointing to a live server with
 * the /api/admin/audit-coverage endpoint available.
 *
 * Skip condition: TEST_AUDIT_SECRET not set (safe to omit in dev environments).
 */

import { test, expect } from "@playwright/test";

test.describe("audit-coverage", () => {
  test("GET /api/admin/audit-coverage → 403 when secret is missing", async ({
    request,
  }) => {
    // Endpoint must refuse access without the secret regardless of environment.
    const res = await request.get("/api/admin/audit-coverage");
    expect([403, 404]).toContain(res.status());
  });

  test("GET /api/admin/audit-coverage with wrong secret → 403", async ({
    request,
  }) => {
    const res = await request.get(
      "/api/admin/audit-coverage?secret=definitely-not-the-right-secret"
    );
    // 403 when endpoint exists; 404 if env var not set and endpoint returns 403 via JSON.
    expect(res.status()).toBe(403);
  });

  test("no recent orders lack an audit row (requires TEST_AUDIT_SECRET)", async ({
    request,
  }) => {
    const secret = process.env.TEST_AUDIT_SECRET ?? "";
    if (!secret) {
      test.skip();
      return;
    }

    const res = await request.get(
      `/api/admin/audit-coverage?secret=${encodeURIComponent(secret)}`
    );
    expect(res.status()).toBe(200);

    const body = (await res.json()) as { ok: boolean; gapCount: number };
    expect(
      body.gapCount,
      `Audit gap detected: ${body.gapCount} order(s) have no audit_log row`
    ).toBe(0);
    expect(body.ok).toBe(true);
  });
});
