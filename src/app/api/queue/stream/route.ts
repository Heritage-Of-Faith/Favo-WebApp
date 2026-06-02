// Live POS queue SSE endpoint — task G6
// Streams order-change events to the POS via Server-Sent Events, with a periodic
// heartbeat. Auth: barista+. Docs: docs/API.md → GET /api/queue/stream
//
// LISTEN/NOTIFY requires a persistent Session pooler connection (port 5432).
// The Transaction pooler (DATABASE_URL, port 6543) does not support LISTEN.
// Set DATABASE_URL_SESSION to the Supabase Session pooler URL.

import postgres from "postgres";
import { getSession } from "@/lib/auth/session";
import { encodeSSE, encodeComment, heartbeat, HEARTBEAT_MS } from "@/server/queue/sse";
import type { QueueEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let listenClient: ReturnType<typeof postgres> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(encodeComment("connected")));

      // Heartbeat so clients can detect a dropped connection and reconnect.
      timer = setInterval(() => {
        const at = new Date().toISOString();
        controller.enqueue(encoder.encode(encodeSSE(heartbeat(at))));
      }, HEARTBEAT_MS);

      // Postgres LISTEN → SSE bridge.
      // Requires DATABASE_URL_SESSION (Session pooler, port 5432).
      // Without it the endpoint still works — clients get heartbeats only
      // and the POS falls back to polling on reconnect.
      const sessionUrl = process.env.DATABASE_URL_SESSION;
      if (sessionUrl) {
        listenClient = postgres(sessionUrl, {
          max: 1,
          idle_timeout: 0, // keep alive indefinitely for LISTEN
          connect_timeout: 10,
          prepare: false,
        });

        listenClient
          .listen("order_changes", (payload) => {
            try {
              const event = JSON.parse(payload) as QueueEvent;
              controller.enqueue(encoder.encode(encodeSSE(event)));
            } catch {
              // Ignore malformed payloads — don't crash the stream
            }
          })
          .catch(() => {
            // LISTEN failed — clients will reconnect via heartbeat timeout
          });
      }
    },
    cancel() {
      if (timer) clearInterval(timer);
      void listenClient?.end();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
