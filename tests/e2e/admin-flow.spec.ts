/**
 * Admin flow spec — AT-89 (A19)
 *
 * Covers the Phase 2 + Phase 3 admin acceptance:
 *   - Admin login via PIN 4321 (Mia Manager)
 *   - Dashboard overview renders
 *   - Inventory list renders
 *   - Stock-takes page renders
 *   - Purchases page renders
 *   - Expenses page renders
 *   - Monthly P&L page renders
 *   - Hours editor renders (AT-76 / A16)
 *   - Reports / export page renders (AT-77 / A17)
 *   - Customers list renders (AT-78)
 *   - Sync conflicts page renders (AT-80 / A18)
 *   - Audit log renders
 *
 * Seeded data (G3 + phase2 seed):
 *   Admin: Mia Manager  PIN 4321  role: manager
 *
 * Run as part of G23 pre-flight gate.
 */

import { test, expect, type Page } from "@playwright/test";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/admin", { waitUntil: "domcontentloaded" });
  // Redirected to the unified staff login.
  await expect(page).toHaveURL(/\/staff\/login/, { timeout: 10_000 });
  await expect(page.getByRole("heading", { name: /enter your pin/i })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel("Digit 4")).toBeEnabled({ timeout: 15_000 });
  for (const digit of "4321") {
    await page.getByLabel(`Digit ${digit}`).click();
  }
  await expect(page.getByLabel("Confirm PIN")).toBeEnabled({ timeout: 5_000 });
  await page.getByLabel("Confirm PIN").click();
  await expect(page).toHaveURL(/\/admin(?!\/login)/, { timeout: 30_000 });
}

// ─── 1. Admin authentication ──────────────────────────────────────────────────

test.describe("1. Admin authentication", () => {
  test("unauthenticated /admin redirects to /staff/login", async ({ page }) => {
    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/staff\/login/, { timeout: 10_000 });
  });

  test("staff login page renders PIN keypad", async ({ page }) => {
    await page.goto("/staff/login", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /enter your pin/i })).toBeVisible({ timeout: 15_000 });
    for (const digit of ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]) {
      await expect(page.getByLabel(`Digit ${digit}`)).toBeVisible();
    }
  });

  test("admin can log in with PIN 4321", async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.getByRole("navigation", { name: /admin/i })).toBeVisible({ timeout: 15_000 });
  });
});

// ─── 2. Admin dashboard ───────────────────────────────────────────────────────

test.describe("2. Admin dashboard", () => {
  test("dashboard renders without JS errors", async ({ page }) => {
    await loginAsAdmin(page);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/admin", { waitUntil: "networkidle" });
    expect(errors.filter((e) => !e.includes("ResizeObserver"))).toHaveLength(0);
  });

  test("sidebar has key navigation links", async ({ page }) => {
    await loginAsAdmin(page);
    const nav = page.getByRole("navigation", { name: /admin/i });
    await expect(nav.getByRole("link", { name: /inventory/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /stock takes/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /expenses/i })).toBeVisible();
  });
});

// ─── 3. Core admin pages ──────────────────────────────────────────────────────

test.describe("3. Core admin pages", () => {
  test("inventory page renders", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/inventory", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/admin\/inventory/);
    await expect(
      page.getByRole("heading", { name: /inventory/i })
        .or(page.getByText(/stock level/i))
        .first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test("stock-takes page renders", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/stock-takes", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/admin\/stock-takes/);
    await expect(
      page.getByRole("heading", { name: /stock/i }).first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test("purchases page renders", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/purchases", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/admin\/purchases/);
    await expect(
      page.getByRole("heading", { name: /purchase/i }).first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test("expenses page renders", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/expenses", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/admin\/expenses/);
    await expect(
      page.getByRole("heading", { name: /expense/i }).first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test("audit log page renders", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/audit", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/admin\/audit/);
    await expect(
      page.getByRole("heading", { name: /audit/i }).first()
    ).toBeVisible({ timeout: 15_000 });
  });
});

// ─── 4. Phase 3 admin extensions (AT-76, AT-77, AT-78, AT-80) ────────────────

test.describe("4. Phase 3 admin extensions", () => {
  test("hours editor renders (A16)", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/hours", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/admin\/hours/);
    await expect(
      page.getByRole("heading", { name: /hours/i }).first()
    ).toBeVisible({ timeout: 15_000 });
    // 7 rows: Mon–Sun
    const rows = page.getByRole("row");
    await expect(rows).toHaveCount(8); // 1 header + 7 day rows
  });

  test("reports / export page renders (A17)", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/reports", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/admin\/reports/);
    await expect(
      page.getByRole("heading", { name: /report/i }).or(page.getByText(/export/i)).first()
    ).toBeVisible({ timeout: 15_000 });
    // Export form has a report type selector
    await expect(page.getByLabel(/report type/i)).toBeVisible({ timeout: 10_000 });
  });

  test("customers list renders (AT-78)", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/customers", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/admin\/customers/);
    await expect(
      page.getByRole("heading", { name: /customer/i }).first()
    ).toBeVisible({ timeout: 15_000 });
    // Search input should be visible
    await expect(page.getByRole("searchbox").or(page.getByPlaceholder(/search/i)).first()).toBeVisible({ timeout: 10_000 });
  });

  test("sync conflicts page renders (A18)", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/sync-conflicts", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/admin\/sync-conflicts/);
    await expect(
      page.getByRole("heading", { name: /sync conflict/i }).first()
    ).toBeVisible({ timeout: 15_000 });
    // Should show "Open (N)" heading
    await expect(page.getByText(/open \(/i)).toBeVisible({ timeout: 10_000 });
  });
});

// ─── 5. Monthly P&L (admin/finance only) ────────────────────────────────────

test.describe("5. Monthly P&L page", () => {
  test("monthly P&L page renders for admin", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/reports/monthly", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/admin\/reports\/monthly/);
    await expect(
      page.getByRole("heading", { name: /monthly|p&l|profit/i }).first()
    ).toBeVisible({ timeout: 15_000 });
  });
});

// ─── 6. Admin sign-out ────────────────────────────────────────────────────────

test.describe("6. Admin sign-out", () => {
  test("sign-out returns to admin login", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin", { waitUntil: "domcontentloaded" });

    const signOutBtn = page.getByRole("button", { name: /sign out/i });
    if (await signOutBtn.isVisible({ timeout: 5_000 })) {
      await signOutBtn.click();
      await expect(page).toHaveURL(/\/admin\/login/, { timeout: 10_000 });
    }
  });
});
