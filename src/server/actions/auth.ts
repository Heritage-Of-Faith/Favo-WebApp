"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { staff } from "@db/schema";
import { writeAudit } from "@/server/audit";
import { isValidPinFormat, verifyPin } from "@/server/auth/pin";
import {
  clearAttempts,
  cooldownSecsLeft,
  countRecent,
  noteAttempt,
  startCooldown,
  timing,
} from "@/server/auth/attempts";
import { clientKey } from "@/server/client-ip";
import { alertAdmins } from "@/server/push/admin-alert";
import { signIn, signOut as nextSignOut } from "../../../auth";
import { mintLoginAttestation } from "../../../auth";
import type { ActionResult, StaffRole } from "@/lib/types";

// Docs: docs/API.md → loginWithPin · Bcrypt-compare against staff.pin_hash.
// Audit row in BOTH branches (success and failure). Never log/echo the raw PIN.

const pinSchema = z.string().regex(/^\d{4,6}$/, "PIN must be 4–6 digits");

// PRD §9.5.3 / REQ-062 / L36: the barista till session is NEVER rate-limited.
// No attempt here is ever refused for volume. Failed PINs only slow the next
// attempt down — 250 ms per recent failure from this client, or across all
// clients if that is higher, capped at 3 s. A delay never refuses and never
// touches a session that is already signed in.
const FAIL_WINDOW_MS = 15 * 60_000;
const DELAY_STEP_MS = 250;
const DELAY_CAP_MS = 3_000;
const GLOBAL_FAIL_KEY = "pin-fail:global";

// PRD §9.5.3 Admin PIN: 5 attempts → a 5-minute cooldown and an immediate
// Admin alert. A PIN-only login has no identity until a PIN matches, so the
// "attempts" are the failed PINs since the last admin cooldown; the cooldown
// applies when the PIN that matches is an admin's, so a correct admin PIN is
// not the way past a flood. Baristas are never affected.
const ADMIN_FAIL_KEY = "pin-fail:admin-budget";
const ADMIN_FAIL_LIMIT = 5;
const ADMIN_COOLDOWN_KEY = "pin-admin-cooldown";
const ADMIN_COOLDOWN_MS = 5 * 60_000;

// The one answer for any PIN that does not sign in — wrong, unknown, or an
// admin PIN refused by the cooldown.
const INCORRECT_PIN = { ok: false, code: "INVALID_CREDENTIALS", message: "Incorrect PIN." } as const;

/** PRD §9.5.3: every breach writes action='reject' with a reason — never the attempted value. Outside any transaction. */
async function auditReject(reason: string): Promise<void> {
  await writeAudit({ entityKind: "staff", entityId: "unknown", action: "reject", reason });
}

/**
 * Authenticate a staff member by PIN. Returns the matched staff id on success.
 * Looks up active staff and bcrypt-compares — no PIN is ever logged or echoed.
 */
export async function loginWithPin(
  pin: string
): Promise<ActionResult<{ staffId: string; name: string; role: StaffRole }>> {
  const parsed = pinSchema.safeParse(pin);
  if (!parsed.success || !isValidPinFormat(pin)) {
    return { ok: false, code: "INVALID_PIN_FORMAT", message: "PIN must be 4–6 digits." };
  }

  const clientFailKey = `pin-fail:${await clientKey()}`;
  const recentFailures = Math.max(
    countRecent(clientFailKey, FAIL_WINDOW_MS),
    countRecent(GLOBAL_FAIL_KEY, FAIL_WINDOW_MS)
  );
  const delayMs = Math.min(DELAY_CAP_MS, DELAY_STEP_MS * recentFailures);
  if (delayMs > 0) {
    if (delayMs >= DELAY_CAP_MS) {
      await auditReject(
        `Till PIN login slowed by ${delayMs} ms after ${recentFailures} failed attempts in 15 min (delayed, not refused)`
      );
    }
    await timing.sleep(delayMs);
  }

  // Find the active staff member whose stored hash matches this PIN.
  const activeStaff = await db.select().from(staff).where(eq(staff.active, true));
  let matched: { id: string; name: string; role: string } | null = null;
  for (const s of activeStaff) {
    if (await verifyPin(pin, s.pinHash)) {
      matched = { id: s.id, name: s.name, role: s.role };
      break;
    }
  }

  if (!matched) {
    noteAttempt(clientFailKey, FAIL_WINDOW_MS);
    noteAttempt(GLOBAL_FAIL_KEY, FAIL_WINDOW_MS);
    noteAttempt(ADMIN_FAIL_KEY, FAIL_WINDOW_MS);
    // Failed attempt — audit without ever recording the attempted PIN.
    await writeAudit({
      entityKind: "staff",
      entityId: "unknown",
      action: "login_failed",
      reason: "No active staff matched the supplied PIN",
    });
    return { ...INCORRECT_PIN };
  }

  if (matched.role === "admin") {
    // A refused admin PIN must look exactly like a wrong PIN — same result,
    // same counters, one audit insert — or the answer would reveal that the
    // PIN was a correct admin one. It is still refused and audited.
    const refuseAsWrongPin = async (reason: string) => {
      noteAttempt(clientFailKey, FAIL_WINDOW_MS);
      noteAttempt(GLOBAL_FAIL_KEY, FAIL_WINDOW_MS);
      noteAttempt(ADMIN_FAIL_KEY, FAIL_WINDOW_MS);
      await auditReject(reason);
      return { ...INCORRECT_PIN };
    };
    const left = cooldownSecsLeft(ADMIN_COOLDOWN_KEY);
    if (left > 0) {
      return refuseAsWrongPin(`Admin PIN refused: cooldown running (${left}s left)`);
    }
    const failures = countRecent(ADMIN_FAIL_KEY, FAIL_WINDOW_MS);
    if (failures >= ADMIN_FAIL_LIMIT) {
      startCooldown(ADMIN_COOLDOWN_KEY, ADMIN_COOLDOWN_MS);
      clearAttempts(ADMIN_FAIL_KEY); // the counter resets after the cooldown
      void alertAdmins(
        "Admin PIN cooldown",
        `${failures} failed PIN attempts at the till. Admin sign-in is paused for 5 minutes. Baristas are not affected.`,
        { failures }
      );
      return refuseAsWrongPin(`Admin PIN cooldown started: ${failures} failed PIN attempts; 5-minute cooldown`);
    }
  }

  // Mint a short-lived HMAC attestation token so Auth.js can take the fast
  // path (single primary-key lookup) without re-running bcrypt.
  const attestation = mintLoginAttestation(matched.id);

  // Establish the Auth.js session. If signIn throws (e.g. AuthError when
  // the authorize callback returns null), map it to a structured error — server
  // actions must never throw across the client boundary.
  try {
    await signIn("credentials", { attestation, redirect: false });
  } catch (err) {
    // AuthError or unexpected failure — session was NOT created.
    const message = err instanceof Error ? err.message : "Sign-in failed.";
    return { ok: false, code: "AUTH_ERROR", message };
  }

  // Audit only after the session is confirmed — prevents a login_success row
  // for a session that was never actually created.
  await writeAudit({
    entityKind: "staff",
    entityId: matched.id,
    action: "login_success",
    actorId: matched.id,
    actorRole: matched.role,
  });

  return {
    ok: true,
    data: { staffId: matched.id, name: matched.name, role: matched.role as StaffRole },
  };
}

export async function signOut(): Promise<ActionResult> {
  await nextSignOut({ redirect: false });
  return { ok: true, data: undefined };
}

