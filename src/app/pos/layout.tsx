// POS layout — owner: Mine (M1 + M7)
// Locked to iPad portrait 768×1024. OnlineIndicator is always visible.

import type { Metadata, Viewport } from "next";
import OnlineIndicator from "@/components/pos/OnlineIndicator";

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
      {/* Offline banner — renders only when connection is lost */}
      <OnlineIndicator />
    </div>
  );
}
