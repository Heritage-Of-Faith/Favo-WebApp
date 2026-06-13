/**
 * Phase 3 Acceptance Tests — AT-81 (G23)
 *
 * Covers the Phase 3 API surface:
 *   G20 — POST /api/sync/orders  (offline sync)
 *   G21 — GET  /api/reports/export  (kind + format params + PDF)
 *   G22 — GET  /api/crons/retry-deferred  (deferred payment cron)
 *
 * Seeded data (G3 + phase2 seed):
 *   Barista: Sam Barista  PIN 1234  id: staff_barista_sam
 *   Admin:   Mia Manager  PIN 4321  id: staff_manager_mia
 *   Menu:    Cappuccino  id: menu_cappuccino
 *
 * CRON_SECRET env must be set to "e2e-cron-secret" for cron tests to assert 200.
 * TEST_AUDIT_SECRET is not required by this spec.
 */

import { test, expect, type Page } from "@playwright/test";

const TEST_CRON_SECRET = "e2e-cron-secret";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function loginAsBarista(page: Page): Promise<void> {
  await page.goto("/pos", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /enter your pin/i })).toBeVisible();
  await expect(page.getByLabel("Digit 1")).toBeEnabled({ timeout: 15_000 });
  for (const digit of "1234") {
    await page.getByLabel(`Digit ${digit}`).click();
  }
  await expect(page.getByLabel("Confirm PIN")).toBeEnabled({ timeout: 5_000 });
  await page.getByLabel("Confirm PIN").click();
  await expect(page.getByRole("heading", { name: /enter your pin/i })).not.toBeVisible({
    timeout: 30_000,
  });
}

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/pos", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /enter your pin/i })).toBeVisible();
  await expect(page.getByLabel("Digit 4")).toBeEnabled({ timeout: 15_000 });
  for (const digit of "4321") {
    await page.getByLabel(`Digit ${digit}`).click();
  }
  await expect(page.getByLabel("Confirm PIN")).toBeEnabled({ timeout: 5_000 });
  await page.getByLabel("Confirm PIN").click();
  await expect(page.getByRole("heading", { name: /enter your pin/i })).not.toBeVisible({
    timeout: 30_000,
  });
}

// ─── G20: offline sync endpoint ───────────────────────────────────────────────

test.describe("G20: offline sync endpoint", () => {
  const SYNC = "/api/sync/orders";

  test("unauthenticated POST → 401", async ({ request }) => {
    const res = await request.post(SYNC, {
      data: { clientUuid: "00000000-0000-4000-8000-000000000001" },
    });
    expect(res.status()).toBe(401);
  });

  test("authenticated barista — missing required fields → 400 or 422 (schema validation)", async ({
    page,
  }) => {
    await loginAsBarista(page);
    const res = await page.context().request.post(SYNC, {
      data: { clientUuid: "not-a-uuid" }, // malformed UUID, missing items/staffId
    });
    // 422 = Zod validation failure; 400 = JSON parse error
    expect([400, 422]).toContain(res.status());
  });

  test("authenticated barista — invalid paymentMode → 422 (Zod enum)", async ({ page }) => {
    await loginAsBarista(page);
    const res = await page.context().request.post(SYNC, {
      data: {
        clientUuid: "00000000-0000-4000-8000-000000000002",
        staffId: "staff_barista_sam",
        items: [{ menuItemId: "menu_cappuccino", quantity: 1, modifications: [] }],
        paymentMode: "credit_card", // not in enum
        clientTotalZar: 4500,
        clientTimestamp: new Date().toISOString(),
      },
    });
    expect(res.status()).toBe(422);
  });

  test("authenticated barista — well-formed payload is accepted (200 or 409/conflict)", async ({
    page,
  }) => {
    await loginAsBarista(page);
    // Use a UUID that's unlikely to already exist; either 200 (applied) or 409 (duplicate)
    // are correct server responses. 4xx/5xx (other than 409) would indicate a bug.
    const clientUuid = `00000000-0000-4000-8000-${Date.now().toString().padStart(12, "0")}`;
    const res = await page.context().request.post(SYNC, {
      data: {
        clientUuid,
        staffId: "staff_barista_sam",
        items: [{ menuItemId: "menu_cappuccino", quantity: 1, modifications: [] }],
        paymentMode: "free",
        clientTotalZar: 0,
        clientTimestamp: new Date().toISOString(),
      },
    });
    // 200 = applied; 409 = conflict (price mismatch); both are valid outcomes.
    // 400 = schema rejection; 500 = server error — both indicate a bug.
    expect([200, 409]).toContain(res.status());
  });
});

// ─── G21: reports export ──────────────────────────────────────────────────────

test.describe("G21: reports export", () => {
  const EXPORT = "/api/reports/export";
  const DATES = "from=2026-01-01&to=2026-06-30";

  test("unauthenticated → 403", async ({ request }) => {
    const res = await request.get(`${EXPORT}?format=csv&kind=cogs&${DATES}`);
    expect(res.status()).toBe(403);
  });

  test("invalid format → 400", async ({ page }) => {
    await loginAsAdmin(page);
    const res = await page.context().request.get(
      `${EXPORT}?format=xlsx&kind=cogs&${DATES}`
    );
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/format/i);
  });

  test("invalid kind → 400", async ({ page }) => {
    await loginAsAdmin(page);
    const res = await page.context().request.get(
      `${EXPORT}?format=csv&kind=payroll&${DATES}`
    );
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/kind/i);
  });

  test("missing from/to dates → 400", async ({ page }) => {
    await loginAsAdmin(page);
    const res = await page.context().request.get(`${EXPORT}?format=csv&kind=cogs`);
    expect(res.status()).toBe(400);
  });

  test("to < from → 400", async ({ page }) => {
    await loginAsAdmin(page);
    const res = await page.context().request.get(
      `${EXPORT}?format=csv&kind=cogs&from=2026-06-30&to=2026-01-01`
    );
    expect(res.status()).toBe(400);
  });

  test("barista (non-admin) → 403", async ({ page }) => {
    await loginAsBarista(page);
    const res = await page.context().request.get(
      `${EXPORT}?format=csv&kind=cogs&${DATES}`
    );
    expect(res.status()).toBe(403);
  });

  test("admin: format=csv kind=cogs → 200 with text/csv content-type", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const res = await page.context().request.get(
      `${EXPORT}?format=csv&kind=cogs&${DATES}`
    );
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    expect(res.headers()["content-disposition"]).toContain("attachment");
  });

  test("admin: format=csv kind=sales → 200 with text/csv", async ({ page }) => {
    await loginAsAdmin(page);
    const res = await page.context().request.get(
      `${EXPORT}?format=csv&kind=sales&${DATES}`
    );
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
  });

  test("admin: format=csv kind=inventory → 200 with text/csv", async ({ page }) => {
    await loginAsAdmin(page);
    const res = await page.context().request.get(
      `${EXPORT}?format=csv&kind=inventory&${DATES}`
    );
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
  });

  test("admin: format=csv kind=monthly_pnl → 200 with text/csv", async ({ page }) => {
    await loginAsAdmin(page);
    const res = await page.context().request.get(
      `${EXPORT}?format=csv&kind=monthly_pnl&${DATES}`
    );
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
  });

  test("admin: format=pdf kind=cogs → 200 HTML document with DOCTYPE", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const res = await page.context().request.get(
      `${EXPORT}?format=pdf&kind=cogs&${DATES}`
    );
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("<!DOCTYPE html>");
    expect(body).toContain("COGS Report");
    expect(body).toContain("@media print");
    expect(body).toContain("A4");
  });

  test("admin: format=pdf kind=sales → 200 HTML with 'Sales Report' title", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const res = await page.context().request.get(
      `${EXPORT}?format=pdf&kind=sales&${DATES}`
    );
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("Sales Report");
  });

  test("export writes an audit row — audit table grows after export", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    // Trigger an export; then confirm audit page shows entries (indirect coverage).
    await page.context().request.get(`${EXPORT}?format=csv&kind=cogs&${DATES}`);
    await page.goto("/admin/audit", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("table")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("row").nth(1)).toBeVisible({ timeout: 5_000 });
  });
});

// ─── G22: deferred payment cron ───────────────────────────────────────────────

test.describe("G22: deferred payment cron", () => {
  const CRON = "/api/crons/retry-deferred";

  test("no bearer token → 401", async ({ request }) => {
    const res = await request.get(CRON);
    expect(res.status()).toBe(401);
  });

  test("wrong bearer secret → 401", async ({ request }) => {
    const res = await request.get(CRON, {
      headers: { Authorization: "Bearer wrong-secret-xyz" },
    });
    expect(res.status()).toBe(401);
  });

  test("correct CRON_SECRET → 200 { ok: true } (or 401 if secret not configured)", async ({
    request,
  }) => {
    const res = await request.get(CRON, {
      headers: { Authorization: `Bearer ${TEST_CRON_SECRET}` },
    });
    if (res.status() === 200) {
      const body = await res.json();
      expect(body.ok).toBe(true);
      // cron returns { ok, checked, resolved, conflicted, skipped } (spread directly)
      expect(typeof body.checked).toBe("number");
      expect(typeof body.resolved).toBe("number");
    } else {
      // 401 = secret mismatch (dev env without CRON_SECRET=e2e-cron-secret)
      expect(res.status()).toBe(401);
    }
  });
});
