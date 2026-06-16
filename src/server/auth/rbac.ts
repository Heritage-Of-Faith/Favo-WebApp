import type { StaffRole } from "@/lib/types";

const RANK: Record<StaffRole, number> = {
  barista: 1,
  admin: 2,
};

export function roleAtLeast(role: StaffRole, min: StaffRole): boolean {
  return RANK[role] >= RANK[min];
}

export function hasRole(role: StaffRole, allowed: readonly StaffRole[]): boolean {
  return allowed.includes(role);
}

export function canAccessAdmin(role: StaffRole): boolean {
  return role === "admin";
}

export function canProcessOrders(role: StaffRole): boolean {
  return true; // both barista and admin can process orders
}

export function canApproveRefund(role: StaffRole): boolean {
  return role === "admin";
}
