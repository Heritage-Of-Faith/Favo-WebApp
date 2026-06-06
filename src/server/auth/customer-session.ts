// Customer session — lightweight signed-cookie, separate from staff Auth.js JWT.
// Keeps customer auth isolated from the staff PIN/attestation flow.

import { createHmac } from "crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "favo_customer_session";
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

function sign(customerId: string): string {
  const secret = process.env.AUTH_SECRET ?? "";
  return createHmac("sha256", secret).update(`customer:${customerId}`).digest("hex").slice(0, 32);
}

function encode(customerId: string): string {
  return `${customerId}.${sign(customerId)}`;
}

function decode(value: string): string | null {
  const dot = value.lastIndexOf(".");
  if (dot === -1) return null;
  const customerId = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!customerId) return null;
  // Constant-time comparison
  const expected = sign(customerId);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  return diff === 0 ? customerId : null;
}

export async function setCustomerSession(customerId: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE_NAME, encode(customerId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_SECONDS,
    path: "/",
  });
}

export async function getCustomerSession(): Promise<string | null> {
  const jar = await cookies();
  const value = jar.get(COOKIE_NAME)?.value;
  if (!value) return null;
  return decode(value);
}

export async function clearCustomerSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}
