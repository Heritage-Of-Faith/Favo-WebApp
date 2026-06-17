// HoursEditor unit tests — AT-76 (A14)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import HoursEditor from "@/components/admin/HoursEditor";
import type { OperatingHour } from "@/lib/types";

vi.mock("@/server/actions/hours", () => ({
  setOperatingHours: vi.fn().mockResolvedValue({ ok: true, data: {} }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const SAMPLE_HOURS: OperatingHour[] = [
  { dayOfWeek: 1, opensAt: "07:00", closesAt: "17:00", isClosed: false },
  { dayOfWeek: 2, opensAt: "07:00", closesAt: "17:00", isClosed: false },
  { dayOfWeek: 3, opensAt: "07:00", closesAt: "17:00", isClosed: false },
  { dayOfWeek: 4, opensAt: "07:00", closesAt: "17:00", isClosed: false },
  { dayOfWeek: 5, opensAt: "07:00", closesAt: "17:00", isClosed: false },
  { dayOfWeek: 6, opensAt: "08:00", closesAt: "13:00", isClosed: false },
  { dayOfWeek: 0, opensAt: "07:00", closesAt: "17:00", isClosed: true },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("HoursEditor", () => {
  it("renders seven rows (Mon–Sun)", () => {
    render(<HoursEditor initialHours={SAMPLE_HOURS} />);
    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
      expect(screen.getByText(day)).toBeTruthy();
    }
  });

  it("populates time inputs from initialHours", () => {
    render(<HoursEditor initialHours={SAMPLE_HOURS} />);
    const satOpen = screen.getByLabelText("Sat opens at") as HTMLInputElement;
    expect(satOpen.value).toBe("08:00");
    const satClose = screen.getByLabelText("Sat closes at") as HTMLInputElement;
    expect(satClose.value).toBe("13:00");
  });

  it("shows closed toggle as checked for a closed day", () => {
    render(<HoursEditor initialHours={SAMPLE_HOURS} />);
    const sunCheckbox = screen.getByLabelText("Sun closed all day") as HTMLInputElement;
    expect(sunCheckbox.checked).toBe(true);
  });

  it("disables time inputs when closed toggle is on", () => {
    render(<HoursEditor initialHours={SAMPLE_HOURS} />);
    const openInput = screen.getByLabelText("Sun opens at") as HTMLInputElement;
    expect(openInput.disabled).toBe(true);
  });

  it("uses 07:00–17:00 defaults for days missing from initialHours", () => {
    render(<HoursEditor initialHours={[]} />);
    const monOpen = screen.getByLabelText("Mon opens at") as HTMLInputElement;
    expect(monOpen.value).toBe("07:00");
    const monClose = screen.getByLabelText("Mon closes at") as HTMLInputElement;
    expect(monClose.value).toBe("17:00");
  });

  it("calls setOperatingHours 7 times on save", async () => {
    const { setOperatingHours } = await import("@/server/actions/hours");
    render(<HoursEditor initialHours={SAMPLE_HOURS} />);
    fireEvent.click(screen.getByRole("button", { name: /save hours/i }));
    await waitFor(() => {
      expect(setOperatingHours).toHaveBeenCalledTimes(7);
    });
  });

  it("calls setOperatingHours with correct dayOfWeek, openTime, closeTime", async () => {
    const { setOperatingHours } = await import("@/server/actions/hours");
    render(<HoursEditor initialHours={SAMPLE_HOURS} />);
    fireEvent.click(screen.getByRole("button", { name: /save hours/i }));
    await waitFor(() => {
      expect(setOperatingHours).toHaveBeenCalledWith(
        expect.objectContaining({ dayOfWeek: 6, openTime: "08:00", closeTime: "13:00" })
      );
    });
  });

  it("shows success toast after save", async () => {
    const { toast } = await import("sonner");
    render(<HoursEditor initialHours={SAMPLE_HOURS} />);
    fireEvent.click(screen.getByRole("button", { name: /save hours/i }));
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Operating hours saved.");
    });
  });

  it("shows error toast when any day fails", async () => {
    const { setOperatingHours } = await import("@/server/actions/hours");
    vi.mocked(setOperatingHours).mockResolvedValueOnce({
      ok: false,
      code: "VALIDATION",
      message: "Invalid time.",
    });
    const { toast } = await import("sonner");
    render(<HoursEditor initialHours={SAMPLE_HOURS} />);
    fireEvent.click(screen.getByRole("button", { name: /save hours/i }));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Invalid time.");
    });
  });

  it("includes L04 copy about display-only", () => {
    render(<HoursEditor initialHours={SAMPLE_HOURS} />);
    expect(
      screen.getByText(/orders are never refused based on time/i)
    ).toBeTruthy();
  });
});
