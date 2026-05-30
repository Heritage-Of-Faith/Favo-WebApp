// Action authorization guard — returns a tagged-union result instead of throwing,
// so server actions never leak exceptions across the client boundary (API.md
// convention: every action returns `{ ok: true, data } | { ok: false, code, message }`).

import { requireRole } from "@/lib/auth/session";
import type { SessionUser, StaffRole } from "@/lib/types";

export type AuthResult =
  | { ok: true; session: SessionUser }
  | { ok: false; code: "UNAUTHORIZED" | "FORBIDDEN"; message: string };

/**
 * Resolve the current session and assert it holds one of `roles`.
 * On failure returns a structured result (never throws) that an action can
 * return directly.
 */
export async function authorize(...roles: StaffRole[]): Promise<AuthResult> {
  try {
    const session = await requireRole(...roles);
    return { ok: true, session };
  } catch (err) {
    const code =
      err instanceof Error && err.message === "UNAUTHORIZED"
        ? "UNAUTHORIZED"
        : "FORBIDDEN";
    return {
      ok: false,
      code,
      message:
        code === "UNAUTHORIZED"
          ? "You must be signed in."
          : "You do not have permission to do that.",
    };
  }
}
