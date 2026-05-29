// TODO (G6): pg_notify wrapper — publishes order_changes events for SSE consumers
// Docs: docs/API.md → GET /api/queue/stream

import type { QueueEvent } from "@/lib/types";

export async function notifyOrderChange(_event: QueueEvent): Promise<void> {
  throw new Error("Not implemented — see task G6");
}
