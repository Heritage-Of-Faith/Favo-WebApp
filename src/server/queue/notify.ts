// pg_notify wrapper — task G6
// Publishes order-change events on the `order_changes` channel; the SSE route
// LISTENs and relays to connected POS clients. Docs: docs/API.md → /api/queue/stream

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { QueueEvent } from "@/lib/types";

export const QUEUE_CHANNEL = "order_changes";

/** Serialize a queue event for the NOTIFY payload (pure — unit-testable). */
export function serializeQueueEvent(event: QueueEvent): string {
  return JSON.stringify(event);
}

/** Publish an order-change event to Postgres LISTEN/NOTIFY subscribers. */
export async function notifyOrderChange(event: QueueEvent): Promise<void> {
  const payload = serializeQueueEvent(event);
  await db.execute(sql`SELECT pg_notify(${QUEUE_CHANNEL}, ${payload})`);
}
