"use server";

// REQ-061 / PRD §9.5.1, L36 — the till's two ways back to the PIN screen
// besides the 12-hour ceiling (which lives in the Auth.js config, untouched here).
//
//   hand_over  — the explicit *Hand over* control: ends this barista's session
//                and returns to the PIN screen without touching orders in
//                flight. Allowed at any time, inside an opening window or not.
//   idle_lock  — 5 minutes of no interaction OUTSIDE an opening window. Inside
//                one there is no idle timeout (L36), and the server re-checks
//                that here: while a session is open and trading it refuses and
//                nobody is signed out.
//
// Neither touches an order, a payment or the queue: the only writes are one
// audit_log row (who, which way) and ending the Auth.js session. The draft
// order in progress lives in the browser and is kept by the POS (REQ-061:
// "with all work preserved").

import { writeAudit } from "@/server/audit";
import { authorize } from "@/server/auth/guard";
import { getOpeningStep } from "@/server/actions/opening";
import { signOut as nextSignOut } from "../../../auth";
import type { ActionResult } from "@/lib/types";

const POS_ROLES = ["barista", "admin"] as const;

export type TillLockReason = "hand_over" | "idle_lock";

export async function endTillSession(reason: TillLockReason): Promise<ActionResult> {
  if (reason !== "hand_over" && reason !== "idle_lock") {
    return { ok: false, code: "VALIDATION", message: "Unknown reason." };
  }
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;

  if (reason === "idle_lock") {
    // L36: never auto-signed-out during trading hours. If the window cannot be
    // read, do not lock — a lockout mid-rush is the worse outcome.
    const step = await getOpeningStep();
    if (!step.ok) return { ok: false, code: "WINDOW_UNKNOWN", message: "Could not read the opening window." };
    if (step.data.current !== null) {
      return { ok: false, code: "IN_OPENING_WINDOW", message: "The till does not idle-lock during an opening window." };
    }
  }

  await writeAudit({
    entityKind: "staff",
    entityId: auth.session.id,
    action: reason,
    actorId: auth.session.id,
    actorRole: auth.session.role,
  });
  await nextSignOut({ redirect: false });
  return { ok: true, data: undefined };
}
