// Container actions unit tests — Phase 3
// openContainer / closeContainer / listOpenContainers, mocked DB (no PG).

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mutable auth mock so we can flip RBAC per test.
const authState = {
  ok: true as boolean,
  session: { id: "staff_sam", name: "Sam", role: "barista" as const },
};

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockImplementation(async () =>
    authState.ok
      ? { ok: true, session: authState.session }
      : { ok: false, code: "FORBIDDEN", message: "Insufficient role." }
  ),
}));

vi.mock("@/server/audit", () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));

// Programmable tx: each awaited select-chain yields the next queued row array.
const txState = {
  selectQueue: [] as unknown[][],
  insertValues: vi.fn().mockResolvedValue([]),
  updateSet: vi.fn(),
};

const txStateIdx = { value: 0 };

function selectChain() {
  const chain: Record<string, unknown> = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    for: vi.fn(() => chain),
    then: (resolve: (v: unknown[]) => void) => {
      const rows = txState.selectQueue[txStateIdx.value++] ?? [];
      resolve(rows);
    },
  };
  return chain;
}

vi.mock("@db/index", () => {
  const tx = {
    execute: vi.fn().mockResolvedValue([]),
    select: vi.fn(() => selectChain()),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
    insert: vi.fn(() => ({ values: (v: unknown) => txState.insertValues(v) })),
  };
  return {
    db: {
      execute: vi.fn().mockResolvedValue([]),
      select: vi.fn(() => selectChain()),
      transaction: vi.fn().mockImplementation(
        async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)
      ),
    },
    __tx: tx,
  };
});

function queueSelects(rows: unknown[][]) {
  txState.selectQueue = rows;
  txStateIdx.value = 0;
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.ok = true;
  authState.session = { id: "staff_sam", name: "Sam", role: "barista" };
  txState.insertValues = vi.fn().mockResolvedValue([]);
  queueSelects([]);
});

describe("openContainer", () => {
  it("returns FORBIDDEN when not authorised", async () => {
    authState.ok = false;
    const { openContainer } = await import("@/server/actions/containers");
    const r = await openContainer("inv_item_whole_milk_cups");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("FORBIDDEN");
  });

  it("CONFLICT when a container is already open", async () => {
    queueSelects([[{ id: "lot_open" }]]); // alreadyOpen → one row
    const { openContainer } = await import("@/server/actions/containers");
    const r = await openContainer("inv_item_whole_milk_cups");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CONFLICT");
  });

  it("NOT_FOUND when no sealed container remains", async () => {
    queueSelects([[], []]); // alreadyOpen empty, sealed empty
    const { openContainer } = await import("@/server/actions/containers");
    const r = await openContainer("inv_item_whole_milk_cups");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });

  it("opens the oldest sealed container and audits", async () => {
    queueSelects([[], [{ id: "lot_sealed_1" }]]); // none open, one sealed
    const { openContainer } = await import("@/server/actions/containers");
    const { writeAudit } = await import("@/server/audit");
    const r = await openContainer("inv_item_whole_milk_cups");
    expect(r.ok).toBe(true);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "open_container", entityId: "lot_sealed_1" }),
      expect.anything()
    );
  });
});

describe("closeContainer", () => {
  it("CONFLICT when the lot is not open", async () => {
    queueSelects([[{ id: "lot_x", state: "active" }]]);
    const { closeContainer } = await import("@/server/actions/containers");
    const r = await closeContainer("lot_x");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CONFLICT");
  });

  it("NOT_FOUND when the lot does not exist", async () => {
    queueSelects([[]]);
    const { closeContainer } = await import("@/server/actions/containers");
    const r = await closeContainer("lot_missing");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });

  it("writes off remaining cups with an adjustment and closes", async () => {
    queueSelects([
      [{ id: "lot_open", state: "open" }], // the lot
      [{ total: 4 }], // lotCups → 4 remaining
    ]);
    const { closeContainer } = await import("@/server/actions/containers");
    const { writeAudit } = await import("@/server/audit");
    const r = await closeContainer("lot_open");
    expect(r.ok).toBe(true);
    // Adjustment write-off for the 4 leftover cups (COGS-neutral).
    expect(txState.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ inventoryLotId: "lot_open", delta: -4, kind: "adjustment" })
    );
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "close_container" }),
      expect.anything()
    );
  });

  it("does not write an adjustment when the container is already empty", async () => {
    queueSelects([
      [{ id: "lot_open", state: "open" }],
      [{ total: 0 }], // nothing remaining
    ]);
    const { closeContainer } = await import("@/server/actions/containers");
    const r = await closeContainer("lot_open");
    expect(r.ok).toBe(true);
    expect(txState.insertValues).not.toHaveBeenCalled();
  });
});

describe("listOpenContainers", () => {
  it("returns one view per cup item with open lot + sealed count", async () => {
    // 1st select: cup items; 2nd: lots for item A; 3rd: lots for item B
    queueSelects([
      [
        { id: "inv_item_whole_milk_cups", name: "Full-Cream Milk (carton)" },
        { id: "inv_item_beans_cups", name: "Espresso Beans (bag)" },
      ],
      [
        { id: "lot_m_open", state: "open", batchNumber: "CLV-CUP-001", sourceName: "Clover" },
        { id: "lot_m_2", state: "active", batchNumber: "CLV-CUP-002", sourceName: "Clover" },
        { id: "lot_m_3", state: "active", batchNumber: "CLV-CUP-003", sourceName: "Clover" },
      ],
      [
        { id: "lot_b_1", state: "active", batchNumber: "OCR-CUP-001", sourceName: "Origin" },
      ],
    ]);
    const { listOpenContainers } = await import("@/server/actions/containers");
    const r = await listOpenContainers();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const milk = r.data.containers.find((c) => c.inventoryItemId === "inv_item_whole_milk_cups");
    expect(milk).toMatchObject({ openLotId: "lot_m_open", openLabel: "CLV-CUP-001", sealedCount: 2 });
    const beans = r.data.containers.find((c) => c.inventoryItemId === "inv_item_beans_cups");
    expect(beans).toMatchObject({ openLotId: null, sealedCount: 1 });
  });
});
