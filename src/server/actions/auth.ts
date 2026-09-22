"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { staff } from "@db/schema";
import { writeAudit } from "@/server/audit";
import { isValidPinFormat, verifyPin } from "@/server/auth/pin";
import { checkRateLimit } from "@/server/rate-limit";
import { signIn, signOut as nextSignOut } from "../../../auth";
import { mintLoginAttestation } from "../../../auth";
import type { ActionResult, StaffRole } from "@/lib/types";

// Docs: docs/API.md → loginWithPin · Bcrypt-compare against staff.pin_hash.
// Audit row in BOTH branches (success and failure). Never log/echo the raw PIN.

const pinSchema = z.string().regex(/^\d{4,6}$/, "PIN must be 4–6 digits");

// SEC-4 rate limit — mirrors the customer-auth.ts login path.
const PIN_LOGIN_LIMIT = 5;           // attempts per window
const PIN_LOGIN_WINDOW_MS = 60_000;  // 1 minute

async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anonymous";
  } catch {
    return "anonymous";
  }
}

/**
 * Authenticate a staff member by PIN. Returns the matched staff id on success.
 * Looks up active staff and bcrypt-compares — no PIN is ever logged or echoed.
 */
export async function loginWithPin(
  pin: string
): Promise<ActionResult<{ staffId: string; name: string; role: StaffRole }>> {
  const ip = await clientIp();
  const rl = checkRateLimit(`pin-login:${ip}`, PIN_LOGIN_LIMIT, PIN_LOGIN_WINDOW_MS);
  if (!rl.allowed) {
    return { ok: false, code: "RATE_LIMITED", message: `Too many attempts. Try again in ${rl.retryAfterSecs}s.` };
  }

  const parsed = pinSchema.safeParse(pin);
  if (!parsed.success || !isValidPinFormat(pin)) {
    return { ok: false, code: "INVALID_PIN_FORMAT", message: "PIN must be 4–6 digits." };
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
    // Failed attempt — audit without ever recording the attempted PIN.
    await writeAudit({
      entityKind: "staff",
      entityId: "unknown",
      action: "login_failed",
      reason: "No active staff matched the supplied PIN",
    });
    return { ok: false, code: "INVALID_CREDENTIALS", message: "Incorrect PIN." };
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

