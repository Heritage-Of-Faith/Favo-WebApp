import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SITE_DESCRIPTION } from "@/lib/site";

// Literal hex — maps to var(--color-coffee-bean)
const COFFEE_BEAN = "#1C0501";

const DESCRIPTION = SITE_DESCRIPTION;

// Resolve a valid absolute base URL for metadata (OG/Twitter image URLs).
// Defensive: env vars may be unset OR set to a non-URL placeholder (e.g. a
// "<from .env.local>" stub). Any invalid candidate is skipped so the build
// never throws on `new URL(...)`.
function resolveBaseUrl(): URL {
  const candidates = [
    process.env.PUBLIC_BASE_URL,
    "https://favo.hofmi.net",
  ];
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value && /^https?:\/\//i.test(value)) {
      try {
        return new URL(value);
      } catch {
        // skip invalid candidate
      }
    }
  }
  return new URL("https://favo.hofmi.net");
}

// viewportFit "cover" for the iPad home-screen app. Pinch-zoom is left on
// (no maximumScale / userScalable) — accessibility over app-like feel.
export const viewport: Viewport = {
  themeColor: COFFEE_BEAN,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase: resolveBaseUrl(),
  title: {
    default: "FAVO Café",
    template: "%s · FAVO Café",
  },
  description: DESCRIPTION,
  // iPad / iPhone home screen. Opaque "black" status bar so nothing renders
  // underneath it. Next emits mobile-web-app-capable; older iPadOS only reads
  // the apple- prefixed tag, hence `other`.
  appleWebApp: { capable: true, title: "FAVO", statusBarStyle: "black" },
  other: { "apple-mobile-web-app-capable": "yes" },
  openGraph: {
    title: "FAVO Café",
    description: DESCRIPTION,
    type: "website",
    siteName: "FAVO Café",
    images: [
      {
        url: "/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "FAVO — the café at Heritage of Faith, Emalahleni",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "FAVO Café",
    description: DESCRIPTION,
    images: ["/og-image.jpg"],
  },
  icons: {
    icon: [
      { url: "/brand/logo-monogram.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Google Fonts — preconnect for performance */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@300;700;900&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,600;9..40,700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
