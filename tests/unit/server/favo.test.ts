// The Favo server actions — AT-142.
// Auth matrix (staff any / customer self only / stranger rejected), shared-schema
// validation, menu/customisation reference checks, upsert + audit wiring.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockAuthorize = vi.fn();
vi.mock("@/server/auth/guard", () => ({
  authorize: (...a: unknown[]) => mockAuthorize(...a),
}));

const mockGetCustomerSession = vi.fn();
vi.mock("@/server/auth/customer-session", () => ({
  getCustomerSession: () => mockGetCustomerSession(),
}));

const mockWriteAudit = vi.fn().mockResolvedValue(undefined);
vi.mock("@/server/audit", () => ({
  writeAudit: (...a: unknown[]) => mockWriteAudit(...a),
}));

// db mock: select-chains resolve from a FIFO queue of row sets; transaction
// runs its callback against a tx exposing the same select queue plus
// insert/…/returning and delete chains.
const selectQueue: unknown[][] = [];
const mockReturning = vi.fn();
const mockDelete = vi.fn();

function selectChain() {
  const rows = selectQueue.shift() ?? [];
  const c: Record<string, unknown> = {};
  c.from = vi.fn().mockReturnValue(c);
  c.where = vi.fn().mockImplementation(() => Promise.resolve(rows));
  return c;
}

const tx = {
  select: vi.fn().mockImplementation(selectChain),
  insert: vi.fn().mockImplementation(() => ({
    values: vi.fn().mockReturnValue({
      onConflictDoUpdate: vi.fn().mockReturnValue({
        returning: mockReturning,
      }),
    }),
  })),
  delete: vi.fn().mockImplementation(() => ({ where: mockDelete })),
};

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn().mockImplementation(() => selectChain()),
    transaction: vi.fn().mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx)),
  },
}));

import { getFavo, setFavo, clearFavo } from "@/server/actions/favo";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CUSTOMER_ID = "cust_1";
const STAFF_SESSION = { ok: true, session: { id: "staff_sam", name: "Sam", role: "barista" } };
const NO_STAFF = { ok: false, code: "UNAUTHORIZED", message: "You must be signed in." };

const ITEMS = [
  { menuItemId: "menu_cappuccino", quantity: 1, modifications: ["mod_oat", "mod_shot", "mod_shot"] },
];
const MENU_ROWS = [{ id: "menu_cappuccino", active: true }];
const MOD_ROWS = [
  { id: "mod_oat", menuItemId: "menu_cappuccino" },
  { id: "mod_shot", menuItemId: "menu_cappuccino" },
];
const SAVED_ROW = {
  items: ITEMS,
  updatedAt: new Date("2026-07-09T08:00:00Z"),
  updatedByStaffId: "staff_sam",
};

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue.length = 0;
  mockReturning.mockResolvedValue([SAVED_ROW]);
  mockDelete.mockResolvedValue(undefined);
});

// ─── Auth matrix ──────────────────────────────────────────────────────────────

describe("Favo auth", () => {
  it("rejects when there is no session at all", async () => {
    mockAuthorize.mockResolvedValue(NO_STAFF);
    mockGetCustomerSession.mockResolvedValue(null);
    const res = await getFavo(CUSTOMER_ID);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("UNAUTHORIZED");
  });

  it("rejects a customer touching someone else's Favo", async () => {
    mockAuthorize.mockResolvedValue(NO_STAFF);
    mockGetCustomerSession.mockResolvedValue("cust_other");
    const res = await setFavo(CUSTOMER_ID, ITEMS);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("UNAUTHORIZED");
  });

  it("allows a customer to read their own Favo", async () => {
    mockAuthorize.mockResolvedValue(NO_STAFF);
    mockGetCustomerSession.mockResolvedValue(CUSTOMER_ID);
    selectQueue.push([SAVED_ROW]);
    const res = await getFavo(CUSTOMER_ID);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.favo?.items).toEqual(ITEMS);
  });

  it("allows staff to read any customer's Favo", async () => {
    mockAuthorize.mockResolvedValue(STAFF_SESSION);
    selectQueue.push([]);
    const res = await getFavo(CUSTOMER_ID);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.favo).toBeNull();
  });
});

// ─── setFavo validation ───────────────────────────────────────────────────────

describe("setFavo — validation", () => {
  beforeEach(() => mockAuthorize.mockResolvedValue(STAFF_SESSION));

  it("rejects an empty template", async () => {
    const res = await setFavo(CUSTOMER_ID, []);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("INVALID_INPUT");
  });

  it("rejects zero/negative quantities", async () => {
    const res = await setFavo(CUSTOMER_ID, [{ menuItemId: "m", quantity: 0, modifications: [] }]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("INVALID_INPUT");
  });

  it("rejects a menu item that is not on the active menu", async () => {
    selectQueue.push([{ id: "menu_cappuccino", active: false }], MOD_ROWS);
    const res = await setFavo(CUSTOMER_ID, ITEMS);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("UNKNOWN_MENU_ITEM");
  });

  it("rejects a customisation that belongs to a different menu item", async () => {
    selectQueue.push(MENU_ROWS, [
      { id: "mod_oat", menuItemId: "menu_mocha" },
      { id: "mod_shot", menuItemId: "menu_cappuccino" },
    ]);
    const res = await setFavo(CUSTOMER_ID, ITEMS);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("INVALID_CUSTOMISATION");
  });
});

// ─── setFavo happy paths ──────────────────────────────────────────────────────

describe("setFavo — happy path", () => {
  it("staff save: upserts, audits as staff, stamps updatedByStaffId", async () => {
    mockAuthorize.mockResolvedValue(STAFF_SESSION);
    selectQueue.push(MENU_ROWS, MOD_ROWS, []); // menu, mods, no prior favo (in tx)
    const res = await setFavo(CUSTOMER_ID, ITEMS);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.favo.items).toEqual(ITEMS);
      expect(res.data.favo.updatedByStaffId).toBe("staff_sam");
    }
    expect(mockWriteAudit).toHaveBeenCalledTimes(1);
    const audit = mockWriteAudit.mock.calls[0][0];
    expect(audit).toMatchObject({
      entityKind: "favo",
      entityId: CUSTOMER_ID,
      action: "create",
      actorId: "staff_sam",
      actorRole: "barista",
    });
  });

  it("customer self-save: audits as customer, replace = update action", async () => {
    mockAuthorize.mockResolvedValue(NO_STAFF);
    mockGetCustomerSession.mockResolvedValue(CUSTOMER_ID);
    mockReturning.mockResolvedValue([{ ...SAVED_ROW, updatedByStaffId: null }]);
    selectQueue.push(MENU_ROWS, MOD_ROWS, [{ items: [] }]); // prior favo exists
    const res = await setFavo(CUSTOMER_ID, ITEMS);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.favo.updatedByStaffId).toBeNull();
    const audit = mockWriteAudit.mock.calls[0][0];
    expect(audit).toMatchObject({ action: "update", actorId: CUSTOMER_ID, actorRole: "customer" });
  });
});

// ─── clearFavo ────────────────────────────────────────────────────────────────

describe("clearFavo", () => {
  beforeEach(() => mockAuthorize.mockResolvedValue(STAFF_SESSION));

  it("deletes and audits when a Favo exists", async () => {
    selectQueue.push([{ items: ITEMS }]);
    const res = await clearFavo(CUSTOMER_ID);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.cleared).toBe(true);
    expect(mockWriteAudit).toHaveBeenCalledTimes(1);
    expect(mockWriteAudit.mock.calls[0][0]).toMatchObject({
      entityKind: "favo",
      action: "delete",
      entityId: CUSTOMER_ID,
    });
  });

  it("is a safe no-op when there is nothing to clear", async () => {
    selectQueue.push([]);
    const res = await clearFavo(CUSTOMER_ID);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.cleared).toBe(false);
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });
});
