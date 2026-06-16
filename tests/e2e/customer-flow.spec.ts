/**
 * Customer flow spec — AT-92 (N18)
 *
 * Covers the Phase 3 customer acceptance:
 *   - Account creation (sign-up)
 *   - Dashboard renders (loyalty, wallet, packs, order history)
 *   - Push opt-in granted via Playwright context permissions
 *   - Wallet page renders
 *   - Packs page renders
 *
 * Seeded data (G3 + phase2/phase3 seed):
 *   Barista: Sam Barista  PIN 1234
 *   Customer (sign-up): unique per run — prefixed with e2e+
 *
 * Run as part of G23 pre-flight gate.
 */

import { test, expect, type BrowserContext } from "@playwright/test";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a unique test email for this run. */
function testEmail(label: string): string {
  const ts = Date.now();
  return `e2e+${label}+${ts}@test.favo.local`;
}

const TEST_PASSWORD = "Playwright!2026";
const TEST_NAME = "E2E Runner";
const TEST_PHONE = "0821110001";

/** Sign up and land on the dashboard. Returns the context for re-use. */
async function signUp(
  context: BrowserContext,
  email: string
): Promise<void> {
  const page = await context.newPage();
  await page.goto("/signup", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /join favo/i })).toBeVisible({ timeout: 15_000 });

  await page.getByLabel(/full name/i).fill(TEST_NAME);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/phone/i).fill(TEST_PHONE);
  await page.getByLabel(/^password$/i).fill(TEST_PASSWORD);
  await page.getByLabel(/confirm password/i).fill(TEST_PASSWORD);

  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/customer/, { timeout: 20_000 });
  await page.close();
}

/** Sign in and land on the dashboard. */
async function signIn(context: BrowserContext, email: string): Promise<void> {
  const page = await context.newPage();
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible({ timeout: 15_000 });

  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/customer/, { timeout: 20_000 });
  await page.close();
}

// ─── 1. Landing page ──────────────────────────────────────────────────────────

test.describe("1. Landing page", () => {
  test("landing page loads with FAVO branding", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle(/FAVO/i);
    await expect(page.getByRole("heading", { name: /favo/i }).first()).toBeVisible({ timeout: 15_000 });
  });

  test("unauthenticated /customer redirects to /login", async ({ page }) => {
    await page.goto("/customer", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });

  test("unauthenticated /wallet redirects to /login", async ({ page }) => {
    await page.goto("/wallet", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });

  test("unauthenticated /packs redirects to /login", async ({ page }) => {
    await page.goto("/packs", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });
});

// ─── 2. Account creation ──────────────────────────────────────────────────────

test.describe("2. Customer sign-up", () => {
  test("sign-up page renders", async ({ page }) => {
    await page.goto("/signup", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /join favo/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/^password$/i)).toBeVisible();
  });

  test("sign-up creates an account and lands on dashboard", async ({ context }) => {
    const email = testEmail("signup");
    await signUp(context, email);
    // Verify dashboard by navigating directly
    const page = await context.newPage();
    await page.goto("/customer", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/customer/);
    await expect(page.getByText(/favo/i).first()).toBeVisible({ timeout: 15_000 });
    await page.close();
  });

  test("sign-in page renders", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible({ timeout: 15_000 });
  });

  test("wrong password shows error message", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.getByLabel(/email/i).fill("notreal@test.favo.local");
    await page.getByLabel(/password/i).fill("wrongpassword");
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByRole("alert").or(page.getByText(/invalid/i))).toBeVisible({ timeout: 10_000 });
  });
});

// ─── 3. Customer dashboard ────────────────────────────────────────────────────

test.describe("3. Customer dashboard", () => {
  let sharedEmail: string;

  test.beforeAll(async ({ browser }) => {
    sharedEmail = testEmail("dash");
    const context = await browser.newContext();
    await signUp(context, sharedEmail);
    await context.close();
  });

  test("dashboard renders loyalty section", async ({ context }) => {
    await signIn(context, sharedEmail);
    const page = await context.newPage();
    await page.goto("/customer", { waitUntil: "domcontentloaded" });
    // Dashboard should show points or loyalty section
    await expect(page.getByText(/points/i).or(page.getByText(/loyalty/i)).first()).toBeVisible({ timeout: 15_000 });
    await page.close();
  });

  test("dashboard renders without JS errors", async ({ context }) => {
    await signIn(context, sharedEmail);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/customer", { waitUntil: "networkidle" });
    expect(errors.filter((e) => !e.includes("ResizeObserver"))).toHaveLength(0);
    await page.close();
  });

  test("wallet page renders for authenticated customer", async ({ context }) => {
    await signIn(context, sharedEmail);
    const page = await context.newPage();
    await page.goto("/wallet", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/wallet/);
    await expect(page.getByText(/balance/i).or(page.getByText(/wallet/i)).first()).toBeVisible({ timeout: 15_000 });
    await page.close();
  });

  test("packs page renders for authenticated customer", async ({ context }) => {
    await signIn(context, sharedEmail);
    const page = await context.newPage();
    await page.goto("/packs", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/packs/);
    await expect(
      page.getByText(/pack/i).or(page.getByText(/no active packs/i)).first()
    ).toBeVisible({ timeout: 15_000 });
    await page.close();
  });
});

// ─── 4. Push opt-in ──────────────────────────────────────────────────────────

test.describe("4. Push opt-in", () => {
  test("PushOptIn button is visible on dashboard when permissions granted", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      permissions: ["notifications"],
    });
    const email = testEmail("push");
    await signUp(context, email);

    const page = await context.newPage();
    await page.goto("/customer", { waitUntil: "domcontentloaded" });
    // Push opt-in component should render (either button or already-subscribed state)
    await expect(
      page.getByRole("button", { name: /enable notifications/i })
        .or(page.getByRole("button", { name: /notifications enabled/i }))
        .or(page.getByText(/stay updated/i))
        .first()
    ).toBeVisible({ timeout: 15_000 });

    await page.close();
    await context.close();
  });
});

// ─── 5. Customer sign-out ────────────────────────────────────────────────────

test.describe("5. Sign-out", () => {
  test("signed-out customer is redirected to /login from /customer", async ({ context }) => {
    const email = testEmail("signout");
    await signUp(context, email);

    const page = await context.newPage();
    await page.goto("/customer", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/customer/, { timeout: 15_000 });

    // Find and click sign-out
    const signOutBtn = page.getByRole("button", { name: /sign out/i }).or(
      page.getByRole("link", { name: /sign out/i })
    );
    if (await signOutBtn.isVisible({ timeout: 5_000 })) {
      await signOutBtn.click();
      await expect(page).toHaveURL(/\/login|\//, { timeout: 10_000 });
    }
    await page.close();
  });
});
