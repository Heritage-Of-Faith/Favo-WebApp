import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FAVO Café",
  description: "Coffee loyalty + POS for FAVO Café",
  manifest: "/manifest.json",
  themeColor: "#1C0501",
  openGraph: {
    title: "FAVO Café",
    description: "Speciality coffee. Reward every visit.",
    type: "website",
    siteName: "FAVO Café",
  },
  twitter: {
    card: "summary",
    title: "FAVO Café",
    description: "Speciality coffee. Reward every visit.",
  },
  icons: {
    icon: "/brand/logo-monogram.svg",
    apple: "/brand/logo-monogram.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
