// AT-209 — /admin/write-downs screen (§7.3.1, REQ-059, REQ-124, the Admin
// "Write-downs" screen row): empty reads "No write-downs this period" with
// zeroes printed, never omitted; write-offs split by every reason; a day not
// yet cleared reads `unapproved` (§6.0.5); UNAVAILABLE is never R0,00.

import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import WriteDownsReport from "@/components/admin/WriteDownsReport";
import type { BaristaWriteDowns, WriteDownRow } from "@/server/write-downs/summary";

const z = () => ({ count: 0, zar: 0 });
const zeroes = (staffId: string, name: string): BaristaWriteDowns => ({
  staffId,
  name,
  comps: z(),
  writeOffs: { ...z(), byReason: { unresolved_at_close: z(), declined_not_retendered: z(), deferred_unsettled: z() }, unapproved: z() },
  abandoned: { count: 0 },
});

const cellsOf = (name: string) =>
  within(screen.getByText(name).closest("tr")!).getAllByRole("cell").map((c) => (c.textContent ?? "").replace(/\s/g, " "));

const row = (o: Partial<WriteDownRow>): WriteDownRow => ({
  kind: "comp", auditId: "a1", revenueDay: "2026-10-25", at: new Date("2026-10-25T21:30:00Z"), staffId: "s1", staffName: "Louis",
  onBehalfOfName: null, orderId: "3f2a9c1e-7b4d-4e11-9a0b-123456789abc", valueZar: 4500, reason: "wrong_drink", unapproved: false, ...o,
});

describe("WriteDownsReport", () => {
  it("empty period: the PRD's empty copy, and every figure printed as 0 for every barista", () => {
    render(<WriteDownsReport from="2026-10-19" to="2026-10-25" perBarista={[zeroes("s1", "Louis"), zeroes("s2", "Thandeka")]} rows={[]} />);
    expect(screen.getByText("No write-downs this period")).toBeTruthy();
    expect(cellsOf("Louis")).toEqual([
      "Louis", "0 · R 0,00", "0 · R 0,00", "0 · R 0,00", "0 · R 0,00", "0 · R 0,00", "0 · R 0,00", "0",
    ]);
  });

  it("splits write-offs by every reason, named as the close names them, plus the unapproved figure", () => {
    const nkuli = zeroes("s3", "Nkuli");
    nkuli.writeOffs = {
      count: 3, zar: 8500,
      byReason: { unresolved_at_close: { count: 1, zar: 3500 }, declined_not_retendered: { count: 1, zar: 3000 }, deferred_unsettled: { count: 1, zar: 2000 } },
      unapproved: { count: 2, zar: 5500 },
    };
    render(<WriteDownsReport from="2026-10-19" to="2026-10-25" perBarista={[nkuli]} rows={[]} />);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual([
      "Barista", "Comps", "Deferred write-offs", "unresolved at close", "declined not retendered", "deferred unsettled", "unapproved", "Abandoned orders",
    ]);
    expect(cellsOf("Nkuli")).toEqual([
      "Nkuli", "0 · R 0,00", "3 · R 85,00", "1 · R 35,00", "1 · R 30,00", "1 · R 20,00", "2 · R 55,00", "0",
    ]);
  });

  it("lists by revenue day (not audit time), short order id with the full id in title, value, reason, admin PIN", () => {
    // 21:30 UTC on the 25th is 23:30 SAST; the revenue day is what shows.
    render(<WriteDownsReport from="2026-10-19" to="2026-10-25" perBarista={[zeroes("s1", "Louis")]} rows={[row({ onBehalfOfName: "Mia" })]} />);
    const order = screen.getByTitle("3f2a9c1e-7b4d-4e11-9a0b-123456789abc");
    expect(order.textContent).toBe("3f2a9c1e…");
    const tr = order.closest("tr")!;
    const cells = within(tr).getAllByRole("cell").map((c) => (c.textContent ?? "").replace(/\s/g, " "));
    expect(cells[0]).toBe("2026-10-25");
    expect(cells[1]).toBe("Comp");
    expect(cells[4]).toBe("R 45,00");
    expect(cells[5]).toBe("wrong_drink");
    expect(within(tr).getByText("admin PIN: Mia")).toBeTruthy();
    expect(screen.queryByText("No write-downs this period")).toBeNull();
  });

  it("a write-off on an uncleared day reads unapproved; an approved one does not", () => {
    render(
      <WriteDownsReport
        from="2026-10-19"
        to="2026-10-25"
        perBarista={[zeroes("s3", "Nkuli")]}
        rows={[
          row({ kind: "write_off", auditId: "w1", orderId: "ord-a", valueZar: 3500, reason: "unresolved_at_close", unapproved: true }),
          row({ kind: "write_off", auditId: "w2", orderId: "ord-b", revenueDay: "2026-10-24", valueZar: 3000, reason: "declined_not_retendered", unapproved: false }),
        ]}
      />
    );
    const a = screen.getByTitle("ord-a").closest("tr")!;
    const b = screen.getByTitle("ord-b").closest("tr")!;
    expect(within(a).getByText("unapproved")).toBeTruthy();
    expect(within(a).getByText("unresolved at close")).toBeTruthy();
    expect(within(b).queryByText("unapproved")).toBeNull();
  });

  it("a figure with no recorded value reads UNAVAILABLE, never R0,00", () => {
    render(<WriteDownsReport from="2026-10-19" to="2026-10-25" perBarista={[{ ...zeroes("s1", "Louis"), comps: { count: 1, zar: null } }]} rows={[]} />);
    expect(cellsOf("Louis")[1]).toBe("1 · UNAVAILABLE");
  });

  it("uses no refund or tip wording (L02: a comp is not a refund)", () => {
    const { container } = render(<WriteDownsReport from="2026-10-19" to="2026-10-25" perBarista={[zeroes("s1", "Louis")]} rows={[]} />);
    expect(container.textContent).not.toMatch(/refund|\btip/i);
  });
});
