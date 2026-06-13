/**
 * Production smoke spec — AT-85 (G27)
 *
 * READ-ONLY paths only. PRD §11 forbids any mutations against the production
 * database. No login actions (PIN submission creates audit rows). No order
 * creation. No form submissions.
 *
 * Run against production:
 *   PUBLIC_BASE_URL=https://favo.hofmi.org bun test:e2e:ci tests/e2e/prod-smoke.spec.ts
 *
 * Run against staging:
 *   PUBLIC_BASE_URL=https://staging.favo.hofmi.org bun test:e2e:ci tests/e2e/prod-smoke.spec.ts
 */

import { test, expect } from "@playwright/test";

// ─── Smoke: infrastructure ────────────────────────────────────────────────────

test.describe("infrastructure", () => {
  test("GET /api/healthz → 200 with all checks", async ({ request }) => {
    const res = await request.get("/api/healthz");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.service).toBe("favo-webapp");
    expect(body.checks).toBeDefined();
    expect(body.checks.postgres.ok).toBe(true);
    // Yoco and Loki may be degraded in staging — check they are present
    expect(typeof body.checks.yoco.ok).toBe("boolean");
    expect(typeof body.checks.loki.ok).toBe("boolean");
  });

  test("HTTPS certificate is valid (no insecure redirect)", async ({ request }) => {
    const res = await request.get("/api/healthz");
    // If this request succeeds, TLS is valid. A cert error would throw.
    expect(res.status()).toBeLessThan(500);
  });

  test("response includes Cache-Control header on healthz", async ({ request }) => {
    const res = await request.get("/api/healthz");
    const cc = res.headers()["cache-control"] ?? "";
    expect(cc).toContain("max-age=5");
  });
});

// ─── Smoke: public pages (no auth required) ──────────────────────────────────

test.describe("public pages", () => {
  test("landing page (/) renders with 200", async ({ request }) => {
    const res = await request.get("/");
    expect(res.status()).toBe(200);
  });

  test("landing page has FAVO in the title", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle(/FAVO/i);
  });

  test("customer page (/customer) renders without 500", async ({ request }) => {
    const res = await request.get("/customer");
    expect(res.status()).not.toBe(500);
  });
});

// ─── Smoke: POS shell (auth gate renders — no login) ─────────────────────────

test.describe("POS shell", () => {
  test("/pos loads and shows PIN login screen (not blank, not 500)", async ({ page }) => {
    await page.goto("/pos", { waitUntil: "domcontentloaded" });
    // Page must render — either the PIN gate or the POS itself
    await expect(page.locator("body")).not.toBeEmpty();
    // Title must be FAVO
    await expect(page).toHaveTitle(/FAVO/i);
  });

  test("/pos PIN keypad or main interface is visible", async ({ page }) => {
    await page.goto("/pos", { waitUntil: "domcontentloaded" });
    // Either the PIN heading or the main POS content is visible
    const pinHeading = page.getByRole("heading", { name: /enter your pin/i });
    const main = page.locator("main");
    await expect(pinHeading.or(main)).toBeVisible({ timeout: 15_000 });
  });

  test("/pos does not return 500", async ({ request }) => {
    const res = await request.get("/pos");
    expect(res.status()).not.toBe(500);
  });
});

// ─── Smoke: admin auth gate ───────────────────────────────────────────────────

test.describe("admin auth gate", () => {
  test("/admin redirects to SSO (302 to Cloudflare Access or login page)", async ({
    request,
  }) => {
    // In production, Cloudflare Access intercepts unauthenticated /admin requests
    // and returns a 302 redirect to the Cloudflare Access login URL.
    // In staging (no Access policy), the app's own auth middleware redirects to /admin/login.
    const res = await request.get("/admin", { maxRedirects: 0 });
    // Accept any 3xx redirect — the important thing is we're not served the admin UI
    // directly (which would be a security failure).
    expect([301, 302, 303, 307, 308]).toContain(res.status());
  });

  test("/admin/login renders a login form or SSO redirect", async ({ page }) => {
    await page.goto("/admin/login", { waitUntil: "domcontentloaded" });
    // Either a login form or an SSO redirect — both are acceptable
    const body = await page.locator("body").textContent();
    // Page must not be blank or error
    expect(body?.length).toBeGreaterThan(50);
  });
});

// ─── Smoke: auth-protected API routes return 401/403 (not 500) ───────────────

test.describe("unauthenticated API guards", () => {
  test("GET /api/queue/stream without auth → 401", async ({ request }) => {
    const res = await request.get("/api/queue/stream");
    expect(res.status()).toBe(401);
  });

  test("GET /api/reports/export without auth → 403", async ({ request }) => {
    const res = await request.get(
      "/api/reports/export?format=csv&kind=cogs&from=2026-01-01&to=2026-12-31"
    );
    expect(res.status()).toBe(403);
  });

  test("GET /api/crons/retry-deferred without bearer → 401", async ({ request }) => {
    const res = await request.get("/api/crons/retry-deferred");
    expect(res.status()).toBe(401);
  });

  test("GET /api/admin/audit-coverage without secret → 403", async ({ request }) => {
    const res = await request.get("/api/admin/audit-coverage");
    expect(res.status()).toBe(403);
  });
});

// ─── Smoke: static assets load ───────────────────────────────────────────────

test.describe("static assets", () => {
  test("favicon.ico loads (or 404 — not 500)", async ({ request }) => {
    const res = await request.get("/favicon.ico");
    expect([200, 404]).toContain(res.status());
  });

  test("Next.js _next/static chunk loads", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto("/", { waitUntil: "networkidle" });
    // No unhandled JS errors on the landing page
    const criticalErrors = errors.filter((e) => !e.includes("ResizeObserver"));
    expect(criticalErrors).toHaveLength(0);
  });
});
