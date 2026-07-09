// POS workspace — single screen with order builder + live queue
import { redirect } from "next/navigation";
import type { Route } from "next";
import { getSession } from "@/lib/auth/session";
import POSWorkspace from "@/components/pos/POSWorkspace";
import OpeningTimePrompt from "@/components/pos/OpeningTimePrompt";
import { listActiveOrders } from "@/server/actions/orders";

export default async function POSWorkspacePage() {
  const session = await getSession();
  if (!session) redirect("/staff/login" as Route);
  const ordersRes = await listActiveOrders();
  if (!ordersRes.ok) throw new Error(`Failed to load active orders: ${ordersRes.message}`);
  return (
    <>
      {/* AT-134 — opening-time prompt, every login. Sibling of the workspace so
          opening/dismissing it can never touch the cart or attached customer. */}
      <OpeningTimePrompt />
      <POSWorkspace staffName={session.name} staffId={session.id} role={session.role} initialOrders={ordersRes.data} />
    </>
  );
}
