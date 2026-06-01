// POS layout — owner: Mine (M1)
// Locked to iPad portrait 768×1024. Viewport meta set here so the POS shell
// never scales or zooms on touch devices.

import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "FAVO POS",
  description: "FAVO Café point-of-sale",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function POSLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-dark-teal font-sans antialiased">
      {children}
    </div>
  );
}
