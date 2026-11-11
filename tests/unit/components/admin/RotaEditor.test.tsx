// The barista rota editor (PRD §6.3, §10.3 barista_shifts `shift_date + slot`,
// COL-23): 14 days × two sessions × the active baristas; ticking a cell plans a
// shift; a shift whose session has opened is locked.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mockAdd = vi.fn();
const mockRemove = vi.fn();
vi.mock("@/server/actions/rota", () => ({
  addShift: (...a: unknown[]) => mockAdd(...a),
  removeShift: (...a: unknown[]) => mockRemove(...a),
}));

import RotaEditor from "@/components/admin/RotaEditor";
import { rotaDates } from "@/lib/rota";

const DATES = rotaDates("2026-11-11");
const BARISTAS = [{ id: "staff_louis", name: "Louis" }, { id: "staff_nkuli", name: "Nkuli" }];

beforeEach(() => vi.clearAllMocks());

describe("RotaEditor", () => {
  it("shows 14 days × 2 sessions × each barista", () => {
    render(<RotaEditor today="2026-11-11" openedToday={0} dates={DATES} baristas={BARISTAS} initialShifts={[]} />);
    expect(screen.getAllByRole("checkbox")).toHaveLength(14 * 2 * 2);
    expect(screen.getByText(/\(today\)/)).toBeTruthy();
  });

  it("ticking Nkuli on Sunday's second session plans that date + slot", async () => {
    mockAdd.mockResolvedValue({ ok: true, data: { shiftId: "bs_9" } });
    render(<RotaEditor today="2026-11-11" openedToday={0} dates={DATES} baristas={BARISTAS} initialShifts={[]} />);
    const box = screen.getByRole("checkbox", { name: /^Nkuli on duty, Sun, 15 Nov, Second session$/ });
    fireEvent.click(box);
    await waitFor(() => expect(mockAdd).toHaveBeenCalledWith({ staffId: "staff_nkuli", shiftDate: "2026-11-15", slot: 2 }));
    await waitFor(() => expect(box).toBeChecked());
  });

  it("a shift whose session has opened is checked and locked", () => {
    render(
      <RotaEditor
        today="2026-11-11" openedToday={1} dates={DATES} baristas={BARISTAS}
        initialShifts={[{
          id: "bs_1", staffId: "staff_louis", staffName: "Louis", shiftDate: "2026-11-11", slot: 1,
          sessionOpened: true, notified: true,
        }]}
      />
    );
    const box = screen.getByRole("checkbox", { name: /^Louis on duty, .* First session \(session opened\)$/ });
    expect(box).toBeChecked();
    expect(box).toBeDisabled();
    fireEvent.click(box);
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("today's opened slots are locked even where nobody was rostered; later slots stay open", () => {
    render(<RotaEditor today="2026-11-11" openedToday={1} dates={DATES} baristas={BARISTAS} initialShifts={[]} />);
    const opened = screen.getByRole("checkbox", { name: /^Nkuli on duty, Wed, 11 Nov, First session \(session opened\)$/ });
    expect(opened).not.toBeChecked();
    expect(opened).toBeDisabled();
    fireEvent.click(opened);
    expect(mockAdd).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: /^Nkuli on duty, Wed, 11 Nov, Second session$/ })).not.toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /^Nkuli on duty, Thu, 12 Nov, First session$/ })).not.toBeDisabled();
  });

  it("with no active baristas it says so", () => {
    render(<RotaEditor today="2026-11-11" openedToday={0} dates={DATES} baristas={[]} initialShifts={[]} />);
    expect(screen.getByText("No active baristas. Add one under Staff first.")).toBeTruthy();
  });
});
