// Customer PWA shell — owner: Nikao (tasks N2, N5)
// Docs: docs/ARCHITECTURAL.md → src/app/(customer)/

import type { Metadata, Viewport } from "next";
import ServiceWorkerRegister from "@/components/customer/ServiceWorkerRegister";
import PushSubscriptionSync from "@/components/customer/PushSubscriptionSync";
import { getCustomerSession } from "@/server/auth/customer-session";

export const viewport: Viewport = {
  themeColor: "#1C0501",
};

export const metadata: Metadata = {
  title: "FAVO Café",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "FAVO Café",
  },
};

export default async function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const customerId = await getCustomerSession();

  return (
    <>
      <ServiceWorkerRegister />
      {customerId && <PushSubscriptionSync customerId={customerId} />}
      {children}
    </>
  );
}
