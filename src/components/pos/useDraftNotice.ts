import { useState, useCallback } from "react";

/** A one-off notice (e.g. "sent to the queue") that is dropped as soon as a new draft starts. */
export function useDraftNotice() {
  const [notice, setNotice] = useState<string | null>(null);
  const clearOnDraft = useCallback(
    <A extends unknown[], R>(fn: (...a: A) => R) => (...a: A): R => { setNotice(null); return fn(...a); },
    [],
  );
  return { notice, setNotice, clearOnDraft };
}
