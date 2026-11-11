// /pos/settle — the barista's deferred-settlement screen (PRD v7.0 §6.0.4 T3
// steps 3a/3b, "Settling"). Auth-gated like /pos/today; the server actions
// authorize barista or admin themselves (§11.3 matrix: settleDeferredOrder).
import { redirect } from "next/navigation";
import type { Route } from "next";
import { getSession } from "@/lib/auth/session";
import SettleDeferredList from "@/components/pos/SettleDeferredList";

export default async function SettlePage() {
  const session = await getSession();
  if (!session) redirect("/staff/login" as Route);
  return <SettleDeferredList />;
}
