import { createHmac, timingSafeEqual } from "crypto";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import type { NextAuthConfig } from "next-auth";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { staff } from "@db/schema";

// Task G4 — PIN provider (staff).
// Role is resolved at authorize time and carried through the JWT so getSession()
// and proxy.ts can gate routes without a DB round-trip on every request.
//
// Two credential modes:
//
// 1. attestation (fast path) — loginWithPin bcrypt-verified the PIN and minted a
//    short-lived HMAC-SHA256 token (60 s). Auth.js verifies the token and does a
//    single primary-key lookup — no bcrypt at all. The HMAC prevents a direct
//    POST to /api/auth/callback/credentials from forging the fast path.
//
// All logins require an attestation token minted by loginWithPin — direct
// signIn calls without one are rejected at the authorize() level.

// ─── Short-lived attestation token ───────────────────────────────────────────

const ATTEST_TTL_MS = 60_000; // 60 seconds

/**
 * Mint a short-lived HMAC-SHA256 attestation token that proves `loginWithPin`
 * already verified the PIN for this staff member.
 * Format: `<staffId>.<expiresAt>.<sig16>`
 */
export function mintLoginAttestation(staffId: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  const expiresAt = Date.now() + ATTEST_TTL_MS;
  const payload = `${staffId}.${expiresAt}`;
  const sig = createHmac("sha256", secret).update(payload).digest("hex").slice(0, 16);
  return `${payload}.${sig}`;
}

/**
 * Verify an attestation token. Returns the staffId on success, null on any
 * failure (bad format, expired, or tampered signature).
 */
function verifyLoginAttestation(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [staffId, expiresAtStr, sig] = parts;
  const expiresAt = parseInt(expiresAtStr, 10);
  if (!staffId || isNaN(expiresAt) || Date.now() > expiresAt) return null;

  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  const payload = `${staffId}.${expiresAt}`;
  const expected = createHmac("sha256", secret).update(payload).digest("hex").slice(0, 16);

  // Constant-time comparison to prevent timing-based token enumeration.
  try {
    const sigBuf = Buffer.from(sig, "hex");
    const expBuf = Buffer.from(expected, "hex");
    if (sigBuf.length !== expBuf.length) return null;
    return timingSafeEqual(sigBuf, expBuf) ? staffId : null;
  } catch {
    return null;
  }
}

// ─── Auth.js config ───────────────────────────────────────────────────────────

// REQ-061 / PRD §9.5.1: "Absolute session lifetime 12 hours, then re-auth …
// A session can never span two trading days." The trading (revenue) day is
// midnight-to-midnight SAST (L07). Rolling refresh is kept, but the jwt
// callback ends the session once 12 h have passed since loginAt, or the SAST
// day has changed, whichever comes first.
const SESSION_MAX_AGE_S = 12 * 60 * 60;
const SESSION_CEILING_MS = SESSION_MAX_AGE_S * 1000;

const sastDay = (ms: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date(ms));

/** True while a session that started at `loginAt` may still be used. */
export function sessionStillValid(loginAt: unknown, now: number = Date.now()): boolean {
  if (typeof loginAt !== "number" || !Number.isFinite(loginAt)) return false;
  if (now - loginAt >= SESSION_CEILING_MS) return false;
  return sastDay(loginAt) === sastDay(now);
}

export const authConfig: NextAuthConfig = {
  providers: [
    Credentials({
      name: "PIN",
      credentials: {
        pin:         { label: "PIN",         type: "password" },
        attestation: { label: "Attestation", type: "text" },
      },
      async authorize(credentials) {
        const attestation = typeof credentials?.attestation === "string"
          ? credentials.attestation.trim()
          : "";

        // All logins must go through loginWithPin (audited). Direct signIn
        // without an attestation token is rejected.
        if (!attestation) return null;

        const staffId = verifyLoginAttestation(attestation);
        if (!staffId) return null; // expired or tampered

        const [member] = await db
          .select({ id: staff.id, name: staff.name, role: staff.role, active: staff.active })
          .from(staff)
          .where(eq(staff.id, staffId));

        if (!member?.active) return null;
        return { id: member.id, name: member.name, role: member.role };
      },
    }),
  ],
  // 12h ceiling (REQ-061). NextAuth's 30-day default is wrong for a staff
  // PIN session on a public counter device.
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_S },
  // SEC-3: pin the JWT expiry and the cookie's own Max-Age to the same 12h, so
  // no path can fall back to the 30-day default. Auth.js deep-merges this
  // over its defaults, so the cookie name (and its __Secure- prefix on https)
  // is kept — hence the cast: the type wants a name we deliberately omit.
  jwt: { maxAge: SESSION_MAX_AGE_S },
  cookies: {
    sessionToken: { options: { maxAge: SESSION_MAX_AGE_S } },
  } as unknown as NextAuthConfig["cookies"],
  pages: {
    signIn: "/pos",
  },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role;
        token.loginAt = Date.now();
        return token;
      }
      // Absolute ceiling — returning null ends the session and clears the cookie.
      return sessionStillValid(token.loginAt) ? token : null;
    },
    session({ session, token }) {
      if (token.id) session.user.id = token.id as string;
      if (token.role) {
        (session.user as { role?: string }).role = token.role as string;
      }
      return session;
    },
  },
};

export const { auth, handlers, signIn, signOut } = NextAuth(authConfig);
