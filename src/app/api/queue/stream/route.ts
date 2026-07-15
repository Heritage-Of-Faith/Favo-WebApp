// Live POS queue SSE endpoint — task G6
// Streams order-change events to the POS via Server-Sent Events, with a periodic
// heartbeat. Auth: barista+. Docs: docs/API.md → GET /api/queue/stream
//
// LISTEN/NOTIFY requires a persistent Session pooler connection (port 5432).
// The Transaction pooler (DATABASE_URL, port 6543) does not support LISTEN.
// Set DATABASE_URL_SESSION to the Supabase Session pooler URL.
//
// The actual LISTEN connection is shared across every connected client (see
// @/server/queue/broker) — this route only holds its own lightweight stream
// open and subscribes to it.

import { getSession } from "@/lib/auth/session";
import { encodeSSE, encodeComment, heartbeat, HEARTBEAT_MS } from "@/server/queue/sse";
import { orderChangesBroker } from "@/server/queue/broker";
import type { QueueEvent } from "@/lib/types";

export const dynamic = "force-dynamic";
// Cost note (2026-07-15): this used to be 300s, with each connection also
// opening its own dedicated DB connection — weeks of always-on POS/admin tabs
// blew well past the Vercel plan's included compute. 60s + the shared broker
// above cuts worst-case per-invocation duration 5x; the client (useOrderStream)
// already reconnects with backoff + a full resync on every disconnect, so a
// more frequent reconnect cycle is a minor cost, not a correctness issue.
export const maxDuration = 60;

export async function GET() {
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(encodeComment("connected")));

      // Heartbeat so clients can detect a dropped connection and reconnect.
      timer = setInterval(() => {
        const at = new Date().toISOString();
        controller.enqueue(encoder.encode(encodeSSE(heartbeat(at))));
      }, HEARTBEAT_MS);

      // Shared LISTEN → SSE bridge (see @/server/queue/broker). Without
      // DATABASE_URL_SESSION configured, subscribers just get heartbeats and
      // the POS falls back to polling on reconnect.
      unsubscribe = orderChangesBroker.subscribe((_channel, payload) => {
        try {
          const event = JSON.parse(payload) as QueueEvent;
          controller.enqueue(encoder.encode(encodeSSE(event)));
        } catch {
          // Ignore malformed payloads — don't crash the stream
        }
      });
    },
    cancel() {
      if (timer) clearInterval(timer);
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable Nginx/proxy buffering so frames are forwarded immediately.
      "X-Accel-Buffering": "no",
    },
  });
}
