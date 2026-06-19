"use server";

// Customer email + password auth — register, login, logout via Supabase Auth.
// Supabase handles password hashing, session cookies, and password-reset emails.
// Intentionally separate from the staff Auth.js/PIN flow.

import { and, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { customers } from "@db/schema";
import { writeAudit } from "@/server/audit";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/server/rate-limit";
import type { ActionResult } from "@/lib/types";

const TENANT_ID = "hofmi-favo";

// SEC-4 rate limits
const AUTH_LIMIT = 5;           // attempts per window
const AUTH_WINDOW_MS = 60_000;  // 1 minute
const RESET_LIMIT = 3;          // requests per window
const RESET_WINDOW_MS = 60 * 60_000; // 1 hour

async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anonymous";
  } catch {
    return "anonymous";
  }
}

// ── Validation helpers ────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(email: string): string | null {
  const e = email.trim().toLowerCase();
  return EMAIL_RE.test(e) ? e : null;
}

function validatePassword(password: string): string | null {
  return password.length >= 8 ? password : null;
}

function validatePhone(phone: string): string | null {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15 ? trimmed : null;
}

// ── Register ──────────────────────────────────────────────────────────────────

export async function registerCustomer(input: {
  name: string;
  email: string;
  password: string;
  phone?: string;
}): Promise<ActionResult<{ customerId: string; name: string; verificationSent: boolean }>> {
  const ip = await clientIp();
  const rl = checkRateLimit(`register:${ip}`, AUTH_LIMIT, AUTH_WINDOW_MS);
  if (!rl.allowed) {
    return { ok: false, code: "RATE_LIMITED", message: `Too many attempts. Try again in ${rl.retryAfterSecs}s.` };
  }

  const name = input.name.trim();
  const email = validateEmail(input.email);
  const password = validatePassword(input.password);

  if (name.length < 2) {
    return { ok: false, code: "VALIDATION", message: "Please enter your full name." };
  }
  if (!email) {
    return { ok: false, code: "VALIDATION", message: "Please enter a valid email address." };
  }
  if (!password) {
    return { ok: false, code: "VALIDATION", message: "Password must be at least 8 characters." };
  }

  let phone: string | undefined;
  if (input.phone !== undefined && input.phone.trim() !== "") {
    const validated = validatePhone(input.phone);
    if (!validated) {
      return { ok: false, code: "VALIDATION", message: "Please enter a valid phone number." };
    }
    phone = validated;
  }

  // Phone uniqueness — same number already belongs to another customer.
  // Exception: legacy row with same email + null auth_id is allowed through (re-link path below).
  if (phone) {
    const [byPhone] = await db
      .select({ id: customers.id, email: customers.email, authId: customers.authId })
      .from(customers)
      .where(eq(customers.phone, phone));
    const isLegacySameEmail = byPhone?.email === email && byPhone?.authId === null;
    if (byPhone && !isLegacySameEmail) {
      return {
        ok: false,
        code: "PHONE_TAKEN",
        message: "That mobile number is already linked to a FAVO account. Try signing in, or use a different number.",
      };
    }
  }

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name, phone } },
  });

  if (error) {
    if (
      error.message.toLowerCase().includes("already registered") ||
      error.message.toLowerCase().includes("already exists")
    ) {
      return {
        ok: false,
        code: "EMAIL_TAKEN",
        message: "An account with that email already exists. Try signing in.",
      };
    }
    return { ok: false, code: "AUTH_ERROR", message: error.message };
  }

  const user = data.user;
  if (!user) {
    return { ok: false, code: "AUTH_ERROR", message: "Could not create your account. Please try again." };
  }

  // Check for a pre-migration customers row (email present, auth_id not yet linked)
  const [existingRow] = await db
    .select({ id: customers.id, name: customers.name, authId: customers.authId })
    .from(customers)
    .where(and(eq(customers.email, email), isNull(customers.authId)));

  let customer: { id: string; name: string } | undefined;

  if (existingRow) {
    // Migrate legacy row — link the new Supabase user without creating a duplicate
    const [updated] = await db
      .update(customers)
      .set({ authId: user.id, name, phone })
      .where(eq(customers.id, existingRow.id))
      .returning({ id: customers.id, name: customers.name });
    customer = updated;
  } else {
    const [inserted] = await db
      .insert(customers)
      .values({ tenantId: TENANT_ID, name, email, phone, authId: user.id })
      .returning({ id: customers.id, name: customers.name });
    customer = inserted;
  }

  if (!customer) {
    await supabase.auth.admin?.deleteUser(user.id).catch(() => null);
    return { ok: false, code: "DB_ERROR", message: "Could not create your account. Please try again." };
  }

  await writeAudit({
    actorId: customer.id,
    actorRole: "customer",
    action: "customer.register",
    entityKind: "customers",
    entityId: customer.id,
    after: { email },
  });

  // data.session is null when Supabase email confirmation is enabled
  return {
    ok: true,
    data: { customerId: customer.id, name: customer.name, verificationSent: !data.session },
  };
}

// ── Login ─────────────────────────────────────────────────────────────────────

export async function loginCustomer(input: {
  email: string;
  password: string;
}): Promise<ActionResult<{ customerId: string; name: string }>> {
  const ip = await clientIp();
  const rl = checkRateLimit(`login:${ip}`, AUTH_LIMIT, AUTH_WINDOW_MS);
  if (!rl.allowed) {
    return { ok: false, code: "RATE_LIMITED", message: `Too many attempts. Try again in ${rl.retryAfterSecs}s.` };
  }

  const email = validateEmail(input.email);

  if (!email) {
    return { ok: false, code: "VALIDATION", message: "Please enter a valid email address." };
  }
  if (!input.password) {
    return { ok: false, code: "VALIDATION", message: "Please enter your password." };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithPassword({ email, password: input.password });

  if (error) {
    if (error.message.toLowerCase().includes("email not confirmed")) {
      return {
        ok: false,
        code: "EMAIL_NOT_VERIFIED",
        message: "Please verify your email before signing in. Check your inbox for the confirmation link.",
      };
    }
    return { ok: false, code: "INVALID_CREDENTIALS", message: "Incorrect email or password." };
  }

  if (!data.user) {
    return { ok: false, code: "INVALID_CREDENTIALS", message: "Incorrect email or password." };
  }

  const [customer] = await db
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(eq(customers.authId, data.user.id));

  if (!customer) {
    return { ok: false, code: "INVALID_CREDENTIALS", message: "Incorrect email or password." };
  }

  await writeAudit({
    actorId: customer.id,
    actorRole: "customer",
    action: "customer.login",
    entityKind: "customers",
    entityId: customer.id,
    after: { email },
  });

  return { ok: true, data: { customerId: customer.id, name: customer.name } };
}

// ── Logout ────────────────────────────────────────────────────────────────────

export async function logoutCustomer(): Promise<ActionResult<null>> {
  const supabase = await createClient();

  // Capture current user before session is invalidated
  const { data: { user } } = await supabase.auth.getUser();

  // Revoke all sessions for this user across all devices (SEC-1)
  await supabase.auth.signOut({ scope: "global" });

  if (user) {
    const [customer] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.authId, user.id));
    if (customer) {
      await writeAudit({
        actorId: customer.id,
        actorRole: "customer",
        action: "customer.logout",
        entityKind: "customers",
        entityId: customer.id,
      });
    }
  }

  return { ok: true, data: null };
}

// ── Forgot password ───────────────────────────────────────────────────────────

export async function requestPasswordReset(
  email: string
): Promise<ActionResult<null>> {
  const validated = validateEmail(email);
  if (!validated) {
    return { ok: false, code: "VALIDATION", message: "Please enter a valid email address." };
  }

  const rl = checkRateLimit(`reset:${validated}`, RESET_LIMIT, RESET_WINDOW_MS);
  if (!rl.allowed) {
    // Return ok to avoid leaking that the email exists or that the limit was hit.
    // Suppressing the send silently is safer than 429-ing here (no-leak rule).
    return { ok: true, data: null };
  }

  const supabase = await createClient();
  // No-leak: always return ok regardless of whether the email exists
  await supabase.auth.resetPasswordForEmail(validated, {
    redirectTo: `${process.env.PUBLIC_BASE_URL}/reset-password`,
  });

  return { ok: true, data: null };
}

// ── Reset password (SEC-3) ────────────────────────────────────────────────────
//
// Called from the /reset-password page after the client-side Supabase SDK has
// parsed the PASSWORD_RECOVERY event from the email link and set auth cookies.
// The server-side client reads those cookies and calls updateUser server-side.

export async function resetPassword(
  newPassword: string
): Promise<ActionResult<null>> {
  if (!newPassword || newPassword.length < 8) {
    return { ok: false, code: "VALIDATION", message: "Password must be at least 8 characters." };
  }

  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      ok: false,
      code: "UNAUTHORIZED",
      message: "Your reset link has expired or is invalid. Please request a new one.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    return { ok: false, code: "AUTH_ERROR", message: error.message };
  }

  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.authId, user.id));

  if (customer) {
    await writeAudit({
      actorId: customer.id,
      actorRole: "customer",
      action: "customer.password_reset",
      entityKind: "customers",
      entityId: customer.id,
    });
  }

  return { ok: true, data: null };
}

// ── Resend verification email ─────────────────────────────────────────────────

export async function resendVerificationEmail(
  email: string
): Promise<ActionResult<null>> {
  const validated = validateEmail(email);
  if (!validated) {
    return { ok: false, code: "VALIDATION", message: "Please enter a valid email address." };
  }

  const supabase = await createClient();
  // No-leak: always return ok
  await supabase.auth.resend({ type: "signup", email: validated });

  return { ok: true, data: null };
}
