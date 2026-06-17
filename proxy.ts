// Next.js 16: proxy.ts replaces middleware.ts for route gating
import { auth } from "./auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { canAccessAdmin } from "@/server/auth/rbac";
import type { StaffRole } from "@/lib/types";

// Auth.js v5 User type does not include role by default — we extend it via JWT callback in auth.ts
type SessionUser = {
  role?: StaffRole;
};

export async function proxy(request: NextRequest) {
  const session = await auth();
  const { pathname } = request.nextUrl;

  // Admin routes require an admin-capable role. The legacy /admin/login route
  // is exempt so it can resolve (it now just redirects to /staff/login).
  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    const role = (session?.user as SessionUser | undefined)?.role;
    if (!session || !role || !canAccessAdmin(role)) {
      // Send unauthenticated/under-privileged users to the unified staff login.
      return NextResponse.redirect(new URL("/staff/login", request.url));
    }
  }

  // POS routes require any authenticated session.
  if (pathname.startsWith("/pos")) {
    if (!session) {
      return NextResponse.redirect(new URL("/staff/login", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/pos/:path*"],
};
