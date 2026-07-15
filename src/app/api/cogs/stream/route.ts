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
//
// The actual LISTEN connection is shared across every connected admin tab
// (see @/server/queue/broker) — this route only holds its own lightweight
// stream open and subscribes to it.

import { getSession } from "@/lib/auth/session";
import { encodeComment } from "@/server/queue/sse";
import { cogsBroker } from "@/server/queue/broker";

export const dynamic = "force-dynamic";
// Cost note (2026-07-15): previously unset (relying on the platform default)
// and each connection opened its own dedicated DB connection — see the same
// note on /api/queue/stream. Explicit + short, now that LISTEN is shared.
export const maxDuration = 60;

const ALLOWED_ROLES = new Set(["admin"]);
const HEARTBEAT_MS = 30_000;

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
  let unsubscribe: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(encodeComment("connected")));

      timer = setInterval(() => {
        controller.enqueue(encoder.encode(encodeHeartbeat()));
      }, HEARTBEAT_MS);

      unsubscribe = cogsBroker.subscribe((channel) => {
        controller.enqueue(encoder.encode(encodeChange(channel)));
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
    },
  });
}
