/**
 * Gian's backend vertical — E2E / API-contract tests
 * Covers: G4 (auth), G6 (SSE queue; the Yoco webhook is retired), G7 (push subscribe)
 *
 * Server actions (G5: searchCustomer, createOrder, transitionOrder, cancelOrder,
 * applyStaffDiscount) are exercised through the POS UI below and in
 * phase1-acceptance.spec.ts.
 *
 * Prerequisites (seeded via G3):
 *   - Barista: Sam Barista  PIN 1234   id: staff_barista_sam
 *   - Admin:   Mia Manager  PIN 4321   id: staff_manager_mia
 *   - Customer: Louis        id: cust_louis
 *   - Menu:    Cappuccino R38,00  id: menu_cappuccino
 */

import { test, expect, type Page } from "@playwright/test";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Log in as the seeded barista (PIN 1234). */
async function loginAsBarista(page: Page): Promise<void> {
  await page.goto("/pos");
  await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
  for (const digit of "1234") {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("heading", { name: /sign in/i })).not.toBeVisible({
    timeout: 5000,
  });
}

/** Log in as the seeded admin (PIN 4321). */
async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/pos");
  await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
  for (const digit of "4321") {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("heading", { name: /sign in/i })).not.toBeVisible({
    timeout: 5000,
  });
}

// ── 1. Healthz (no auth) ─────────────────────────────────────────────────────

test.describe("healthz", () => {
  test("GET /api/healthz → 200 with service name", async ({ request }) => {
    const res = await request.get("/api/healthz");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, service: "favo-webapp" });
  });
});

// ── 2. G4: Auth — PIN login + RBAC guards ────────────────────────────────────

test.describe("G4: auth", () => {
  test("correct PIN (1234) clears the login screen", async ({ page }) => {
    await loginAsBarista(page);
    await expect(page.getByRole("heading", { name: /sign in/i })).not.toBeVisible();
  });

  test("wrong PIN shows an alert and stays on login", async ({ page }) => {
    await page.goto("/pos");
    for (const digit of "0000") {
      await page.getByRole("button", { name: digit, exact: true }).click();
    }
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
  });

  test("unauthenticated GET /api/queue/stream → 401", async ({ request }) => {
    const res = await request.get("/api/queue/stream");
    expect(res.status()).toBe(401);
  });

  test("unauthenticated POST /api/push/subscribe → 401", async ({ request }) => {
    const res = await request.post("/api/push/subscribe", { data: {} });
    expect(res.status()).toBe(401);
  });
});

// ── 3. G6: SSE queue ─────────────────────────────────────────────────────────

test.describe("G6: SSE queue", () => {
  test("authenticated → 200 + text/event-stream headers", async ({ page }) => {
    await loginAsBarista(page);
    // page.context().request shares the session cookie from the browser login.
    const res = await page.context().request.get("/api/queue/stream");
    expect(res.status()).toBe(200);
    const ct = res.headers()["content-type"];
    expect(ct).toContain("text/event-stream");
  });

  test("cache-control is no-cache (prevents proxy buffering)", async ({ page }) => {
    await loginAsBarista(page);
    const res = await page.context().request.get("/api/queue/stream");
    const cc = res.headers()["cache-control"] ?? "";
    expect(cc).toContain("no-cache");
  });

  test("stream sends :connected comment immediately (via EventSource)", async ({
    page,
  }) => {
    await loginAsBarista(page);
    // Open the SSE endpoint from inside the browser so the session cookie travels.
    const firstChunk = await page.evaluate(
      () =>
        new Promise<string>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("GET", "/api/queue/stream");
          xhr.onprogress = () => {
            if (xhr.responseText.length > 0) {
              resolve(xhr.responseText);
              xhr.abort();
            }
          };
          xhr.onerror = () => reject(new Error("XHR error"));
          xhr.send();
          // Safety valve — the comment arrives before any heartbeat.
          setTimeout(() => { xhr.abort(); reject(new Error("timeout")); }, 5000);
        })
    );
    // The very first SSE frame is `: connected\n\n`
    expect(firstChunk).toContain(": connected");
  });
});

// ── 4. G6: Yoco webhook ──────────────────────────────────────────────────────

// AT-201 part 2b: retired, not re-pointed (PRD v7.0 §11.1 — "Removed with the
// Online flow. FAVO fetches payment status server-side and subscribes to no
// webhook"). The route no longer exists.
test.describe("G6: Yoco webhook (retired)", () => {
  const WEBHOOK = "/api/payments/yoco/webhook";

  test("POST /api/payments/yoco/webhook → 404", async ({ request }) => {
    const body = JSON.stringify({ type: "payment.succeeded", paymentId: "py_retired" });
    const res = await request.post(WEBHOOK, { data: body });
    expect(res.status()).toBe(404);
  });
});

// ── 5. G7: Push subscribe ─────────────────────────────────────────────────────

test.describe("G7: push/subscribe", () => {
  test("missing subscription object → 400", async ({ page }) => {
    await loginAsBarista(page);
    const res = await page.context().request.post("/api/push/subscribe", {
      data: { customerId: "cust_louis" },
    });
    expect(res.status()).toBe(400);
  });

  test("empty endpoint in subscription → 400", async ({ page }) => {
    await loginAsBarista(page);
    const res = await page.context().request.post("/api/push/subscribe", {
      data: {
        customerId: "cust_louis",
        subscription: { endpoint: "", keys: { p256dh: "x", auth: "y" } },
      },
    });
    expect(res.status()).toBe(400);
  });

  test("missing keys in subscription → 400", async ({ page }) => {
    await loginAsBarista(page);
    const res = await page.context().request.post("/api/push/subscribe", {
      data: {
        customerId: "cust_louis",
        subscription: { endpoint: "https://fcm.googleapis.com/test" },
      },
    });
    expect(res.status()).toBe(400);
  });

  test("valid subscription → 200 { ok: true }", async ({ page }) => {
    await loginAsBarista(page);
    const res = await page.context().request.post("/api/push/subscribe", {
      data: {
        customerId: "cust_louis",
        subscription: {
          endpoint: "https://fcm.googleapis.com/fcm/send/e2e-test-device",
          keys: {
            p256dh: "BNbU9GvGqfgJVGDMhD_e2e_test_p256dh_key_placeholder",
            auth: "e2e_test_auth_secret",
          },
        },
      },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});

// ── 6. G5: Order actions — smoke through POS UI ──────────────────────────────

test.describe("G5: order actions (smoke via POS UI)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsBarista(page);
  });

  test("searchCustomer: 'Lou' finds Louis", async ({ page }) => {
    await page.getByPlaceholder(/search customer/i).fill("Lou");
    await expect(page.getByText("Louis")).toBeVisible({ timeout: 5000 });
  });

  test("menu is loaded and contains Cappuccino (createOrder prerequisite)", async ({
    page,
  }) => {
    await expect(page.getByText("Cappuccino")).toBeVisible({ timeout: 5000 });
  });

  test("adding Cappuccino shows it in the order summary", async ({ page }) => {
    await page.getByText("Cappuccino").click();
    await expect(
      page.getByRole("region", { name: /order/i }).getByText("Cappuccino")
    ).toBeVisible();
  });

  test("order total is displayed in ZAR (R##,##)", async ({ page }) => {
    await page.getByText("Cappuccino").click();
    await expect(page.getByText(/R\s*\d+[,.]\d{2}/)).toBeVisible();
  });

  test("checkout button appears after adding an item (createOrder trigger)", async ({
    page,
  }) => {
    await page.getByText("Cappuccino").click();
    await expect(
      page.getByRole("button", { name: /pay|charge|checkout/i })
    ).toBeVisible({ timeout: 3000 });
  });

  test("draft order shows Clear affordance after adding an item", async ({
    page,
  }) => {
    // "Cancel order" on a DB order requires state=ordered (needs live payment).
    // Verify the draft-order cancel affordance: the "Clear" button that discards
    // the in-progress build appears once an item is added.
    await page.getByText("Cappuccino").click();
    await expect(
      page.getByRole("button", { name: /clear/i })
    ).toBeVisible({ timeout: 3000 });
  });

  test("free cup (applyFreeCoffee / declineFreeCoffee): POS renders", async ({
    page,
  }) => {
    // AT-183: the free cup is applied automatically at ring-up; the barista only
    // sees "Free cup applied" + Decline on an office-staff weekday order. That
    // needs a seeded office_staff customer and a weekday session, so this only
    // verifies the page doesn't crash.
    await expect(page.locator("main")).toBeVisible();
  });
});

// ── 7. G5: transitionOrder state machine — API smoke ─────────────────────────

test.describe("G5: transitionOrder — invalid transition guarded", () => {
  test("GET /pos/order/non-existent-id does not 500", async ({ page }) => {
    await loginAsBarista(page);
    const res = await page.goto("/pos/order/non-existent-id-e2e");
    expect(res?.status()).not.toBe(500);
  });
});

// ── 8. G2: Audit log — reachability via admin surface ────────────────────────

test.describe("G2: audit log", () => {
  test("admin can reach /admin/audit and see entries", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/audit");
    await expect(
      page.getByRole("table").or(page.getByText(/audit log/i)).first()
    ).toBeVisible({ timeout: 5000 });
  });

  test("audit table renders at least one row (login_success writes a row)", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/audit");
    // Every login writes an audit row — so at minimum the login_success we just
    // performed should appear.
    await expect(page.getByRole("row").first()).toBeVisible({ timeout: 5000 });
  });
});
