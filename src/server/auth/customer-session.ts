// Customer session — thin wrapper over Supabase Auth SSR.
// Returns the internal customers.id (text nanoid), not the Supabase UUID,
// so all downstream callers (orders, push) remain unchanged.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers } from "@db/schema";
import { createClient } from "@/lib/supabase/server";

export async function getCustomerSession(): Promise<string | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[customer-session] NEXT_PUBLIC_SUPABASE_URL / ANON_KEY must be set in production — customer sessions cannot be validated without them"
      );
    }
    if (process.env.NODE_ENV === "development") {
      console.warn("[customer-session] NEXT_PUBLIC_SUPABASE_URL / ANON_KEY not set — auth disabled");
    }
    return null;
  }
  let userId: string | null;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    return null;
  }
  if (!userId) return null;

  try {
    const [row] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.authId, userId));
    return row?.id ?? null;
  } catch {
    return null;
  }
}
