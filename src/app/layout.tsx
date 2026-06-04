import type { Metadata, Viewport } from "next";
import "./globals.css";

// Literal hex — maps to var(--color-coffee-bean)
const COFFEE_BEAN = "#1C0501";

const DESCRIPTION =
  "The café at Heritage of Faith Ministries. Good coffee, real community. Reyno Ridge, Emalahleni.";

export const viewport: Viewport = {
  themeColor: COFFEE_BEAN,
};

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_BASE_URL ?? "https://favo.hofmi.org"),
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
