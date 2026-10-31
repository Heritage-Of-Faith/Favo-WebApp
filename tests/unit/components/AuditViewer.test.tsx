// AuditViewer — QA r1-admin P2g: the hard-coded "inventory" filter matched no
// rows (the real kinds are inventory_lot / inventory_item) and opening_session,
// stock_take, reports, waste_log had no option. Options now come from the
// entity kinds actually present in audit_log.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import AuditViewer from "@/components/admin/AuditViewer";

vi.mock("@/server/actions/audit", () => ({
  listAudit: vi.fn().mockResolvedValue({ ok: true, data: { rows: [], total: 0, page: 0, pageSize: 50 } }),
}));

beforeEach(() => vi.clearAllMocks());

describe("AuditViewer entity filter", () => {
  it("offers exactly the entity kinds it is given, and no made-up 'inventory'", () => {
    const kinds = ["inventory_item", "inventory_lot", "opening_session", "stock_take", "reports", "waste_log"];
    render(<AuditViewer initialRows={[]} total={0} entityKinds={kinds} />);
    const select = screen.getByLabelText("Entity") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["", ...kinds]);
    expect(values).not.toContain("inventory");
  });
});

// QA R5-4: the entity cell read "reportssales…" — kind and id ran together.
describe("AuditViewer entity cell", () => {
  it("separates the entity kind from its id and keeps the full id on hover", () => {
    const row = {
      id: "a1", entityKind: "reports", entityId: "sales_2026-10-14_2026-10-27", action: "export",
      actorId: null, actorRole: "admin", at: "2026-10-27T08:00:00.000Z", before: null, after: null, reason: null,
    };
    render(<AuditViewer initialRows={[row]} total={1} entityKinds={["reports"]} />);
    const cell = screen.getByTitle("reports · sales_2026-10-14_2026-10-27");
    expect(cell.textContent).toBe("reports · sales_20…");
  });

  it("does not add an ellipsis to a short id", () => {
    const row = {
      id: "a2", entityKind: "staff", entityId: "unknown", action: "login_failed",
      actorId: null, actorRole: null, at: "2026-10-27T08:00:00.000Z", before: null, after: null, reason: null,
    };
    render(<AuditViewer initialRows={[row]} total={1} entityKinds={["staff"]} />);
    expect(screen.getByTitle("staff · unknown").textContent).toBe("staff · unknown");
  });
});
