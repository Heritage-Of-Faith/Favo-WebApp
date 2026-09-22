// Next.js 16: proxy.ts replaces middleware.ts for route gating.
// This is the one route gate — it used to be split across this file and
// src/middleware.ts, but Next 16 only ever invoked this one; the Supabase
// refresh in src/middleware.ts was dead code. Merged here: staff role checks
// (Auth.js/JWT) plus the customer Supabase session refresh.
import { auth } from "./auth";
import { createServerClient } from "@supabase/ssr";
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
    return NextResponse.next();
  }

  // POS sub-routes require any authenticated session. The bare /pos root is
  // the PIN login screen itself and must stay open — do not gate it.
  if (pathname.startsWith("/pos/")) {
    if (!session) {
      return NextResponse.redirect(new URL("/staff/login", request.url));
    }
    return NextResponse.next();
  }

  // Everything else in the matcher is a customer surface. Keep the Supabase
  // session cookie fresh on every request so it doesn't expire mid-visit.
  // Passes through silently if Supabase is not configured.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  await supabase.auth.getUser();
  return supabaseResponse;
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/pos/:path*",
    // Customer surfaces — note: the (customer) route group is URL-transparent
    // so routes in src/app/(customer)/* appear at /customer/*, /login, /signup
    "/customer/:path*",
    "/login",
    "/signup",
  ],
};
