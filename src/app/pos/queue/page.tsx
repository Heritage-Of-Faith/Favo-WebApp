// POS workspace — single screen with order builder + live queue
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import POSWorkspace from "@/components/pos/POSWorkspace";
import { listActiveOrders } from "@/server/actions/orders";

export default async function POSWorkspacePage() {
  const session = await getSession();
  if (!session) redirect("/staff/login");
  const ordersRes = await listActiveOrders();
  const initialOrders = ordersRes.ok ? ordersRes.data : [];
  return <POSWorkspace staffName={session.name} staffId={session.id} initialOrders={initialOrders} />;
}
