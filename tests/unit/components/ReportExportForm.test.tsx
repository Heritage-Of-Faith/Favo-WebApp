// ReportExportForm unit tests — AT-77 (A15)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ReportExportForm from "@/components/admin/ReportExportForm";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    blob: () => Promise.resolve(new Blob(["data"], { type: "text/csv" })),
  });
  global.URL.createObjectURL = vi.fn().mockReturnValue("blob:test");
  global.URL.revokeObjectURL = vi.fn();
});

describe("ReportExportForm", () => {
  it("renders all four report kind options", () => {
    render(<ReportExportForm />);
    const kindSelect = screen.getByLabelText("Report type") as HTMLSelectElement;
    const options = Array.from(kindSelect.options).map((o) => o.value);
    expect(options).toEqual(["sales", "cogs", "inventory", "monthly_pnl"]);
  });

  it("renders CSV and PDF format options", () => {
    render(<ReportExportForm />);
    const fmt = screen.getByLabelText("Format") as HTMLSelectElement;
    const options = Array.from(fmt.options).map((o) => o.value);
    expect(options).toEqual(["csv", "pdf"]);
  });

  it("has From and To date inputs", () => {
    render(<ReportExportForm />);
    expect(screen.getByLabelText("From")).toBeTruthy();
    expect(screen.getByLabelText("To")).toBeTruthy();
  });

  it("calls GET /api/reports/export with correct query params", async () => {
    render(<ReportExportForm />);

    fireEvent.change(screen.getByLabelText("Report type"), { target: { value: "cogs" } });
    fireEvent.change(screen.getByLabelText("Format"), { target: { value: "pdf" } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-05-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-05-31" } });
    fireEvent.click(screen.getByRole("button", { name: /export report/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/reports/export?kind=cogs&format=pdf&from=2026-05-01&to=2026-05-31"
      );
    });
  });

  it("shows confirmation message after successful export", async () => {
    render(<ReportExportForm />);

    fireEvent.change(screen.getByLabelText("Report type"), { target: { value: "sales" } });
    fireEvent.change(screen.getByLabelText("Format"), { target: { value: "csv" } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-06-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-06-15" } });
    fireEvent.click(screen.getByRole("button", { name: /export report/i }));

    await waitFor(() => {
      const el = screen.getByTestId("export-confirmation");
      expect(el.textContent).toMatch(/Exported Sales \(CSV\)/i);
    });
  });

  it("shows error toast when API returns non-ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Invalid date range." }),
    });
    const { toast } = await import("sonner");
    render(<ReportExportForm />);

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-06-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-06-15" } });
    fireEvent.click(screen.getByRole("button", { name: /export report/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Invalid date range.");
    });
  });

  it("shows error toast when to < from is submitted", async () => {
    const { toast } = await import("sonner");
    render(<ReportExportForm />);

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-06-15" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-06-01" } });
    fireEvent.click(screen.getByRole("button", { name: /export report/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "'To' date must be on or after 'From' date."
      );
    });
  });

  it("creates an object URL from the response blob", async () => {
    render(<ReportExportForm />);

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-06-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-06-15" } });
    fireEvent.click(screen.getByRole("button", { name: /export report/i }));

    await waitFor(() => {
      expect(global.URL.createObjectURL).toHaveBeenCalled();
    });
  });

  it("revokes the object URL after download", async () => {
    render(<ReportExportForm />);

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-06-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-06-15" } });
    fireEvent.click(screen.getByRole("button", { name: /export report/i }));

    await waitFor(() => {
      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
    });
  });

  it("includes kind in the fetch URL for all four kinds", async () => {
    const kinds = ["sales", "cogs", "inventory", "monthly_pnl"] as const;
    for (const k of kinds) {
      vi.mocked(global.fetch).mockClear();
      const { unmount } = render(<ReportExportForm />);
      fireEvent.change(screen.getByLabelText("Report type"), { target: { value: k } });
      fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-06-01" } });
      fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-06-15" } });
      fireEvent.click(screen.getByRole("button", { name: /export report/i }));
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining(`kind=${k}`));
      });
      unmount();
    }
  });
});
