import { test, expect, type Page } from "@playwright/test";

// ─── Order Lifecycle — full happy-path E2E ────────────────────────────────────
// The core revenue flow, end to end through the real UI:
//   login → build order → place → appears in queue → Start Making → Mark Ready
//   → Collected.
//
// This is the flow that matters on launch day. Unit tests cover the server
// actions (transitionOrder state machine); this proves the UI wiring works.
//
// Seed prerequisites: barista Sam (PIN 1234), menu item "Cappuccino".
// ─────────────────────────────────────────────────────────────────────────────

/** Log in as the seed barista, waiting for hydration before interacting. */
async function loginAsBarista(page: Page) {
  await page.goto("/pos", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /enter your pin/i })).toBeVisible();
  await expect(page.getByLabel("Digit 1")).toBeEnabled({ timeout: 15_000 });
  for (const digit of "1234") {
    await page.getByLabel(`Digit ${digit}`).click();
  }
  await expect(page.getByLabel("Confirm PIN")).toBeEnabled({ timeout: 5_000 });
  await page.getByLabel("Confirm PIN").click();
  // Lands on the workspace — the PIN heading is gone.
  await expect(page.getByRole("heading", { name: /enter your pin/i })).not.toBeVisible({
    timeout: 30_000,
  });
}

test("barista can take an order and drive it through the full queue lifecycle", async ({
  page,
}) => {
  await loginAsBarista(page);

  // ── 1. Build the order ──────────────────────────────────────────────────────
  // Clicking a menu item opens the modification sheet; "Add to order" commits it.
  await page.getByText("Cappuccino").first().click();
  await page.getByRole("button", { name: /add to order/i }).click();

  // The order summary now shows the item and a running total in ZAR.
  await expect(page.getByText(/R\s*\d+[,.]\d{2}/).first()).toBeVisible();

  // ── 2. Place the order ───────────────────────────────────────────────────────
  await page.getByRole("button", { name: /^charge r/i }).click();

  // ── 3. The order appears in the live queue as "Waiting" ─────────────────────
  // createOrder auto-expands the new order, so its card body is open.
  await expect(page.getByText("Waiting").first()).toBeVisible({ timeout: 15_000 });

  // ── 4. Start Making → order moves to "Making" ───────────────────────────────
  // Button is disabled until the full order detail loads, so wait for enabled.
  const startBtn = page.getByRole("button", { name: /start making/i });
  await expect(startBtn).toBeEnabled({ timeout: 15_000 });
  await startBtn.click();
  await expect(page.getByText("Making").first()).toBeVisible({ timeout: 15_000 });

  // ── 5. Mark Ready → order moves to "Ready" ──────────────────────────────────
  const readyBtn = page.getByRole("button", { name: /mark ready/i });
  await expect(readyBtn).toBeEnabled({ timeout: 15_000 });
  await readyBtn.click();
  await expect(page.getByText(/ready/i).first()).toBeVisible({ timeout: 15_000 });

  // ── 6. DONE — Collected → order leaves the active queue ─────────────────────
  // A collected order is removed from the active board (the card collapses and
  // drops out), so the surest proof of completion is the Collect button vanishing.
  const collectBtn = page.getByRole("button", { name: /done.*collected/i });
  await expect(collectBtn).toBeEnabled({ timeout: 15_000 });
  await collectBtn.click();
  await expect(collectBtn).toBeHidden({ timeout: 15_000 });
});
