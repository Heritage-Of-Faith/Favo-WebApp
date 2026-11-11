// AT-209 — the single-action admin PIN override (PRD §6.0.7 T6, §10.7 "PIN",
// §9.5.3, REQ-040, REQ-059, REQ-063).
//
//   - It only CHECKS a PIN against the active admins' bcrypt hashes and returns
//     which admin it was. It never signs anyone in: no admin session exists
//     afterwards and the barista's session is not touched (REQ-063). The caller
//     records the admin on audit_log.on_behalf_of_staff_id.
//   - §9.5.3: "Admin PIN | 5 attempts | A 5-minute cooldown and an immediate
//     Admin alert". Five failed attempts start the cooldown; during it no PIN
//     is checked at all. A correct PIN clears the failure count.
//   - The PIN is never logged, echoed, returned or audited (§9.5.3, §11.4).
//     Callers audit the refusal with its code only.
//   - The barista till session itself is never rate-limited (L36) — this
//     counter guards only the override.
//
// Like src/server/rate-limit.ts, state is in-process (single tenant, one
// server). The key is global, not per barista: one counter for the one till.

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { staff } from "@db/schema";
import { isValidPinFormat, verifyPin } from "@/server/auth/pin";
import { alertAdmins } from "@/server/push/admin-alert";

export const ADMIN_PIN_MAX_FAILURES = 5;
export const ADMIN_PIN_COOLDOWN_MS = 5 * 60_000;

export type AdminPinRefusalCode = "INVALID_PIN_FORMAT" | "INVALID_CREDENTIALS" | "RATE_LIMITED";

export type AdminPinResult =
  | { ok: true; adminStaffId: string }
  | { ok: false; code: AdminPinRefusalCode; message: string };

const COPY: Record<AdminPinRefusalCode, string> = {
  INVALID_PIN_FORMAT: "PIN must be 4–6 digits.",
  INVALID_CREDENTIALS: "That is not an admin PIN.",
  RATE_LIMITED: "Too many wrong admin PINs. Try again in 5 minutes.",
};

let failures = 0;
let lockedUntil = 0;

/** Exposed only for unit tests — do not call in production code. */
export function _resetAdminPinForTest(): void {
  failures = 0;
  lockedUntil = 0;
}

/**
 * Check an admin PIN for a single override. `requestedBy` names the barista in
 * the cooldown alert; it is never used to sign anyone in.
 */
export async function verifyAdminPin(
  pin: string,
  requestedBy: { id: string; name?: string },
  now: number = Date.now()
): Promise<AdminPinResult> {
  // Everything up to the reservation below is synchronous (no await), so N
  // parallel guesses cannot all pass this check: each reserves its attempt
  // before any bcrypt runs, and only the first five are ever checked.
  if (now < lockedUntil) return { ok: false, code: "RATE_LIMITED", message: COPY.RATE_LIMITED };
  if (lockedUntil !== 0) {
    // The cooldown has run out: the counter starts again.
    lockedUntil = 0;
    failures = 0;
  }
  if (failures >= ADMIN_PIN_MAX_FAILURES) {
    // Five attempts are already counted (some may still be in flight).
    return { ok: false, code: "RATE_LIMITED", message: COPY.RATE_LIMITED };
  }
  failures += 1; // reserved: counted as a failure unless it succeeds

  if (typeof pin !== "string" || !isValidPinFormat(pin)) {
    return fail("INVALID_PIN_FORMAT", requestedBy, now);
  }

  const admins = await db
    .select({ id: staff.id, pinHash: staff.pinHash })
    .from(staff)
    .where(and(eq(staff.active, true), eq(staff.role, "admin")));
  for (const a of admins) {
    if (await verifyPin(pin, a.pinHash)) {
      // Success releases the reservation and clears the count.
      failures = 0;
      return { ok: true, adminStaffId: a.id };
    }
  }
  return fail("INVALID_CREDENTIALS", requestedBy, now);
}

/** The attempt was already counted when it was reserved. */
function fail(code: AdminPinRefusalCode, requestedBy: { id: string; name?: string }, now: number): AdminPinResult {
  if (failures >= ADMIN_PIN_MAX_FAILURES && lockedUntil === 0) {
    lockedUntil = now + ADMIN_PIN_COOLDOWN_MS;
    // §9.5.3: "an immediate Admin alert". Never throws.
    void alertAdmins(
      "Admin PIN locked for 5 minutes",
      `${ADMIN_PIN_MAX_FAILURES} wrong admin PINs in a row at the till (${requestedBy.name ?? requestedBy.id}).`,
      { kind: "admin_pin_cooldown", requestedByStaffId: requestedBy.id }
    );
  }
  return { ok: false, code, message: COPY[code] };
}
