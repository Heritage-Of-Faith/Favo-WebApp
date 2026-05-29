import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import type { NextAuthConfig } from "next-auth";

// TODO (G4): Implement PIN lookup against staff.pin_hash (bcrypt compare)
// TODO (G4): Add HOFMI SSO provider (OAuth)

export const authConfig: NextAuthConfig = {
  providers: [
    Credentials({
      name: "PIN",
      credentials: {
        pin: { label: "PIN", type: "password" },
      },
      async authorize(credentials) {
        // TODO (G4): query staff table, bcrypt.compare(pin, pin_hash)
        // Return null if invalid, staff object if valid
        void credentials;
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
        // TODO (G4): attach role from staff table
      }
      return token;
    },
    session({ session, token }) {
      if (token.id) session.user.id = token.id as string;
      return session;
    },
  },
};

export const { auth, handlers, signIn, signOut } = NextAuth(authConfig);
