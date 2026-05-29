import { describe, it, expect } from "vitest";
import {
  encodeSSE,
  encodeComment,
  heartbeat,
  HEARTBEAT_MS,
} from "@/server/queue/sse";
import { serializeQueueEvent } from "@/server/queue/notify";
import type { QueueEvent } from "@/lib/types";

describe("sse: encoding", () => {
  it("encodes an event as a data frame ending in a blank line", () => {
    const event: QueueEvent = {
      type: "state_change",
      orderId: "ord_1",
      state: "ready",
      at: "2026-05-29T10:00:00.000Z",
    };
    const frame = encodeSSE(event);
    expect(frame.startsWith("data: ")).toBe(true);
    expect(frame.endsWith("\n\n")).toBe(true);
    expect(JSON.parse(frame.slice("data: ".length).trim())).toEqual(event);
  });

  it("encodes comments as `: ...` keep-alive lines", () => {
    expect(encodeComment("connected")).toBe(": connected\n\n");
  });

  it("builds a heartbeat event carrying the timestamp", () => {
    const at = "2026-05-29T10:00:00.000Z";
    expect(heartbeat(at)).toEqual({ type: "heartbeat", at });
  });

  it("uses a sane heartbeat interval", () => {
    expect(HEARTBEAT_MS).toBe(30_000);
  });
});

describe("sse: notify serialization", () => {
  it("round-trips a queue event through the NOTIFY payload", () => {
    const event: QueueEvent = {
      type: "state_change",
      orderId: "ord_2",
      state: "in_progress",
      at: "2026-05-29T11:00:00.000Z",
    };
    expect(JSON.parse(serializeQueueEvent(event))).toEqual(event);
  });
});
