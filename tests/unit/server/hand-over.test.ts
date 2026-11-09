// @vitest-environment node
// REQ-061 / PRD §9.5.1, L36: *Hand over* ends the barista's session (audited)
// at any time; the 5-minute idle lock applies only OUTSIDE an opening window —
// inside one there is no idle timeout, and the server refuses to sign anyone out.
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuthorize = vi.fn();
vi.mock("@/server/auth/guard", () => ({ authorize: (...a: unknown[]) => mockAuthorize(...a) }));
const mockStep = vi.fn();
vi.mock("@/server/actions/opening", () => ({ getOpeningStep: () => mockStep() }));
vi.mock("@/server/audit", () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../../auth", () => ({ signOut: vi.fn().mockResolvedValue(undefined) }));

import { endTillSession } from "@/server/actions/hand-over";
import { writeAudit } from "@/server/audit";
import { signOut } from "../../../auth";

const LOUIS = { id: "staff-louis", role: "barista", name: "Louis" };
const openWindow = { ok: true, data: { date: "2026-11-08", current: { id: "sess-1" }, sessions: [], windows: [], profiles: [] } };
const noWindow = { ok: true, data: { date: "2026-11-09", current: null, sessions: [], windows: [], profiles: [] } };

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthorize.mockResolvedValue({ ok: true, session: LOUIS });
});

describe("Hand over", () => {
  it("ends the session and audits who handed over, inside an opening window too", async () => {
    mockStep.mockResolvedValue(openWindow);
    const r = await endTillSession("hand_over");
    expect(r.ok).toBe(true);
    expect(writeAudit).toHaveBeenCalledWith({
      entityKind: "staff", entityId: "staff-louis", action: "hand_over", actorId: "staff-louis", actorRole: "barista",
    });
    expect(signOut).toHaveBeenCalledWith({ redirect: false });
  });

  it("is a POS action: no session, nothing written", async () => {
    mockAuthorize.mockResolvedValue({ ok: false, code: "UNAUTHORIZED", message: "You must be signed in." });
    const r = await endTillSession("hand_over");
    expect(r.ok).toBe(false);
    expect(writeAudit).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("refuses an unknown reason", async () => {
    const r = await endTillSession("logout" as never);
    expect(r).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe("5-minute idle lock", () => {
  it("outside an opening window: ends the session and audits the idle lock", async () => {
    mockStep.mockResolvedValue(noWindow);
    const r = await endTillSession("idle_lock");
    expect(r.ok).toBe(true);
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "idle_lock", actorId: "staff-louis" }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("inside an opening window there is no idle timeout: refused, nobody signed out (L36)", async () => {
    mockStep.mockResolvedValue(openWindow);
    const r = await endTillSession("idle_lock");
    expect(r).toMatchObject({ ok: false, code: "IN_OPENING_WINDOW" });
    expect(writeAudit).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("if the window cannot be read, the till stays signed in", async () => {
    mockStep.mockResolvedValue({ ok: false, code: "INTERNAL", message: "x" });
    const r = await endTillSession("idle_lock");
    expect(r.ok).toBe(false);
    expect(signOut).not.toHaveBeenCalled();
  });
});
