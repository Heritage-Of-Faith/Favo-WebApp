// POS daily summary — task M12. Auth-gated barista view of today's volume.
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import TodayCard from "@/components/pos/TodayCard";

export default async function TodayPage() {
  const session = await getSession();
  if (!session) redirect("/pos");
  return <TodayCard />;
}
