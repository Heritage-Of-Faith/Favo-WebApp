import { test, expect, type Page } from "@playwright/test";
import { auditTouchTargets, formatViolations } from "./support/touch-target-audit";

// ─── Touch-target & interactivity audit — AT-138 ──────────────────────────────
// Every interactive POS control must be ≥44×44px with hit-area centers ≥48px
// apart (Apple HIG / WCAG 2.5.8 minimum + the 24px-radius non-intersecting
// circle heuristic). Read-only navigation only — no order is ever placed.
//
// Seed prerequisites: barista Sam (PIN 1234), menu item "Cappuccino".

async function loginAsBarista(page: Page) {
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

/**
 * Dismiss the AT-134 opening-time prompt (Remind me later) if it appears.
 * It mounts after an async `getTodaySessions()` fetch, so it can pop up a
 * couple of seconds after the workspace itself is already interactive —
 * poll for it rather than a single point-in-time check, or a later
 * appearance races with (and blocks) whatever the test clicks next.
 */
async function dismissOpeningPrompt(page: Page) {
  // The prompt mounts after its own getTodaySessions() fetch, so it can
  // appear a couple of seconds after the workspace is already interactive.
  // Don't wait for networkidle — the POS holds an open SSE connection
  // (/api/queue/stream) that never goes idle, which would hang forever.
  const remindLater = page.getByRole("button", { name: /remind me later/i });
  try {
    await remindLater.waitFor({ state: "visible", timeout: 10_000 });
    await remindLater.click();
  } catch {
    // Never appeared — proceeding without it.
  }
}

test.describe("AT-138 — touch-target & interactivity audit", () => {
  test("PIN login pad", async ({ page }) => {
    await page.goto("/pos", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /enter your pin/i })).toBeVisible();
    await expect(page.getByLabel("Digit 1")).toBeEnabled({ timeout: 15_000 });

    const violations = await auditTouchTargets(page);
    expect(violations, `PIN pad violations:\n${formatViolations(violations)}`).toEqual([]);
  });

  test("POS workspace — Zone A/B/C, empty cart", async ({ page }) => {
    await loginAsBarista(page);
    await dismissOpeningPrompt(page);
    await expect(page.getByText(/tap an item to customise/i)).toBeVisible({ timeout: 15_000 });

    const violations = await auditTouchTargets(page);
    expect(violations, `POS workspace violations:\n${formatViolations(violations)}`).toEqual([]);
  });

  test("POS workspace — customisation panel open", async ({ page }) => {
    await loginAsBarista(page);
    await dismissOpeningPrompt(page);
    await page.getByText("Cappuccino").first().click();
    await expect(page.getByRole("button", { name: /add to order/i })).toBeVisible({ timeout: 10_000 });

    const violations = await auditTouchTargets(page);
    expect(violations, `Customisation panel violations:\n${formatViolations(violations)}`).toEqual([]);
  });

  test("POS workspace — running order with an item added", async ({ page }) => {
    await loginAsBarista(page);
    await dismissOpeningPrompt(page);
    await page.getByText("Cappuccino").first().click();
    await page.getByRole("button", { name: /add to order/i }).click();
    await expect(page.getByText(/R\s*\d+[,.]\d{2}/).first()).toBeVisible();

    const violations = await auditTouchTargets(page);
    expect(violations, `Running order violations:\n${formatViolations(violations)}`).toEqual([]);
  });

  test("POS daily history", async ({ page }) => {
    await loginAsBarista(page);
    await dismissOpeningPrompt(page);
    await page.getByRole("link", { name: /order history/i }).click();
    await expect(page.getByRole("heading", { name: /order history/i })).toBeVisible({ timeout: 10_000 });

    const violations = await auditTouchTargets(page);
    expect(violations, `History page violations:\n${formatViolations(violations)}`).toEqual([]);
  });

  test("POS today summary", async ({ page }) => {
    await loginAsBarista(page);
    await dismissOpeningPrompt(page);
    await page.goto("/pos/today", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /^today$/i })).toBeVisible({ timeout: 10_000 });

    const violations = await auditTouchTargets(page);
    expect(violations, `Today page violations:\n${formatViolations(violations)}`).toEqual([]);
  });
});
