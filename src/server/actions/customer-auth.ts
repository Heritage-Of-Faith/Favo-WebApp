"use server";

// Customer email + password auth — register, login, logout via Supabase Auth.
// Supabase handles password hashing, session cookies, and password-reset emails.
// Intentionally separate from the staff Auth.js/PIN flow.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers } from "@db/schema";
import { writeAudit } from "@/server/audit";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

const TENANT_ID = "hofmi-favo";

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
}): Promise<ActionResult<{ customerId: string; name: string }>> {
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

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name, phone } },
  });

  if (error) {
    if (error.message.toLowerCase().includes("already registered") ||
        error.message.toLowerCase().includes("already exists")) {
      return { ok: false, code: "EMAIL_TAKEN", message: "An account with that email already exists." };
    }
    return { ok: false, code: "AUTH_ERROR", message: error.message };
  }

  const user = data.user;
  if (!user) {
    return { ok: false, code: "AUTH_ERROR", message: "Could not create your account. Please try again." };
  }

  // Insert the customers row, linking to the Supabase auth user via authId
  const [customer] = await db
    .insert(customers)
    .values({ tenantId: TENANT_ID, name, email, phone, authId: user.id })
    .returning({ id: customers.id, name: customers.name });

  if (!customer) {
    // Roll back Supabase user to avoid orphan auth entries
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

  return { ok: true, data: { customerId: customer.id, name: customer.name } };
}

// ── Login ─────────────────────────────────────────────────────────────────────

export async function loginCustomer(input: {
  email: string;
  password: string;
}): Promise<ActionResult<{ customerId: string; name: string }>> {
  const email = validateEmail(input.email);

  if (!email) {
    return { ok: false, code: "VALIDATION", message: "Please enter a valid email address." };
  }
  if (!input.password) {
    return { ok: false, code: "VALIDATION", message: "Please enter your password." };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithPassword({ email, password: input.password });

  if (error || !data.user) {
    return { ok: false, code: "INVALID_CREDENTIALS", message: "Incorrect email or password." };
  }

  const [customer] = await db
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(eq(customers.authId, data.user.id));

  if (!customer) {
    return { ok: false, code: "INVALID_CREDENTIALS", message: "Incorrect email or password." };
  }

  return { ok: true, data: { customerId: customer.id, name: customer.name } };
}

// ── Logout ────────────────────────────────────────────────────────────────────

export async function logoutCustomer(): Promise<ActionResult<null>> {
  const supabase = await createClient();
  await supabase.auth.signOut();
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

  const supabase = await createClient();
  // No-leak: always return ok regardless of whether the email exists
  await supabase.auth.resetPasswordForEmail(validated, {
    redirectTo: `${process.env.PUBLIC_BASE_URL}/reset-password`,
  });

  return { ok: true, data: null };
}
