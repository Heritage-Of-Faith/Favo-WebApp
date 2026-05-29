import { useEffect, useCallback } from "react";
import type { QueueEvent } from "@/lib/types";

// TODO (M5): SSE consumer — connects to /api/queue/stream, auto-reconnects
// Docs: docs/API.md → GET /api/queue/stream

export function useOrderStream(onEvent: (event: QueueEvent) => void) {
  const handler = useCallback(onEvent, [onEvent]);

  useEffect(() => {
    // TODO (M5): new EventSource('/api/queue/stream') + message listener
    void handler;
    return () => {
      // cleanup EventSource
    };
  }, [handler]);
}
