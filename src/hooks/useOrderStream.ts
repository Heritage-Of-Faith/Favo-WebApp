"use client";

// SSE order stream hook — owner: Mine (M5)
// Connects to GET /api/queue/stream, handles heartbeats, auto-reconnects
// on disconnect with exponential back-off (capped at 30s).
// Docs: docs/API.md → GET /api/queue/stream · QueueEvent type

import { useEffect, useRef, useState, useCallback } from "react";
import type { QueueEvent, OrderState } from "@/lib/types";

export type LiveOrder = {
  orderId: string;
  state: OrderState;
  lastUpdatedAt: string;
};

export type StreamStatus = "connecting" | "connected" | "reconnecting" | "offline";

const STREAM_URL = "/api/queue/stream";
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export function useOrderStream(initialOrders?: LiveOrder[]) {
  const [orders, setOrders] = useState<Map<string, LiveOrder>>(() => {
    const m = new Map<string, LiveOrder>();
    for (const o of initialOrders ?? []) m.set(o.orderId, o);
    return m;
  });
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const esRef = useRef<EventSource | null>(null);
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    setStatus("connecting");

    const es = new EventSource(STREAM_URL);
    esRef.current = es;

    es.onopen = () => {
      if (!mountedRef.current) return;
      backoffRef.current = INITIAL_BACKOFF_MS; // reset on successful connect
      setStatus("connected");
    };

    es.onmessage = (event: MessageEvent<string>) => {
      if (!mountedRef.current) return;
      try {
        const parsed: QueueEvent = JSON.parse(event.data);
        if (parsed.type === "state_change") {
          setOrders((prev) => {
            const next = new Map(prev);
            next.set(parsed.orderId, {
              orderId: parsed.orderId,
              state: parsed.state,
              lastUpdatedAt: parsed.at,
            });
            return next;
          });
        }
        // heartbeat — no state update needed
      } catch {
        // Malformed event — ignore
      }
    };

    es.onerror = () => {
      if (!mountedRef.current) return;
      es.close();
      esRef.current = null;
      setStatus("reconnecting");

      const delay = backoffRef.current;
      backoffRef.current = Math.min(delay * 2, MAX_BACKOFF_MS);

      retryRef.current = setTimeout(() => {
        if (mountedRef.current) connect();
      }, delay);
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    const handleOffline = () => {
      esRef.current?.close();
      setStatus("offline");
    };
    const handleOnline = () => {
      backoffRef.current = INITIAL_BACKOFF_MS;
      connect();
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      mountedRef.current = false;
      esRef.current?.close();
      if (retryRef.current) clearTimeout(retryRef.current);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [connect]);

  const activeOrders = Array.from(orders.values()).filter(
    (o) => o.state !== "collected" && o.state !== "cancelled"
  );

  return { activeOrders, allOrders: Array.from(orders.values()), status };
}
