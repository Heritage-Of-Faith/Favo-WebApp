import { auth as nextAuth } from "../../../auth";
import type { SessionUser, StaffRole } from "@/lib/types";

/**
 * Returns the current session user with role, or null if unauthenticated.
 * Always call server-side. RBAC is enforced here; UI checks are advisory only.
 */
export async function getSession(): Promise<SessionUser | null> {
  const session = await nextAuth();
  if (!session?.user?.id) return null;

  return {
    id: session.user.id,
    name: session.user.name ?? "Unknown",
    // TODO (G4): pull role from JWT token once auth is implemented
    role: (session.user as { role?: StaffRole }).role ?? "barista",
  };
}

/**
 * Throws if the session is missing or the role is not in the allowed list.
 * Use at the top of every protected server action.
 */
export async function requireRole(...roles: StaffRole[]): Promise<SessionUser> {
  const session = await getSession();
  if (!session) {
    throw new Error("UNAUTHORIZED");
  }
  if (!roles.includes(session.role)) {
    throw new Error("FORBIDDEN");
  }
  return session;
}
