// QA r1-admin P2b (huge price → server 500) and P2c (duplicate "Mocha" accepted).
// Calls the real menu actions with the DB mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";

let existingNames: { id: string; name: string; active: boolean }[] = [];
const txInsert = vi.fn();

vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
  revalidateTag: vi.fn(),
}));

vi.mock("@db/index", () => ({
  db: {
    select: vi.fn().mockImplementation(() => ({
      from: () => ({
        where: () => Promise.resolve(existingNames),
      }),
    })),
    transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        insert: txInsert.mockImplementation(() => ({
          values: () => ({
            returning: () => Promise.resolve([{ id: "m_new", name: "Oat Latte", category: "coffee", currentPriceZar: 4200, active: true }]),
            then: (r: (v: unknown) => void) => r(undefined),
          }),
        })),
      })
    ),
  },
}));

vi.mock("@/server/audit", () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({ ok: true, session: { id: "a", name: "Mia", role: "admin" } }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  existingNames = [];
});

describe("createMenuItem — duplicates", () => {
  it("refuses a second 'mocha' in Coffee when 'Mocha' exists (case-insensitive)", async () => {
    existingNames = [{ id: "m1", name: "Mocha", active: true }];
    const { createMenuItem } = await import("@/server/actions/menu");
    const res = await createMenuItem({ name: "  mocha ", category: "coffee", priceZar: 2000 });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("DUPLICATE");
      expect(res.message).toMatch(/Mocha/);
    }
    expect(txInsert).not.toHaveBeenCalled();
  });

  it("tells you to reactivate when the duplicate is inactive", async () => {
    existingNames = [{ id: "m1", name: "Mocha", active: false }];
    const { createMenuItem } = await import("@/server/actions/menu");
    const res = await createMenuItem({ name: "Mocha", category: "coffee", priceZar: 2000 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/reactivate/i);
  });

  it("creates when no item of that name exists in the category", async () => {
    const { createMenuItem } = await import("@/server/actions/menu");
    const res = await createMenuItem({ name: "Oat Latte", category: "coffee", priceZar: 4200 });
    expect(res.ok).toBe(true);
  });
});

describe("menu prices — bounds (no server 500)", () => {
  it("createMenuItem refuses R99 999 999 (9 999 999 900 c > integer column)", async () => {
    const { createMenuItem } = await import("@/server/actions/menu");
    const res = await createMenuItem({ name: "Big", category: "coffee", priceZar: 9_999_999_900 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("INVALID_INPUT");
  });

  it("setMenuItemPrice refuses R99 999 999", async () => {
    const { setMenuItemPrice } = await import("@/server/actions/menu");
    const res = await setMenuItemPrice({ menuItemId: "m1", newPriceZar: 9_999_999_900 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("INVALID_INPUT");
  });
});
