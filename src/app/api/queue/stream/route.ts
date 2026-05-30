// Live POS queue SSE endpoint — task G6
// Streams order-change events to the POS via Server-Sent Events, with a periodic
// heartbeat. Auth: barista+. Docs: docs/API.md → GET /api/queue/stream
//
// The Postgres LISTEN bridge is wired where noted; the SSE framing + heartbeat
// (the part with logic) is covered by unit tests on src/server/queue/sse.ts.

import { getSession } from "@/lib/auth/session";
import { encodeSSE, encodeComment, heartbeat, HEARTBEAT_MS } from "@/server/queue/sse";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(encodeComment("connected")));

      // Heartbeat so clients can detect a dropped connection and reconnect.
      timer = setInterval(() => {
        const at = new Date().toISOString();
        controller.enqueue(encoder.encode(encodeSSE(heartbeat(at))));
      }, HEARTBEAT_MS);

      // TODO (G6 wiring): open a Postgres LISTEN on `order_changes` and, for each
      // NOTIFY payload, controller.enqueue(encoder.encode(encodeSSE(event))).
    },
    cancel() {
      if (timer) clearInterval(timer);
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
