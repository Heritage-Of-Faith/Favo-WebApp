import { auth } from "../auth";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── Admin route protection (/admin/* except the login page) ───────────────
  // Uses Auth.js JWT — no DB round-trip (JWT strategy).
  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
    return NextResponse.next();
  }

  // ── POS sub-route protection (/pos/queue, /pos/order/*, /pos/today, /pos/waste)
  // The root /pos page is the PIN login screen — it must remain open.
  if (pathname.startsWith("/pos/")) {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.redirect(new URL("/pos", request.url));
    }
    return NextResponse.next();
  }

  // ── Customer route session refresh (Supabase) ─────────────────────────────
  // Keeps the Supabase session cookie fresh on every request so it doesn't
  // expire mid-visit. Passes through silently if Supabase is not configured.
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
    // Staff surfaces
    "/admin/:path*",
    "/pos/:path*",
    // Customer surfaces — note: the (customer) route group is URL-transparent
    // so routes in src/app/(customer)/* appear at /customer/*, /login, /signup
    "/customer/:path*",
    "/login",
    "/signup",
  ],
};
