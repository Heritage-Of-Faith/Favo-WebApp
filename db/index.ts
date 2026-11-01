import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const client = postgres(process.env.DATABASE_URL!, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  // AT-168: a direct connection to the Postgres co-located on the Transformate
  // host (PRD §9.2), so postgres-js's default prepared statements are back on.
  // The old `prepare: false` was a workaround for Supabase's PgBouncer pooler.
});

export const db = drizzle(client, { schema });
export type DB = typeof db;
