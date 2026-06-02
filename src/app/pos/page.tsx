// POS entry — owner: Mine (M1)
// Server component: if a session already exists, skip the login screen.
// iPad portrait 768×1024. Docs: docs/DESIGN.md → POS Rules

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import LoginForm from "@/components/pos/LoginForm";

export default async function POSPage() {
  const session = await getSession();

  // Already logged in — go straight to the queue board.
  if (session) {
    redirect("/pos/queue");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-[var(--spacing-m)]">
      <LoginForm />
    </main>
  );
}
