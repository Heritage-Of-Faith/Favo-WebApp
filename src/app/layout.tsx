import type { Metadata, Viewport } from "next";
import "./globals.css";

// Literal hex — maps to var(--color-coffee-bean)
const COFFEE_BEAN = "#1C0501";

const DESCRIPTION =
  "The café at Heritage of Faith Ministries. Good coffee, real community. Reyno Ridge, Emalahleni.";

// Resolve a valid absolute base URL for metadata (OG/Twitter image URLs).
// Defensive: env vars may be unset OR set to a non-URL placeholder (e.g. a
// "<from .env.local>" stub). Any invalid candidate is skipped so the build
// never throws on `new URL(...)`.
function resolveBaseUrl(): URL {
  const candidates = [
    process.env.PUBLIC_BASE_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
    process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`,
    "https://favo.hofmi.org",
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
  return new URL("https://favo.hofmi.org");
}

export const viewport: Viewport = {
  themeColor: COFFEE_BEAN,
};

export const metadata: Metadata = {
  metadataBase: resolveBaseUrl(),
  title: {
    default: "FAVO Café",
    template: "%s · FAVO Café",
  },
  description: DESCRIPTION,
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
