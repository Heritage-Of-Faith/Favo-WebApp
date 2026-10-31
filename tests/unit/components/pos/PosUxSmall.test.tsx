// QA round 1: waste dialog validation, opening prompt empty time, container confirm, 404 link.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

const mockLogWaste = vi.fn();
vi.mock("@/server/actions/waste", () => ({ logWaste: (...a: unknown[]) => mockLogWaste(...a) }));
vi.mock("@/server/actions/inventory", () => ({
  listInventory: vi.fn().mockResolvedValue({ ok: true, data: { items: [{ id: "inv1", name: "Whole Milk", unit: "ml" }] } }),
  // CHANGED (QA R5 barista #2): an item with no lots now disables Log Waste
  // ("No stock to waste"), so the quantity checks need one sealed lot.
  listLots: vi.fn().mockResolvedValue({
    ok: true,
    data: { lots: [{ id: "lot_m1", inventoryItemId: "inv1", batchNumber: "MLK-1", state: "active", quantityRemaining: 5000 }] },
  }),
}));
// CHANGED (merge of AT-204): the prompt now loads getOpeningStep and opens via openSession.
const mockSubmit = vi.fn();
vi.mock("@/server/actions/opening", () => ({
  getOpeningStep: vi.fn().mockResolvedValue({
    ok: true, data: { date: "2026-10-26", current: null, sessions: [], windows: [], profiles: [] },
  }),
  openSession: (...a: unknown[]) => mockSubmit(...a),
  closeSession: vi.fn(),
  openEventWindow: vi.fn(),
}));
const mockOpen = vi.fn();
const mockClose = vi.fn();
vi.mock("@/server/actions/containers", () => ({
  listOpenContainers: vi.fn().mockResolvedValue({
    ok: true,
    data: { containers: [{ inventoryItemId: "i1", inventoryItemName: "Almond Milk", openLotId: "lot1", openLabel: "NAT-001", sealedCount: 2 }] },
  }),
  openContainer: (...a: unknown[]) => mockOpen(...a),
  closeContainer: (...a: unknown[]) => mockClose(...a),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() } }));

import WasteDialog from "@/components/pos/WasteDialog";
import OpeningTimePrompt from "@/components/pos/OpeningTimePrompt";
import OpenContainersCard from "@/components/pos/OpenContainersCard";
import { notFoundTarget } from "@/app/NotFoundLink";

beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); });

describe("WasteDialog quantity", () => {
  it.each(["0", "-1", "1.5", "99999999"])("shows a visible message for %s and logs nothing", async (value) => {
    render(<WasteDialog onClose={vi.fn()} />);
    const qty = await screen.findByLabelText(/quantity/i);
    fireEvent.change(qty, { target: { value } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /log waste/i })); });
    expect((await screen.findByRole("alert")).textContent).toMatch(/quantity/i);
    expect(mockLogWaste).not.toHaveBeenCalled();
  });
  it("has an item picker", async () => {
    render(<WasteDialog onClose={vi.fn()} />);
    expect(await screen.findByLabelText(/^item$/i)).toBeDefined();
  });
});

describe("OpeningTimePrompt", () => {
  it("shows an error for an empty time instead of doing nothing", async () => {
    render(<OpeningTimePrompt />);
    const input = await screen.findByLabelText(/^opening time$/i);
    fireEvent.change(input, { target: { value: "" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /confirm/i })); });
    expect((await screen.findByRole("alert")).textContent).toMatch(/enter the time/i);
    expect(mockSubmit).not.toHaveBeenCalled();
  });
});

describe("OpenContainersCard", () => {
  it("names the product and asks before closing", async () => {
    mockClose.mockResolvedValue({ ok: true });
    render(<OpenContainersCard />);
    expect(await screen.findByText("Almond Milk")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(mockClose).not.toHaveBeenCalled();
    expect(screen.getByText(/close almond milk\?/i)).toBeDefined();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^yes$/i })); });
    await waitFor(() => expect(mockClose).toHaveBeenCalledWith("lot1"));
  });
});

describe("404 link", () => {
  it("stays in the POS", () => {
    expect(notFoundTarget("/pos/nope").href).toBe("/pos/queue");
    expect(notFoundTarget("/pos").href).toBe("/pos/queue");
    expect(notFoundTarget("/menu/x").href).toBe("/");
  });
});

// Portrait iPad (820x1180): structure-only guards, no browser needed.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const pos = readFileSync(resolve(__dirname, "../../../../src/components/pos/POSWorkspace.tsx"), "utf8");
describe("POS portrait layout", () => {
  it("queue card shows full name and id (wraps, never truncates)", () => {
    const card = pos.slice(pos.indexOf("Card header"), pos.indexOf("Expanded content"));
    expect(card).not.toContain("truncate");
    expect(card).toContain("break-words");
  });
  it("shelf strip is not hidden below lg", () => {
    expect(pos).not.toMatch(/data-pos-strip[^>]*className="hidden/);
  });
  it("send button never wraps its label", () => {
    expect(pos).toMatch(/whitespace-nowrap rounded-\[4px\] px-4 py-2 min-h-\[44px\]/);
  });
});
