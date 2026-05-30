// Role-based access control — task G4
// Single source of truth for staff-role privilege. Used by proxy.ts (route gating),
// requireRole (server actions), and admin UI guards. UI checks are advisory; these
// server-side checks are authoritative (universal invariant: RBAC enforced server-side).

import type { StaffRole } from "@/lib/types";

// Operational privilege rank. Higher = more management authority.
// `finance` is read-only-financial but sits at admin level for *route* access
// (it can reach the admin surface; write-level checks are enforced per-action).
const RANK: Record<StaffRole, number> = {
  barista: 1,
  roaster: 1,
  manager: 2,
  finance: 3,
  admin: 3,
  owner: 4,
};

/** True if `role` ranks at or above `min` in the operational hierarchy. */
export function roleAtLeast(role: StaffRole, min: StaffRole): boolean {
  return RANK[role] >= RANK[min];
}

/** True if `role` is one of the explicitly allowed roles. */
export function hasRole(role: StaffRole, allowed: readonly StaffRole[]): boolean {
  return allowed.includes(role);
}

/** Roles permitted to reach the /admin surface. */
export function canAccessAdmin(role: StaffRole): boolean {
  return role === "admin" || role === "owner" || role === "finance";
}

/** Roles permitted to operate the POS (create/transition orders). */
export function canProcessOrders(role: StaffRole): boolean {
  return hasRole(role, ["barista", "manager", "admin", "owner"]);
}

/** Roles permitted to approve refunds (business rule L02 — admin/owner only). */
export function canApproveRefund(role: StaffRole): boolean {
  return role === "admin" || role === "owner";
}
