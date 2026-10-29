// POS workspace — single screen with order builder + live queue
import { redirect } from "next/navigation";
import type { Route } from "next";
import { getSession } from "@/lib/auth/session";
import POSWorkspace from "@/components/pos/POSWorkspace";
import OpeningTimePrompt from "@/components/pos/OpeningTimePrompt";
import { listActiveOrders } from "@/server/actions/orders";
import { db } from "@/lib/db";
import { revenueDay } from "@/lib/format";
import { readShotPolicy } from "@/server/orders/shot-policy";

export default async function POSWorkspacePage() {
  const session = await getSession();
  if (!session) redirect("/staff/login" as Route);
  // AT-202: today's shot ceiling and surcharge (T09, T15), read with the page
  // so the picker renders only the segments the mode allows. The server
  // re-checks both on every createOrder; this only drives what is drawn.
  const [ordersRes, shotPolicy] = await Promise.all([
    listActiveOrders(),
    readShotPolicy(db, revenueDay()),
  ]);
  if (!ordersRes.ok) throw new Error(`Failed to load active orders: ${ordersRes.message}`);
  return (
    <>
      {/* AT-134 — opening-time prompt, every login. Sibling of the workspace so
          opening/dismissing it can never touch the cart or attached customer. */}
      <OpeningTimePrompt />
      {/* REQ-071: only a boolean crosses to the client — never a Yoco key. It
          mirrors the server's own payment gate in transitionOrder. */}
      <POSWorkspace staffName={session.name} staffId={session.id} role={session.role} initialOrders={ordersRes.data}
        yocoConfigured={!!process.env.YOCO_SECRET_KEY} shotPolicy={shotPolicy} />
    </>
  );
}
