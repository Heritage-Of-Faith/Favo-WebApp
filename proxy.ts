// Next.js 16: proxy.ts replaces middleware.ts for route gating
import { auth } from "./auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Auth.js v5 User type does not include role by default — we extend it via JWT callback in auth.ts
type SessionUser = {
  role?: string;
};

export async function proxy(request: NextRequest) {
  const session = await auth();
  const { pathname } = request.nextUrl;

  // Admin routes require admin, owner, or finance role
  if (pathname.startsWith("/admin")) {
    const role = (session?.user as SessionUser | undefined)?.role ?? "";
    if (!session || !["admin", "owner", "finance"].includes(role)) {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  // POS routes require any authenticated session
  if (pathname.startsWith("/pos")) {
    if (!session) {
      return NextResponse.redirect(new URL("/pos", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/pos/:path*"],
};
