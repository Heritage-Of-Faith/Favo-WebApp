// POS daily order history — AT-146. Auth-gated barista view of what was made
// per day (per-item counts, last 7 days). Reached via "History" in the POS top bar.
import { redirect } from "next/navigation";
import type { Route } from "next";
import { getSession } from "@/lib/auth/session";
import DailyHistory from "@/components/pos/DailyHistory";

export default async function HistoryPage() {
  const session = await getSession();
  if (!session) redirect("/staff/login" as Route);
  return <DailyHistory />;
}
