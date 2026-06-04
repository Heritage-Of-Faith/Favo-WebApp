// GET /api/cogs/stream — task A7 (admin COGS live refresh).
// Server-Sent Events bridge for COGS-affecting changes. The admin dashboard
// subscribes and refetches /api/cogs/live within ~1s of any of:
//   - cogs_changes      (expense logged, lot recosted)
//   - inventory_changes (order deduction reduced stock → COGS up)
//
// Admin / owner only. Mirrors the POS queue stream (G6).
//
// LISTEN/NOTIFY needs a persistent Session pooler connection (port 5432) via
// DATABASE_URL_SESSION. Without it the endpoint still emits heartbeats and the
// client falls back to periodic polling.

import postgres from "postgres";
import { getSession } from "@/lib/auth/session";
import { encodeComment } from "@/server/queue/sse";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = new Set(["admin", "owner"]);
const HEARTBEAT_MS = 30_000;
const CHANNELS = ["cogs_changes", "inventory_changes"] as const;

function encodeChange(channel: string): string {
  return `data: ${JSON.stringify({ type: "cogs_changed", channel, at: new Date().toISOString() })}\n\n`;
}

function encodeHeartbeat(): string {
  return `data: ${JSON.stringify({ type: "heartbeat", at: new Date().toISOString() })}\n\n`;
}

export async function GET() {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (!ALLOWED_ROLES.has(session.role)) return new Response("Forbidden", { status: 403 });

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let listenClient: ReturnType<typeof postgres> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(encodeComment("connected")));

      timer = setInterval(() => {
        controller.enqueue(encoder.encode(encodeHeartbeat()));
      }, HEARTBEAT_MS);

      const sessionUrl = process.env.DATABASE_URL_SESSION;
      if (sessionUrl) {
        listenClient = postgres(sessionUrl, {
          max: 1,
          idle_timeout: 0,
          connect_timeout: 10,
          prepare: false,
        });

        for (const channel of CHANNELS) {
          listenClient
            .listen(channel, () => {
              controller.enqueue(encoder.encode(encodeChange(channel)));
            })
            .catch(() => {
              // LISTEN failed — client falls back to polling on heartbeat timeout
            });
        }
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
