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
