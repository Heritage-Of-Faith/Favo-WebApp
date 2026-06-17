// POS daily summary — task M12. Auth-gated barista view of today's volume.
import { redirect } from "next/navigation";
import type { Route } from "next";
import { getSession } from "@/lib/auth/session";
import TodayCard from "@/components/pos/TodayCard";

export default async function TodayPage() {
  const session = await getSession();
  if (!session) redirect("/staff/login" as Route);
  return <TodayCard />;
}
