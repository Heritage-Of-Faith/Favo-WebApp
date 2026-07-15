// Shared LISTEN broker for SSE routes — cost fix (2026-07-15).
//
// Before this, every connected browser tab's SSE request opened its OWN
// dedicated `postgres()` LISTEN connection, held open (idle_timeout: 0) for
// as long as that tab's stream stayed alive. With multiple POS/admin tabs
// open continuously across weeks, that's N duplicate long-lived DB
// connections doing identical work. This module opens ONE LISTEN connection
// per channel-set on a warm instance — lazily, on first subscriber — and fans
// each NOTIFY out to every currently-connected SSE stream. The connection
// closes itself the moment the last subscriber disconnects, rather than
// sitting open indefinitely.
//
// Module-level state persists only within a single warm serverless instance
// (exactly what Fluid compute's "improved concurrency" is for — many
// concurrent requests sharing one instance) — a cold start simply recreates
// it lazily on the next subscribe.

import postgres from "postgres";

type Listener = (channel: string, payload: string) => void;

function createChannelBroker(channels: readonly string[]) {
  let client: ReturnType<typeof postgres> | undefined;
  const listeners = new Set<Listener>();

  function ensureConnected() {
    if (client) return;
    const sessionUrl = process.env.DATABASE_URL_SESSION;
    if (!sessionUrl) return; // no session-pooler URL configured — subscribers get heartbeats only
    const c = postgres(sessionUrl, {
      max: 1,
      idle_timeout: 0, // keep alive for as long as there's at least one subscriber
      connect_timeout: 10,
      prepare: false,
    });
    client = c;
    for (const channel of channels) {
      c.listen(channel, (payload) => {
        for (const fn of listeners) fn(channel, payload);
      }).catch(() => {
        // LISTEN failed — subscribers fall back to heartbeat-driven reconnect/poll.
      });
    }
  }

  /** Subscribe to every channel this broker covers. Returns an unsubscribe fn. */
  function subscribe(fn: Listener): () => void {
    ensureConnected();
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
      if (listeners.size === 0 && client) {
        const c = client;
        client = undefined;
        void c.end();
      }
    };
  }

  return { subscribe };
}

/** POS live order queue — GET /api/queue/stream. */
export const orderChangesBroker = createChannelBroker(["order_changes"]);

/** Admin COGS live refresh — GET /api/cogs/stream. */
export const cogsBroker = createChannelBroker(["cogs_changes", "inventory_changes"]);
