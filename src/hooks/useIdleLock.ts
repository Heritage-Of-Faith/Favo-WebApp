"use client";

// REQ-061 / PRD §9.5.1: 5 minutes of no interaction → the till asks to lock.
// Whether it may lock is the server's call (endTillSession("idle_lock") refuses
// inside an opening window, L36); this hook only measures idleness. Any touch,
// click, key or scroll restarts the 5 minutes. When `onIdle` resolves without
// locking, the clock simply starts again.

import { useEffect, useRef } from "react";

export const IDLE_LOCK_MS = 5 * 60_000;

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart", "wheel"] as const;

export function useIdleLock(onIdle: () => Promise<void> | void, ms: number = IDLE_LOCK_MS): void {
  const onIdleRef = useRef(onIdle);
  useEffect(() => { onIdleRef.current = onIdle; }, [onIdle]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(fire, ms);
    };
    const fire = async () => {
      timer = null;
      try { await onIdleRef.current(); } catch { /* never lock on an error */ }
      if (!stopped && timer === null) arm();
    };
    arm();
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, arm, { passive: true });
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, arm);
    };
  }, [ms]);
}
