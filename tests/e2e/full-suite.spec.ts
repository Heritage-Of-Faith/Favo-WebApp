/**
 * Full Suite — AT-81 (G23)
 *
 * Runs critical Phase 1-3 user journeys in sequence against a single server
 * instance, then asserts audit coverage (no recent mutations without audit rows).
 *
 * Designed to be the only spec run by scripts/preflight.sh:
 *   bun test:e2e:ci tests/e2e/full-suite.spec.ts
 *
 * Prerequisites:
 *   - Seed applied (G3 + phase2 seed)
 *   - TEST_AUDIT_SECRET env var set (otherwise audit-coverage block skips)
 *   - CRON_SECRET=e2e-cron-secret for cron block to assert 200
 *
 * Seeded data:
 *   Barista: Sam Barista  PIN 1234  id: staff_barista_sam
 *   Admin:   Mia Manager  PIN 4321  id: staff_manager_mia
 *   Menu:    Cappuccino   id: menu_cappuccino
 */

import { test, expect, type Page } from "@playwright/test";

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

// ─── Phase 1 — Core POS ───────────────────────────────────────────────────────

test.describe("Phase 1 — Core POS", () => {
  test("GET /api/healthz → 200 { ok: true, service: 'favo-webapp' }", async ({
    request,
  }) => {
    const res = await request.get("/api/healthz");
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "favo-webapp" });
  });

  test("barista PIN login succeeds with PIN 1234", async ({ page }) => {
    await loginAsBarista(page);
    await expect(page.getByRole("heading", { name: /enter your pin/i })).not.toBeVisible();
  });

  test("wrong PIN shows error and stays on login screen", async ({ page }) => {
    await page.goto("/pos", { waitUntil: "domcontentloaded" });
    await expect(page.getByLabel("Digit 0")).toBeEnabled({ timeout: 15_000 });
    for (const digit of "0000") {
      await page.getByLabel(`Digit ${digit}`).click();
    }
    await page.getByLabel("Confirm PIN").click();
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("heading", { name: /enter your pin/i })).toBeVisible();
  });

  test("unauthenticated GET /api/queue/stream → 401", async ({ request }) => {
    const res = await request.get("/api/queue/stream");
    expect(res.status()).toBe(401);
  });

  test("admin PIN login succeeds with PIN 4321", async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.getByRole("heading", { name: /enter your pin/i })).not.toBeVisible();
  });

  test("POS menu is loaded after barista login (Cappuccino visible)", async ({ page }) => {
    await loginAsBarista(page);
    await expect(page.getByText("Cappuccino").first()).toBeVisible({ timeout: 10_000 });
  });

  test("authenticated SSE stream → 200 text/event-stream", async ({ page }) => {
    await loginAsBarista(page);
    const { status, contentType } = await page.evaluate(async () => {
      const ctrl = new AbortController();
      const res = await fetch("/api/queue/stream", { signal: ctrl.signal }).catch((e) => {
        throw e;
      });
      const status = res.status;
      const contentType = res.headers.get("content-type") ?? "";
      ctrl.abort();
      return { status, contentType };
    });
    expect(status).toBe(200);
    expect(contentType).toContain("text/event-stream");
  });
});

// ─── Phase 2 — COGS + Inventory (admin reports) ───────────────────────────────

test.describe("Phase 2 — Reports (admin gate)", () => {
  const DATES = "from=2026-01-01&to=2026-12-31";

  test("admin: COGS export CSV → 200 with CSV content-type", async ({ page }) => {
    await loginAsAdmin(page);
    const res = await page.context().request.get(
      `/api/reports/export?format=csv&kind=cogs&${DATES}`
    );
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
  });

  test("admin: inventory export CSV → 200", async ({ page }) => {
    await loginAsAdmin(page);
    const res = await page.context().request.get(
      `/api/reports/export?format=csv&kind=inventory&${DATES}`
    );
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
  });

  test("admin audit log page is accessible and shows rows", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/audit", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("table")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("row").nth(1)).toBeVisible({ timeout: 5_000 });
  });
});

// ─── Phase 3 — Sync + Reports + Cron ─────────────────────────────────────────

test.describe("Phase 3 — Offline Sync + Reports + Cron", () => {
  test("unauthenticated POST /api/sync/orders → 401", async ({ request }) => {
    const res = await request.post("/api/sync/orders", {
      data: { clientUuid: "00000000-0000-4000-8000-000000000099" },
    });
    expect(res.status()).toBe(401);
  });

  test("barista: malformed sync payload → 400 or 422 (schema validation)", async ({
    page,
  }) => {
    await loginAsBarista(page);
    const res = await page.context().request.post("/api/sync/orders", {
      data: { clientUuid: "bad-uuid" },
    });
    expect([400, 422]).toContain(res.status());
  });

  test("barista: well-formed sync payload → 200 or 409 (applied or conflict)", async ({
    page,
  }) => {
    await loginAsBarista(page);
    const clientUuid = `00000000-0000-4000-8000-${Date.now().toString().padStart(12, "0")}`;
    const res = await page.context().request.post("/api/sync/orders", {
      data: {
        clientUuid,
        staffId: "staff_barista_sam",
        items: [{ menuItemId: "menu_cappuccino", quantity: 1, modifications: [] }],
        paymentMode: "free",
        clientTotalZar: 0,
        clientTimestamp: new Date().toISOString(),
      },
    });
    expect([200, 409]).toContain(res.status());
  });

  test("admin: format=csv kind=sales → 200 CSV", async ({ page }) => {
    await loginAsAdmin(page);
    const res = await page.context().request.get(
      "/api/reports/export?format=csv&kind=sales&from=2026-01-01&to=2026-12-31"
    );
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
  });

  test("admin: format=pdf kind=cogs → 200 A4 HTML document", async ({ page }) => {
    await loginAsAdmin(page);
    const res = await page.context().request.get(
      "/api/reports/export?format=pdf&kind=cogs&from=2026-01-01&to=2026-12-31"
    );
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("<!DOCTYPE html>");
    expect(body).toContain("@media print");
    expect(body).toContain("A4");
  });

  test("admin: format=pdf kind=monthly_pnl → 200 HTML with P&amp;L title", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const res = await page.context().request.get(
      "/api/reports/export?format=pdf&kind=monthly_pnl&from=2026-01-01&to=2026-12-31"
    );
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("Monthly P&amp;L Report");
  });

  test("GET /api/crons/retry-deferred without bearer → 401", async ({ request }) => {
    const res = await request.get("/api/crons/retry-deferred");
    expect(res.status()).toBe(401);
  });

  test("GET /api/crons/retry-deferred with wrong secret → 401", async ({ request }) => {
    const res = await request.get("/api/crons/retry-deferred", {
      headers: { Authorization: "Bearer wrong-secret" },
    });
    expect(res.status()).toBe(401);
  });

  test("GET /api/reports/export with invalid format → 400", async ({ page }) => {
    await loginAsAdmin(page);
    const res = await page.context().request.get(
      "/api/reports/export?format=docx&kind=cogs&from=2026-01-01&to=2026-12-31"
    );
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/format/i);
  });

  test("GET /api/reports/export with invalid kind → 400", async ({ page }) => {
    await loginAsAdmin(page);
    const res = await page.context().request.get(
      "/api/reports/export?format=csv&kind=ledger&from=2026-01-01&to=2026-12-31"
    );
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/kind/i);
  });
});

// ─── Audit Coverage ───────────────────────────────────────────────────────────
// Asserts that no mutations executed during this test run lack an audit row.
// Requires TEST_AUDIT_SECRET env var — skipped silently in envs without it.

test.describe("Audit coverage", () => {
  test("no recent orders lack a corresponding audit row", async ({ request }) => {
    const secret = process.env.TEST_AUDIT_SECRET ?? "";
    if (!secret) {
      test.skip();
      return;
    }
    const res = await request.get(
      `/api/admin/audit-coverage?secret=${encodeURIComponent(secret)}`
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.gapCount, `${body.gapCount} order(s) created without an audit row`).toBe(0);
  });
});
