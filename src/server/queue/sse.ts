// Server-Sent Events encoding for the live POS queue — task G6
// Pure helpers so the wire format is unit-testable independently of the stream.
// Docs: docs/API.md → GET /api/queue/stream · QueueEvent shape in src/lib/types.

import type { QueueEvent } from "@/lib/types";

/** Heartbeat interval (ms). Client treats silence beyond this as a dropped link. */
export const HEARTBEAT_MS = 30_000;

/** Encode a QueueEvent as an SSE `data:` frame (terminated by a blank line). */
export function encodeSSE(event: QueueEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** Encode an SSE comment (used for keep-alive pings that clients ignore). */
export function encodeComment(text: string): string {
  return `: ${text}\n\n`;
}

/** Build a heartbeat event carrying the current timestamp. */
export function heartbeat(at: string): QueueEvent {
  return { type: "heartbeat", at };
}
