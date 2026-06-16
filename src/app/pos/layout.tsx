// POS layout — owner: Mine
// Full-width for the split workspace. Viewport locked (no zoom on touch).
import type { Metadata, Viewport } from "next";
import OnlineIndicator from "@/components/pos/OnlineIndicator";
import POSServiceWorkerRegister from "@/components/pos/POSServiceWorkerRegister";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = { title: "FAVO POS", description: "FAVO Café point-of-sale" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false };

export default function POSLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-porcelain font-sans antialiased">
      {children}
      <OnlineIndicator />
      <POSServiceWorkerRegister />
      <Toaster position="top-center" richColors />
    </div>
  );
}
