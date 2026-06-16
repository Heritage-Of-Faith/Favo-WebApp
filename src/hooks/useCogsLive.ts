"use client";

// useCogsLive — task A7.
// Keeps today's COGS summary fresh: fetches /api/cogs/live, subscribes to the
// /api/cogs/stream SSE channel, and refetches within ~1s of any COGS-affecting
// change (order deduction, expense, recosting). Falls back to periodic polling
// if SSE is unavailable (no DATABASE_URL_SESSION on the server).
//
// Acceptance (PRD §09): dashboard reflects a new order within 5s.

import { useCallback, useEffect, useRef, useState } from "react";
import type { CogsLive } from "@/lib/types";

const LIVE_URL = "/api/cogs/live";
const STREAM_URL = "/api/cogs/stream";
const POLL_FALLBACK_MS = 20_000;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export type CogsStreamStatus = "connecting" | "live" | "polling" | "offline";

export interface UseCogsLiveResult {
  today: CogsLive;
  status: CogsStreamStatus;
  /** Manually trigger a refetch of today's figures. */
  refresh: () => void;
}

/**
 * @param initial   Server-rendered today's COGS (avoids a loading flash).
 * @param onChange  Called after every successful live refetch — use it to
 *                  refresh dependent data (e.g. the trend history).
 */
export function useCogsLive(
  initial: CogsLive,
  onChange?: () => void
): UseCogsLiveResult {
  const [today, setToday] = useState<CogsLive>(initial);
  const [status, setStatus] = useState<CogsStreamStatus>("connecting");

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(LIVE_URL, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as CogsLive;
      if (!mountedRef.current) return;
      setToday(data);
      onChangeRef.current?.();
    } catch {
      // transient — next event or poll will retry
    }
  }, []);

  // Polling fallback (also a safety net even when SSE is connected).
  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(() => void refresh(), POLL_FALLBACK_MS);
  }, [refresh]);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    setStatus("connecting");

    const es = new EventSource(STREAM_URL);
    esRef.current = es;

    es.onopen = () => {
      if (!mountedRef.current) return;
      backoffRef.current = INITIAL_BACKOFF_MS;
      setStatus("live");
    };

    es.onmessage = (event: MessageEvent<string>) => {
      if (!mountedRef.current) return;
      try {
        const parsed = JSON.parse(event.data) as { type?: string };
        if (parsed.type === "cogs_changed") void refresh();
        // heartbeat → no-op
      } catch {
        // ignore malformed frames
      }
    };

    es.onerror = () => {
      if (!mountedRef.current) return;
      es.close();
      esRef.current = null;
      setStatus("polling");
      startPolling();

      const delay = backoffRef.current;
      backoffRef.current = Math.min(delay * 2, MAX_BACKOFF_MS);
      retryRef.current = setTimeout(() => {
        if (mountedRef.current) connect();
      }, delay);
    };
  }, [refresh, startPolling]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    startPolling(); // belt-and-braces; SSE events still drive sub-second refresh

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
      if (pollRef.current) clearInterval(pollRef.current);
      if (retryRef.current) clearTimeout(retryRef.current);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [connect, startPolling]);

  return { today, status, refresh };
}
