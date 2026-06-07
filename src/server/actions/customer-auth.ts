"use server";

// Customer email + password auth — register, login, logout.
// Uses bcryptjs (same dep as staff PIN hashing) and a signed cookie session.
// Intentionally separate from the staff Auth.js/PIN flow.

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers } from "@db/schema";
import { writeAudit } from "@/server/audit";
import { setCustomerSession, clearCustomerSession } from "@/server/auth/customer-session";
import type { ActionResult } from "@/lib/types";

const BCRYPT_ROUNDS = 12;
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

// ── Register ──────────────────────────────────────────────────────────────────

export async function registerCustomer(input: {
  name: string;
  email: string;
  password: string;
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

  // Check for existing account
  const [existing] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.email, email));

  if (existing) {
    return { ok: false, code: "EMAIL_TAKEN", message: "An account with that email already exists." };
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const [customer] = await db
    .insert(customers)
    .values({ tenantId: TENANT_ID, name, email, passwordHash })
    .returning({ id: customers.id, name: customers.name });

  if (!customer) {
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

  await setCustomerSession(customer.id);

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

  const [customer] = await db
    .select({ id: customers.id, name: customers.name, passwordHash: customers.passwordHash })
    .from(customers)
    .where(eq(customers.email, email));

  // Generic error — don't reveal whether the email exists
  const WRONG = { ok: false as const, code: "INVALID_CREDENTIALS", message: "Incorrect email or password." };

  if (!customer || !customer.passwordHash) return WRONG;

  const match = await bcrypt.compare(input.password, customer.passwordHash);
  if (!match) return WRONG;

  await setCustomerSession(customer.id);

  return { ok: true, data: { customerId: customer.id, name: customer.name } };
}

// ── Logout ────────────────────────────────────────────────────────────────────

export async function logoutCustomer(): Promise<ActionResult<null>> {
  await clearCustomerSession();
  return { ok: true, data: null };
}
