// POS entry — owner: Mine (M1)
// The staff sign-in screen now lives at /staff/login. This route stays as a
// thin entry point: signed-in staff go to the queue board; everyone else is
// sent to the unified staff login. Docs: docs/DESIGN.md → POS Rules

import { redirect } from "next/navigation";
import type { Route } from "next";
import { getSession } from "@/lib/auth/session";

export default async function POSPage() {
  const session = await getSession();
  redirect((session ? "/pos/queue" : "/staff/login") as Route);
}
