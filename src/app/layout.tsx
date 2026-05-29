import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FAVO Café",
  description: "Coffee loyalty + POS for FAVO Café",
  manifest: "/manifest.json",
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
