// REQ-124 · REQ-145 — §7.3.1's write-down block on the weekly summary: every
// barista named, zero printed as 0 (never omitted), vouchers as a count AND a
// value, a value-less figure UNAVAILABLE (never R0,00).

import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import WeeklyWriteDowns from "@/components/pos/WeeklyWriteDowns";
import type { BaristaWriteDownLine } from "@/server/write-downs/vouchers";

const z = () => ({ count: 0, zar: 0 });
const line = (staffId: string, name: string, over: Partial<BaristaWriteDownLine> = {}): BaristaWriteDownLine => ({
  staffId,
  name,
  comps: z(),
  writeOffs: { ...z(), byReason: { unresolved_at_close: z(), declined_not_retendered: z(), deferred_unsettled: z() }, unapproved: z() },
  abandoned: { count: 0 },
  vouchers: z(),
  ...over,
});

const textOf = (staffId: string) =>
  (within(document.querySelector(`[data-staff-id="${staffId}"]`) as HTMLElement).getAllByText(/./).map((e) => e.textContent ?? "").join(" | ")).replace(/\s/g, " ");

describe("WeeklyWriteDowns", () => {
  it("names all three baristas and prints every figure, zeroes as 0", () => {
    render(<WeeklyWriteDowns perBarista={[line("s1", "Louis"), line("s2", "Thandeka"), line("s3", "Nkuli")]} />);
    for (const n of ["Louis", "Thandeka", "Nkuli"]) expect(screen.getByText(n)).toBeTruthy();
    const t = textOf("s3");
    expect(t).toContain("Comps | 0 · R 0,00");
    expect(t).toContain("Deferred write-offs | 0 · R 0,00");
    expect(t).toContain("unresolved at close | 0 · R 0,00");
    expect(t).toContain("Abandoned orders | 0");
    expect(t).toContain("Vouchers | 0 · R 0,00");
  });

  it("vouchers read as a count and a value — R152,00 over 4 slips beside R84,00 over 4", () => {
    render(
      <WeeklyWriteDowns
        perBarista={[line("s1", "Louis", { vouchers: { count: 4, zar: 15200 } }), line("s2", "Thandeka", { vouchers: { count: 4, zar: 8400 } })]}
      />
    );
    expect(textOf("s1")).toContain("Vouchers | 4 · R 152,00");
    expect(textOf("s2")).toContain("Vouchers | 4 · R 84,00");
  });

  it("a comp whose value is absent reads UNAVAILABLE, never R0,00", () => {
    render(<WeeklyWriteDowns perBarista={[line("s1", "Louis", { comps: { count: 1, zar: null } })]} />);
    expect(textOf("s1")).toContain("Comps | 1 · UNAVAILABLE");
  });
});
