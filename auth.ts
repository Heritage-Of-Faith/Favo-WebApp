import { createHmac, timingSafeEqual } from "crypto";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import type { NextAuthConfig } from "next-auth";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { staff } from "@db/schema";
import { isValidPinFormat, verifyPin } from "@/server/auth/pin";
import { writeAudit } from "@/server/audit";
import type { StaffRole } from "@/lib/types";

// SSO can only authenticate admin role; baristas use PIN only
const ALLOWED_SSO_ROLES = new Set<StaffRole>(["admin"]);

// Task G4 -- PIN provider (staff). HOFMI SSO provider is a follow-up (A3 needs it).
// Role is resolved at authorize time and carried through the JWT so getSession()
// and proxy.ts can gate routes without a DB round-trip on every request.
//
// Two credential modes:
//
// 1. attestation (fast path) -- loginWithPin bcrypt-verified the PIN and minted a
//    short-lived HMAC-SHA256 token (60 s). Auth.js verifies the token and does a
//    single primary-key lookup -- no bcrypt at all. The HMAC prevents a direct
//    POST to /api/auth/callback/credentials from forging the fast path.
//
// 2. pin (fallback / direct) -- full bcrypt scan. Used when signIn("credentials",
//    { pin }) is called without an attestation (e.g. direct API testing). Normal
//    POS/admin login always goes through loginWithPin first.

// --- Short-lived attestation token -------------------------------------------

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

// --- Auth.js config ----------------------------------------------------------

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

        // Fast path: HMAC-attested token from loginWithPin
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

        // Fallback: full bcrypt scan (direct signIn without attestation)
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

    // -- HOFMI SSO provider (admin only) ---------------------------------------
    // TODO (A3): Wire this provider once HOFMI SSO OAuth credentials are
    // available. Required env vars:
    //   HOFMI_SSO_CLIENT_ID     -- OAuth 2.0 client ID
    //   HOFMI_SSO_CLIENT_SECRET -- OAuth 2.0 client secret
    //   HOFMI_SSO_ISSUER        -- OIDC discovery URL (e.g. https://sso.hofmi.net)
    //
    // Left intentionally unconfigured (empty strings) so the build succeeds and
    // the login page renders. The signIn("hofmi-sso") call will fail at runtime
    // until these env vars are set.
    //
    // When wiring: confirm the SSO token/userinfo endpoint returns a `role` claim
    // mapping to StaffRole, then adjust the profile() mapper below.
    {
      id: "hofmi-sso",
      name: "HOFMI",
      type: "oidc" as const,
      issuer: process.env.HOFMI_SSO_ISSUER ?? "",
      clientId: process.env.HOFMI_SSO_CLIENT_ID ?? "",
      clientSecret: process.env.HOFMI_SSO_CLIENT_SECRET ?? "",
      // Map the OIDC profile onto the Auth.js user object.
      // Adjust field names once the real SSO token shape is known.
      profile(profile: Record<string, unknown>) {
        // Validate identity claims before trusting them for session/RBAC.
        // An empty subject or an unrecognised role must never establish a session.
        const id =
          typeof profile.sub === "string" && profile.sub.length > 0
            ? profile.sub
            : typeof profile.id === "string" && profile.id.length > 0
              ? profile.id
              : null;
        if (!id) throw new Error("HOFMI SSO: missing subject (sub) claim");

        // `role` is a custom claim -- reject anything outside the admin-capable set.
        const rawRole = typeof profile.role === "string" ? profile.role : null;
        if (!rawRole || !ALLOWED_SSO_ROLES.has(rawRole as StaffRole)) {
          throw new Error("HOFMI SSO: unauthorized or missing role claim");
        }

        return {
          id,
          name: String(profile.name ?? profile.preferred_username ?? ""),
          email: typeof profile.email === "string" ? profile.email : undefined,
          role: rawRole as StaffRole,
        };
      },
    },
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/pos",
    error: "/admin/login",
  },
  callbacks: {
    jwt({ token, user, account }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role;
      }
      void account; // retained for future reference
      return token;
    },
    session({ session, token }) {
      if (token.id) session.user.id = token.id as string;
      if (token.role) {
        (session.user as { role?: string }).role = token.role as string;
      }
      return session;
    },
    // Post-login redirect: honour callbackUrl or fall back to /admin.
    redirect({ url, baseUrl }) {
      if (url.startsWith(baseUrl)) return url;
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      return `${baseUrl}/admin`;
    },
  },
  events: {
    // Audit successful HOFMI SSO logins, mirroring the PIN path's `login_success`
    // row. The PIN flow audits inside loginWithPin; the SSO flow only completes in
    // the OAuth callback, so the equivalent hook is Auth.js's signIn event.
    async signIn({ user, account }) {
      if (account?.provider !== "hofmi-sso") return;
      await writeAudit({
        entityKind: "staff",
        entityId: user.id ?? "unknown",
        action: "login_success",
        actorId: user.id ?? undefined,
        actorRole: (user as { role?: string }).role,
        reason: "HOFMI SSO login",
      });
    },
  },
};

export const { auth, handlers, signIn, signOut } = NextAuth(authConfig);
