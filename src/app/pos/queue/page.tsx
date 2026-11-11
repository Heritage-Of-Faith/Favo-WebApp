// POS workspace — single screen with order builder + live queue
import { redirect } from "next/navigation";
import type { Route } from "next";
import { getSession } from "@/lib/auth/session";
import POSWorkspace from "@/components/pos/POSWorkspace";
import OpeningTimePrompt from "@/components/pos/OpeningTimePrompt";
import { listActiveOrders } from "@/server/actions/orders";
import { fundOptionsForOrder } from "@/server/actions/funds";
import { getRecentsGrid } from "@/server/actions/recents";
import { db } from "@/lib/db";
import { revenueDay } from "@/lib/format";
import { readShotPolicy } from "@/server/orders/shot-policy";
import { sundayCardSalesOnMachine } from "@/server/close/write-offs";

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
      {/* DEC-21: only a boolean crosses to the client (REQ-071: never a Yoco key).
          The card's gate is decidePaymentGate, the same as transitionOrder's. */}
      <POSWorkspace staffName={session.name} staffId={session.id} role={session.role} initialOrders={ordersRes.data}
        sundayCardOnMachine={sundayCardSalesOnMachine()} shotPolicy={shotPolicy}
        /* AT-203 / §6.10.6: the footer's fund chips read through this staff-authorised action. */
        fundOptions={fundOptionsForOrder}
        /* §6.2.1 / REQ-052: the recents grid, read through this staff-authorised action. */
        recents={getRecentsGrid} />
    </>
  );
}
