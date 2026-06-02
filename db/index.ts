import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const client = postgres(process.env.DATABASE_URL!, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  // Supabase Transaction pooler (PgBouncer) doesn't support prepared statements
  prepare: false,
});

export const db = drizzle(client, { schema });
export type DB = typeof db;
