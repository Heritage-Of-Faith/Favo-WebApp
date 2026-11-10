/**
 * Standalone Audit Coverage Spec — AT-81 (G23), REQ-064
 *
 * Run this spec after any integration or E2E flow to assert no mutations escaped
 * the audit log. GET /api/admin/audit-coverage is admin-only (PRD v7 access
 * matrix) and answers `200 {mutations, audited, coverage_pct, gaps:[...]}`.
 *
 * Seeded data:
 *   Barista: Sam Barista  PIN 1234  id: staff_barista_sam
 *   Admin:   Mia Manager  PIN 4321  id: staff_manager_mia
 */

import { test, expect, type Page } from "@playwright/test";

async function loginWithPin(page: Page, pin: string): Promise<void> {
  await page.goto("/pos", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /enter your pin/i })).toBeVisible();
  await expect(page.getByLabel(`Digit ${pin[0]}`)).toBeEnabled({ timeout: 15_000 });
  for (const digit of pin) {
    await page.getByLabel(`Digit ${digit}`).click();
  }
  await expect(page.getByLabel("Confirm PIN")).toBeEnabled({ timeout: 5_000 });
  await page.getByLabel("Confirm PIN").click();
  await expect(page.getByRole("heading", { name: /enter your pin/i })).not.toBeVisible({
    timeout: 30_000,
  });
}

test.describe("audit-coverage", () => {
  test("GET /api/admin/audit-coverage without a session → 401", async ({ request }) => {
    const res = await request.get("/api/admin/audit-coverage");
    expect(res.status()).toBe(401);
  });

  test("a ?secret= query parameter grants nothing → 401", async ({ request }) => {
    const res = await request.get("/api/admin/audit-coverage?secret=anything");
    expect(res.status()).toBe(401);
  });

  test("barista session → 403", async ({ page }) => {
    await loginWithPin(page, "1234");
    const res = await page.context().request.get("/api/admin/audit-coverage");
    expect(res.status()).toBe(403);
  });

  test("admin session: no recent orders lack an audit row (0 orphans)", async ({ page }) => {
    await loginWithPin(page, "4321");
    const res = await page.context().request.get("/api/admin/audit-coverage");
    expect(res.status()).toBe(200);

    const body = (await res.json()) as {
      mutations: number;
      audited: number;
      coverage_pct: number;
      gaps: string[];
    };
    expect(
      body.gaps,
      `Audit gap detected: ${body.gaps.length} order(s) have no audit_log row`
    ).toEqual([]);
    expect(body.coverage_pct).toBe(100);
    expect(body.audited).toBe(body.mutations);
  });
});
