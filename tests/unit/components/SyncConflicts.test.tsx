// SyncConflicts component tests — AT-80 (A18)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import ConflictRow from "@/components/admin/ConflictRow";
import SyncConflictsPage from "@/app/admin/(dashboard)/sync-conflicts/page";
import type { SyncConflictRow } from "@/server/actions/sync-conflicts";

vi.mock("@/server/actions/sync-conflicts", () => ({
  listSyncConflicts: vi.fn(),
  resolveSyncConflict: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function makeConflict(overrides: Partial<SyncConflictRow> = {}): SyncConflictRow {
  return {
    id: "cf-1",
    kind: "payment_mismatch",
    orderId: "ord-abc123",
    clientPayload: { amount: 500 },
    serverState: { amount: 450 },
    status: "open",
    openedAt: "2026-06-16T08:00:00Z",
    resolvedAt: null,
    resolutionNote: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ConflictRow", () => {
  it("renders kind badge with correct label", () => {
    render(<ConflictRow conflict={makeConflict()} />);
    expect(screen.getByTestId("kind-badge").textContent).toBe("Payment mismatch");
  });

  it("renders state_collision badge", () => {
    render(<ConflictRow conflict={makeConflict({ kind: "state_collision" })} />);
    expect(screen.getByTestId("kind-badge").textContent).toBe("State collision");
  });

  it("renders duplicate_order badge", () => {
    render(<ConflictRow conflict={makeConflict({ kind: "duplicate_order" })} />);
    expect(screen.getByTestId("kind-badge").textContent).toBe("Duplicate order");
  });

  it("expands to show JSON diff on click", async () => {
    render(<ConflictRow conflict={makeConflict()} />);
    const header = screen.getByRole("button");
    fireEvent.click(header);
    await waitFor(() => {
      expect(screen.getByText("Client sent")).toBeTruthy();
      expect(screen.getByText("Server had")).toBeTruthy();
    });
  });

  it("shows resolve button for open conflict", async () => {
    render(<ConflictRow conflict={makeConflict()} />);
    fireEvent.click(screen.getByRole("button", { name: /open/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /mark resolved/i })).toBeTruthy();
    });
  });

  it("calls resolveSyncConflict with id and note on resolve", async () => {
    const { resolveSyncConflict } = await import("@/server/actions/sync-conflicts");
    vi.mocked(resolveSyncConflict).mockResolvedValue({
      ok: true,
      data: makeConflict({ status: "resolved", resolvedAt: "2026-06-16T09:00:00Z" }),
    });

    const onResolved = vi.fn();
    render(<ConflictRow conflict={makeConflict()} onResolved={onResolved} />);
    fireEvent.click(screen.getByRole("button", { name: /open/i }));

    await waitFor(() => screen.getByRole("button", { name: /mark resolved/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Wallet reconciled." } });
    fireEvent.click(screen.getByRole("button", { name: /mark resolved/i }));

    await waitFor(() => {
      expect(resolveSyncConflict).toHaveBeenCalledWith("cf-1", "Wallet reconciled.");
      expect(onResolved).toHaveBeenCalled();
    });
  });

  it("does not show resolve button for resolved conflict", async () => {
    render(
      <ConflictRow
        conflict={makeConflict({ status: "resolved", resolvedAt: "2026-06-16T09:00:00Z" })}
        readOnly
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /open/i }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /mark resolved/i })).toBeNull();
    });
  });
});

describe("SyncConflictsPage", () => {
  it("shows open list with conflicts", async () => {
    const { listSyncConflicts } = await import("@/server/actions/sync-conflicts");
    vi.mocked(listSyncConflicts).mockResolvedValue({
      ok: true,
      data: {
        open: [makeConflict()],
        resolvedThisWeek: [],
      },
    });

    await act(async () => {
      render(<SyncConflictsPage />);
    });

    await waitFor(() => {
      expect(screen.getByTestId("open-list")).toBeTruthy();
      expect(screen.getAllByTestId("conflict-row")).toHaveLength(1);
    });
  });

  it("moves conflict from open to resolved on resolve", async () => {
    const { listSyncConflicts, resolveSyncConflict } = await import(
      "@/server/actions/sync-conflicts"
    );
    vi.mocked(listSyncConflicts).mockResolvedValue({
      ok: true,
      data: {
        open: [makeConflict({ id: "cf-move" })],
        resolvedThisWeek: [],
      },
    });
    vi.mocked(resolveSyncConflict).mockResolvedValue({
      ok: true,
      data: makeConflict({
        id: "cf-move",
        status: "resolved",
        resolvedAt: "2026-06-16T10:00:00Z",
      }),
    });

    await act(async () => {
      render(<SyncConflictsPage />);
    });

    await waitFor(() => screen.getByTestId("open-list"));
    fireEvent.click(screen.getByRole("button", { name: /open/i }));

    await waitFor(() => screen.getByRole("button", { name: /mark resolved/i }));
    fireEvent.click(screen.getByRole("button", { name: /mark resolved/i }));

    await waitFor(() => {
      // Open list should be empty
      expect(screen.getByText(/Open \(0\)/i)).toBeTruthy();
      // Resolved list should appear
      expect(screen.getByTestId("resolved-list")).toBeTruthy();
    });
  });
});
