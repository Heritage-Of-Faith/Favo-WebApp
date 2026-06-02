// POS queue board page — owner: Mine (M5)
// Protected: redirects to /pos if not authenticated.
// Server component — auth check server-side; QueueBoard is a client component.

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import QueueBoard from "@/components/pos/QueueBoard";

export default async function QueuePage() {
  const session = await getSession();
  if (!session) redirect("/pos");

  return (
    <main className="flex h-screen flex-col p-[var(--spacing-m)]">
      <QueueBoard />
    </main>
  );
}
