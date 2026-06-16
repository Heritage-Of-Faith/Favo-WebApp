// POS service worker registration — owner: Mine (task M14 / Phase 3)
// Registers /pos-sw.js scoped to /pos/ so the POS shell boots offline.
// Kept separate from the customer SW (Nikao's /sw.js, scope /) — different
// scope and cache name, so the two never collide.
"use client";

import { useEffect } from "react";

export default function POSServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Skip in dev to keep HMR clean — offline support is progressive enhancement.
    if (process.env.NODE_ENV !== "production") return;

    const register = () => {
      navigator.serviceWorker
        .register("/pos-sw.js", { scope: "/pos/" })
        .catch(() => {
          // Silent — the POS still works online without the SW.
        });
    };

    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
