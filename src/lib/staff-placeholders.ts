// ⚠️ PLACEHOLDER DATA — owner: Mia (task A4)
// ───────────────────────────────────────────────────────────────────────────
// Gian's staff Server Actions do not exist on `main` yet (CLAUDE.md lists
// listStaff / createStaff / setStaffPin / deactivateStaff as "not built yet").
// This module fakes them IN THE BROWSER so the A4 UI is fully reviewable now.
//
// These functions deliberately match the names, argument order, and the
// `ActionResult<T>` return shape that Gian's real actions will use, so wiring
// up the real backend later is a one-line import swap per call site:
//     import { listStaff, ... } from "@/lib/staff-placeholders";   ← delete
//     import { listStaff, ... } from "@/server/actions/staff";     ← use this
// …then delete this file. No component logic should need to change.
// ───────────────────────────────────────────────────────────────────────────

import type { ActionResult, Staff, StaffRole } from "@/lib/types";

// Seeded from db/seed/staff.ts so the placeholder mirrors real seed data.
let STAFF: Staff[] = [
  { id: "staff_barista_sam", name: "Sam Barista", role: "barista", active: true },
  { id: "staff_barista_thandi", name: "Thandi Barista", role: "barista", active: true },
  { id: "staff_manager_mia", name: "Mia Manager", role: "admin", active: true },
  { id: "staff_owner_olivia", name: "Olivia Owner", role: "owner", active: true },
];

// Simulate a little network latency so loading states are visible in review.
function delay<T>(value: T, ms = 250): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export type CreateStaffInput = {
  name: string;
  role: StaffRole;
  pin: string;
};

export async function listStaff(): Promise<ActionResult<Staff[]>> {
  return delay({ ok: true, data: [...STAFF] });
}

export async function createStaff(
  input: CreateStaffInput
): Promise<ActionResult<Staff>> {
  if (!input.name.trim()) {
    return delay({ ok: false, code: "VALIDATION", message: "Name is required." });
  }
  if (!/^\d{4,6}$/.test(input.pin)) {
    return delay({
      ok: false,
      code: "VALIDATION",
      message: "PIN must be 4–6 digits.",
    });
  }
  const created: Staff = {
    id: `staff_${input.name.toLowerCase().replace(/\s+/g, "_")}`,
    name: input.name.trim(),
    role: input.role,
    active: true,
  };
  STAFF = [...STAFF, created];
  return delay({ ok: true, data: created });
}

export async function setStaffPin(
  staffId: string,
  pin: string
): Promise<ActionResult> {
  if (!/^\d{4,6}$/.test(pin)) {
    return delay({
      ok: false,
      code: "VALIDATION",
      message: "PIN must be 4–6 digits.",
    });
  }
  const exists = STAFF.some((s) => s.id === staffId);
  if (!exists) {
    return delay({ ok: false, code: "NOT_FOUND", message: "Staff not found." });
  }
  // Real action hashes + stores; placeholder just acknowledges success.
  return delay({ ok: true, data: undefined });
}

export async function deactivateStaff(
  staffId: string
): Promise<ActionResult> {
  const target = STAFF.find((s) => s.id === staffId);
  if (!target) {
    return delay({ ok: false, code: "NOT_FOUND", message: "Staff not found." });
  }
  STAFF = STAFF.map((s) => (s.id === staffId ? { ...s, active: false } : s));
  return delay({ ok: true, data: undefined });
}
