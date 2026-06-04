import { createHmac, timingSafeEqual } from "crypto";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import type { NextAuthConfig } from "next-auth";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { staff } from "@db/schema";
import { isValidPinFormat, verifyPin } from "@/server/auth/pin";

// Task G4 — PIN provider (staff). HOFMI SSO provider is a follow-up (A3 needs it).
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
// 2. pin (fallback / direct) — full bcrypt scan. Used when signIn("credentials",
//    { pin }) is called without an attestation (e.g. direct API testing). Normal
//    POS/admin login always goes through loginWithPin first.

// ─── Short-lived attestation token ───────────────────────────────────────────

const ATTEST_TTL_MS = 60_000; // 60 seconds

/**
 * Mint a short-lived HMAC-SHA256 attestation token that proves `loginWithPin`
 * already verified the PIN for this staff member.
 * Format: `<staffId>.<expiresAt>.<sig16>`
 */
export function mintLoginAttestation(staffId: string): string {
  const secret = process.env.AUTH_SECRET ?? "dev-secret";
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

  const secret = process.env.AUTH_SECRET ?? "dev-secret";
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
        const pin = typeof credentials?.pin === "string" ? credentials.pin : "";

        // ── Fast path: HMAC-attested token from loginWithPin ─────────────────
        if (attestation) {
          const staffId = verifyLoginAttestation(attestation);
          if (!staffId) return null; // expired or tampered

          const [member] = await db
            .select({ id: staff.id, name: staff.name, role: staff.role, active: staff.active })
            .from(staff)
            .where(eq(staff.id, staffId));

          if (!member?.active) return null;
          return { id: member.id, name: member.name, role: member.role };
        }

        // ── Fallback: full bcrypt scan (direct signIn without attestation) ───
        if (!isValidPinFormat(pin)) return null;

        const activeStaff = await db
          .select()
          .from(staff)
          .where(eq(staff.active, true));

        for (const s of activeStaff) {
          if (await verifyPin(pin, s.pinHash)) {
            return { id: s.id, name: s.name, role: s.role };
          }
        }
        return null;
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/pos",
  },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role;
      }
      return token;
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
