import type { Metadata } from "next";
import "./globals.css";

// Next.js Metadata API requires literal hex — maps to var(--color-coffee-bean)
const COFFEE_BEAN = "#1C0501";

export const metadata: Metadata = {
  title: {
    default: "FAVO Café",
    template: "%s · FAVO Café",
  },
  description: "The café at Heritage of Faith Ministries. Good coffee, real community. Reyno Ridge, Emalahleni.",
  manifest: "/manifest.webmanifest",
  themeColor: COFFEE_BEAN,
  openGraph: {
    title: "FAVO Café",
    description: "The café at Heritage of Faith Ministries. Good coffee, real community. Reyno Ridge, Emalahleni.",
    type: "website",
    siteName: "FAVO Café",
  },
  twitter: {
    card: "summary",
    title: "FAVO Café",
    description: "The café at Heritage of Faith Ministries. Good coffee, real community. Reyno Ridge, Emalahleni.",
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
