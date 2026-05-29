import { test, expect } from "@playwright/test";

// Phase 1 acceptance test (task G1 → G7, M1 → M7)
// Docs: docs/PLANNING.md → Phase 1 Acceptance Test
//
// Full flow:
// Barista PIN login (1234) → search "Louis" → Cappuccino + Extra Shot
// → Yoco test card → Done → push received < 10s → audit log row created

test.describe("Phase 1 acceptance", () => {
  test("barista can log in with PIN", async ({ page }) => {
    // TODO: implement once M1 (LoginForm) is done
    await page.goto("/pos");
    await expect(page).toHaveTitle(/FAVO/);
  });

  test.skip("full order flow — PIN → search → order → payment → push", async ({ page }) => {
    // TODO (G5, M1-M7): implement after all P1 tasks are complete
    void page;
  });
});
