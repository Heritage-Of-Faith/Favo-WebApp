// POS workspace — single screen with order builder + live queue
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import POSWorkspace from "@/components/pos/POSWorkspace";
import { listActiveOrders } from "@/server/actions/orders";

export default async function POSWorkspacePage() {
  const session = await getSession();
  if (!session) redirect("/staff/login");
  const ordersRes = await listActiveOrders();
  if (!ordersRes.ok) throw new Error(`Failed to load active orders: ${ordersRes.message}`);
  return <POSWorkspace staffName={session.name} staffId={session.id} initialOrders={ordersRes.data} />;
}
