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
// 1. staffId (fast path) — loginWithPin has already bcrypt-verified the PIN and
//    resolved the matched staff id; it passes `staffId` here so we just do a
//    cheap primary-key lookup. This avoids running bcrypt a second time (each
//    bcrypt.compare at cost 10 takes ~150–250ms, and the full sequential scan of
//    all staff would run it for every active staff member).
//
// 2. pin (fallback / direct) — performs the full bcrypt scan. Used when
//    signIn("credentials", { pin }) is called without a pre-verified staffId
//    (e.g. direct API testing). The POS and admin login forms always go through
//    loginWithPin first, so they take the fast path.

export const authConfig: NextAuthConfig = {
  providers: [
    Credentials({
      name: "PIN",
      credentials: {
        pin: { label: "PIN", type: "password" },
        staffId: { label: "Staff ID", type: "text" },
      },
      async authorize(credentials) {
        const staffId = typeof credentials?.staffId === "string" ? credentials.staffId.trim() : "";
        const pin = typeof credentials?.pin === "string" ? credentials.pin : "";

        // ── Fast path: PIN already verified by loginWithPin ──────────────────
        if (staffId) {
          const [member] = await db
            .select({ id: staff.id, name: staff.name, role: staff.role, active: staff.active })
            .from(staff)
            .where(eq(staff.id, staffId));
          // Guard: must still be an active staff member.
          if (!member || !member.active) return null;
          return { id: member.id, name: member.name, role: member.role };
        }

        // ── Fallback: full bcrypt scan (direct signIn call without staffId) ──
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
