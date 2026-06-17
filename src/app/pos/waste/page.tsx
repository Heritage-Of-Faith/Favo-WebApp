// Standalone POS waste page — task M8.
// For non-order waste (dropped cup, broken bag of beans). Auth-gated.
import { redirect } from "next/navigation";
import type { Route } from "next";
import { getSession } from "@/lib/auth/session";
import WasteStandalone from "@/components/pos/WasteStandalone";

export default async function WastePage() {
  const session = await getSession();
  if (!session) redirect("/staff/login" as Route);
  return <WasteStandalone />;
}
