// AT-214 / REQ-142: admin customer list shows given name + surname, status, masked phone; never email.
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@/server/actions/customers", () => ({
  listCustomers: vi.fn().mockResolvedValue({
    ok: true,
    data: [
      { id: "c1", name: "Thandi", surname: "Nkosi", status: "office_staff", phoneLast4: "4567", createdAt: "2026-06-01T08:00:00+02:00" },
      { id: "c2", name: "Thandi", surname: "Dlamini", status: "church_member", phoneLast4: null, createdAt: "2026-06-02T08:00:00+02:00" },
    ],
  }),
}));

import CustomerTable from "@/components/admin/CustomerTable";

describe("CustomerTable", () => {
  it("renders surname, status and masked phone, with no email column", async () => {
    render(<CustomerTable />);
    await waitFor(() => expect(screen.getByText("Thandi Nkosi")).toBeInTheDocument());
    expect(screen.getByText("Thandi Dlamini")).toBeInTheDocument();
    expect(screen.getByText("Office staff")).toBeInTheDocument();
    expect(screen.getByText("Church member")).toBeInTheDocument();
    expect(screen.getByText("•••• 4567")).toBeInTheDocument();
    expect(screen.queryByText(/email/i, { selector: "th" })).toBeNull();
  });
});
