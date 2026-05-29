// TODO (G6): SSE endpoint — LISTEN order_changes via pg_notify
// Heartbeat every 30s. Auth: barista+. Docs: docs/API.md → GET /api/queue/stream

export async function GET(_request: Request) {
  // TODO (G6): implement ReadableStream with pg LISTEN
  return new Response("Not implemented", { status: 501 });
}
