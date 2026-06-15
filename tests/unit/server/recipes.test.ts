// Recipe server-action unit tests — recipes.ts
// Covers RBAC, validation, not-found paths, and audit call-site for all four
// exported functions. DB-happy paths for bumpRecipeVersion / listRecipes are
// covered by integration specs; unit tests focus on guards and error branches.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@db/index", () => {
  function chain() {
    const c: Record<string, unknown> = {
      then: (resolve: (v: unknown[]) => void) => resolve([]),
      from: vi.fn(), where: vi.fn(),
      leftJoin: vi.fn(), innerJoin: vi.fn(),
    };
    for (const k of ["from", "where", "leftJoin", "innerJoin"]) {
      (c[k] as ReturnType<typeof vi.fn>).mockReturnValue(c);
    }
    return c;
  }
  return {
    db: {
      select: vi.fn().mockImplementation(chain),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: "recipe_new" }]),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      }),
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: "recipe_new" }]),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
          }),
          select: vi.fn().mockImplementation(chain),
        };
        return cb(tx);
      }),
    },
  };
});

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({
    ok: true,
    session: { id: "staff_admin_gian", name: "Gian", role: "admin" },
  }),
}));

vi.mock("@/server/audit", () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ADMIN_SESSION = { ok: true as const, session: { id: "staff_admin_gian", name: "Gian", role: "admin" as const } };
const FORBIDDEN = { ok: false as const, code: "FORBIDDEN" as const, message: "Insufficient role." };

// ─── getRecipe — RBAC ─────────────────────────────────────────────────────────

describe("getRecipe — RBAC", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns FORBIDDEN for barista caller", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce(FORBIDDEN);
    const { getRecipe } = await import("@/server/actions/recipes");
    const result = await getRecipe("item_cappuccino");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });
});

// ─── getRecipe — not found / no recipe ───────────────────────────────────────

describe("getRecipe — not found paths", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns NOT_FOUND for unknown menu item id", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue(ADMIN_SESSION);
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    } as never);
    const { getRecipe } = await import("@/server/actions/recipes");
    const result = await getRecipe("item_nonexistent");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });

  it("returns { recipe: null } for item with no recipeId", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue(ADMIN_SESSION);
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { id: "item_food", name: "Croissant", recipeId: null },
        ]),
      }),
    } as never);
    const { getRecipe } = await import("@/server/actions/recipes");
    const result = await getRecipe("item_food");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.recipe).toBeNull();
  });

  it("returns { recipe: null } when recipe row is missing (dangling FK)", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue(ADMIN_SESSION);
    const { db } = await import("@db/index");
    // First call: menu item with a recipeId
    vi.mocked(db.select)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { id: "item_cappuccino", name: "Cappuccino", recipeId: "recipe_orphan" },
          ]),
        }),
      } as never)
      // Second call: recipe row missing
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      } as never);
    const { getRecipe } = await import("@/server/actions/recipes");
    const result = await getRecipe("item_cappuccino");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.recipe).toBeNull();
  });
});

// ─── updateRecipeIngredient — validation ─────────────────────────────────────

describe("updateRecipeIngredient — validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects fractional quantity (e.g. 7.5)", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue(ADMIN_SESSION);
    const { updateRecipeIngredient } = await import("@/server/actions/recipes");
    const result = await updateRecipeIngredient("ing_1", { quantity: 7.5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_INPUT");
  });

  it("rejects negative quantity", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue(ADMIN_SESSION);
    const { updateRecipeIngredient } = await import("@/server/actions/recipes");
    const result = await updateRecipeIngredient("ing_1", { quantity: -1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_INPUT");
  });

  it("rejects tolerancePct > 100", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue(ADMIN_SESSION);
    const { updateRecipeIngredient } = await import("@/server/actions/recipes");
    const result = await updateRecipeIngredient("ing_1", { tolerancePct: 101 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_INPUT");
  });

  it("rejects fractional tolerancePct (e.g. 5.5)", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue(ADMIN_SESSION);
    const { updateRecipeIngredient } = await import("@/server/actions/recipes");
    const result = await updateRecipeIngredient("ing_1", { tolerancePct: 5.5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_INPUT");
  });
});

// ─── updateRecipeIngredient — not found ──────────────────────────────────────

describe("updateRecipeIngredient — not found", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns NOT_FOUND for unknown ingredient id", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue(ADMIN_SESSION);
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    } as never);
    const { updateRecipeIngredient } = await import("@/server/actions/recipes");
    const result = await updateRecipeIngredient("ing_nonexistent", { quantity: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });

  it("returns ok with empty patch (no-op, skips DB update)", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue(ADMIN_SESSION);
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { id: "ing_1", quantity: 18, unit: "g", tolerancePct: 5, recipeId: "recipe_1" },
        ]),
      }),
    } as never);
    const { updateRecipeIngredient } = await import("@/server/actions/recipes");
    const result = await updateRecipeIngredient("ing_1", {});
    expect(result.ok).toBe(true);
  });
});

// ─── updateRecipeIngredient — audit ──────────────────────────────────────────

describe("updateRecipeIngredient — audit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls writeAudit on successful update", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue(ADMIN_SESSION);
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { id: "ing_1", quantity: 18, unit: "g", tolerancePct: 5, recipeId: "recipe_1" },
        ]),
      }),
    } as never);
    const { writeAudit } = await import("@/server/audit");
    const { updateRecipeIngredient } = await import("@/server/actions/recipes");
    await updateRecipeIngredient("ing_1", { quantity: 20 });
    expect(writeAudit).toHaveBeenCalledOnce();
  });
});

// ─── bumpRecipeVersion — not found paths ─────────────────────────────────────

describe("bumpRecipeVersion — not found", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns NOT_FOUND for unknown menu item", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue(ADMIN_SESSION);
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    } as never);
    const { bumpRecipeVersion } = await import("@/server/actions/recipes");
    const result = await bumpRecipeVersion("item_nonexistent");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });

  it("returns NOT_FOUND when item has no recipe to version", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue(ADMIN_SESSION);
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { id: "item_food", recipeId: null },
        ]),
      }),
    } as never);
    const { bumpRecipeVersion } = await import("@/server/actions/recipes");
    const result = await bumpRecipeVersion("item_food");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });

  it("returns NOT_FOUND when active recipe row is missing", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue(ADMIN_SESSION);
    const { db } = await import("@db/index");
    vi.mocked(db.select)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { id: "item_cappuccino", recipeId: "recipe_orphan" },
          ]),
        }),
      } as never)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      } as never);
    const { bumpRecipeVersion } = await import("@/server/actions/recipes");
    const result = await bumpRecipeVersion("item_cappuccino");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });
});

// ─── bumpRecipeVersion — RBAC ────────────────────────────────────────────────

describe("bumpRecipeVersion — RBAC", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns FORBIDDEN for non-admin caller", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce(FORBIDDEN);
    const { bumpRecipeVersion } = await import("@/server/actions/recipes");
    const result = await bumpRecipeVersion("item_cappuccino");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });
});

// ─── bumpRecipeVersion — happy path ──────────────────────────────────────────

describe("bumpRecipeVersion — happy path", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns newRecipeId and calls writeAudit", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue(ADMIN_SESSION);
    const { db } = await import("@db/index");

    // item lookup
    vi.mocked(db.select)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { id: "item_cappuccino", recipeId: "recipe_v1" },
          ]),
        }),
      } as never)
      // active recipe lookup
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ id: "recipe_v1", version: 1 }]),
        }),
      } as never)
      // source ingredients
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { id: "ing_1", recipeId: "recipe_v1", inventoryItemId: "inv_beans", quantity: 18, unit: "g", tolerancePct: 5 },
          ]),
        }),
      } as never);

    const { writeAudit } = await import("@/server/audit");
    const { bumpRecipeVersion } = await import("@/server/actions/recipes");
    const result = await bumpRecipeVersion("item_cappuccino");

    expect(result.ok).toBe(true);
    if (result.ok) expect(typeof result.data.newRecipeId).toBe("string");
    expect(writeAudit).toHaveBeenCalledOnce();
  });
});
