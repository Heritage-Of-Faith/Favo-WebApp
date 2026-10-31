// AT-201 part 2b / REQ-012, S4a: "two in one session escalate" counts the
// payments that ENTERED `unresolved` in the session (their payment.unresolved
// audit rows), whether or not a later lookup resolved them — not only those
// still unresolved now. The DB is mocked: each select resolves rows by table.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { auditLog, openingSessions, orders } from "@db/schema";

type Row = Record<string, unknown>;
let rows = new Map<unknown, Row[]>();
function selectChain() {
  let table: unknown;
  const c: Record<string, unknown> = {};
  for (const m of ["where", "leftJoin", "innerJoin", "orderBy", "limit"]) c[m] = () => c;
  c.from = (t: unknown) => { table = t; return c; };
  c.then = (resolve: (v: Row[]) => void, reject: (e: unknown) => void) =>
    Promise.resolve(rows.get(table) ?? []).then(resolve, reject);
  return c;
}
vi.mock("@/lib/db", () => ({ db: { select: () => selectChain() } }));
const mockAlert = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/server/push/admin-alert", () => ({ alertAdmins: (...a: unknown[]) => mockAlert(...a) }));

import { createAdminTenderNotifier } from "@/server/tender/admin-notifier";

// Sunday 25 Oct 2026: the morning session opens 07:50 SAST, the evening 17:00.
const at = (hhmm: string) => new Date(`2026-10-25T${hhmm}:00+02:00`);
const NOW = at("09:00");
const INFO = { orderId: "ord-b-0000-0000", attempt: 1, amountZar: 3000, cause: "ceiling" };

function given(entered: Row[]) {
  rows = new Map<unknown, Row[]>([
    [orders, [{ revenueDay: "2026-10-25", baristaName: "Nkuli" }]],
    [openingSessions, [{ opensAt: "07:50" }, { opensAt: "17:00" }]],
    [auditLog, entered],
  ]);
}

beforeEach(() => vi.clearAllMocks());

describe("REQ-012 escalation counts payments that entered unresolved in the session", () => {
  it("a morning payment that entered unresolved and was later RESOLVED still counts: this second one escalates", async () => {
    given([
      { entityId: "pmt-a", at: at("08:10"), reason: "ceiling" },      // since attached successful by job 4
      { entityId: "pmt-b", at: at("08:59"), reason: "send_timeout" }, // this one
    ]);
    await createAdminTenderNotifier(() => NOW).paymentUnresolved(INFO);
    expect(mockAlert).toHaveBeenCalledTimes(2);
    expect(mockAlert.mock.calls[0][0]).toBe("Payment unresolved — order ord-b-00");
    expect(mockAlert.mock.calls[0][1]).toContain("Nkuli");
    expect(mockAlert.mock.calls[0][1]).toContain("session 2026-10-25 07:50");
    expect(mockAlert.mock.calls[1][0]).toBe("2 unresolved payments this session");
  });

  it("one in this session, one in the evening session, and a duplicate_charge → no escalation", async () => {
    given([
      { entityId: "pmt-b", at: at("08:59"), reason: "ceiling" },
      { entityId: "pmt-c", at: at("17:30"), reason: "ceiling" },          // the other session
      { entityId: "pmt-d", at: at("08:30"), reason: "duplicate_charge" }, // pushed on its own
    ]);
    await createAdminTenderNotifier(() => NOW).paymentUnresolved(INFO);
    expect(mockAlert).toHaveBeenCalledTimes(1);
  });

  it("the same payment's rows count once", async () => {
    given([
      { entityId: "pmt-b", at: at("08:20"), reason: "send_timeout" },
      { entityId: "pmt-b", at: at("08:23"), reason: "ceiling" },
    ]);
    await createAdminTenderNotifier(() => NOW).paymentUnresolved(INFO);
    expect(mockAlert).toHaveBeenCalledTimes(1);
  });
});
