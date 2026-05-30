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

export const authConfig: NextAuthConfig = {
  providers: [
    Credentials({
      name: "PIN",
      credentials: {
        pin: { label: "PIN", type: "password" },
      },
      async authorize(credentials) {
        const pin = typeof credentials?.pin === "string" ? credentials.pin : "";
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
