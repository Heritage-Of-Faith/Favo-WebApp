import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
];

// SEC-4 Content-Security-Policy. Static header (no nonces), so script-src
// needs 'unsafe-inline' for Next's inline bootstrap scripts; 'unsafe-eval' only
// in `next dev` (React's dev tooling). External origins are only the ones the
// app really loads: Google Fonts (root layout) and the Supabase project for the
// customer session. The Yoco card SDK script origin is gone (REQ-071: the
// browser loads no Yoco script and holds no Yoco key). No upgrade-insecure-requests:
// the practice host serves plain http on the LAN.
function originOf(url: string | undefined): string | null {
  if (!url || !/^https?:\/\//i.test(url.trim())) return null;
  try {
    return new URL(url.trim()).origin;
  } catch {
    return null;
  }
}

function contentSecurityPolicy(): string {
  const isDev = process.env.NODE_ENV === "development";
  const supabase = originOf(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const supabaseWs = supabase ? supabase.replace(/^http/i, "ws") : null;
  const connect = ["'self'", supabase, supabaseWs, "https://*.yoco.com"].filter(Boolean).join(" ");
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    `connect-src ${connect}`,
    "frame-src https://*.yoco.com",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const nextConfig: NextConfig = {
  typedRoutes: true,
  // Produces .next/standalone — the self-contained server the Dockerfile copies in.
  output: "standalone",
  // Do not advertise the framework in an `x-powered-by` response header.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          ...securityHeaders,
          { key: "Content-Security-Policy", value: contentSecurityPolicy() },
        ],
      },
    ];
  },
};

export default nextConfig;
