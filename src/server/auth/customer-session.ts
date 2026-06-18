// Customer session — thin wrapper over Supabase Auth SSR.
// Returns the internal customers.id (text nanoid), not the Supabase UUID,
// so all downstream callers (orders, wallet, push) remain unchanged.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers } from "@db/schema";
import { createClient } from "@/lib/supabase/server";

export async function getCustomerSession(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const [row] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.authId, user.id));

  return row?.id ?? null;
}
