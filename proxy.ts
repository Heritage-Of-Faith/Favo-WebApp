// Next.js 16: proxy.ts replaces middleware.ts for route gating
import { auth } from "./auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const session = await auth();
  const { pathname } = request.nextUrl;

  // Admin routes require admin or owner role
  if (pathname.startsWith("/admin")) {
    if (!session || !["admin", "owner", "finance"].includes(session.user.role ?? "")) {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  // POS routes require barista or above
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
