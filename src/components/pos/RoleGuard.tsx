"use client";

// Role guard — owner: Mine (M7)
// Client-side advisory check. Server-side RBAC is enforced by requireRole()
// in src/lib/auth/session.ts. This component just hides UI for forbidden roles.
// Never rely solely on this for security.

import type { StaffRole } from "@/lib/types";

export type Props = {
  /** Roles that are allowed to see the children */
  roles: StaffRole[];
  /** Current user's role (passed from server session via page props) */
  userRole: StaffRole;
  children: React.ReactNode;
  /** Optional fallback if role is insufficient — defaults to null */
  fallback?: React.ReactNode;
};

export default function RoleGuard({ roles, userRole, children, fallback = null }: Props) {
  if (!roles.includes(userRole)) {
    return <>{fallback}</>;
  }
  return <>{children}</>;
}
