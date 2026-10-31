// QA R6 security note: the audit page title read "Audit Log — FAVO Admin — FAVO
// Admin" because the page repeated the suffix the admin layout's template adds.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/components/admin/AuditViewer", () => ({ default: () => null }));
vi.mock("@/server/actions/audit", () => ({ listAudit: vi.fn(), listAuditEntityKinds: vi.fn() }));

describe("admin audit page title", () => {
  it("is 'Audit Log' so the layout template yields 'Audit Log — FAVO Admin' once", async () => {
    const { metadata } = await import("@/app/admin/(dashboard)/audit/page");
    expect(metadata.title).toBe("Audit Log");
  });
});
