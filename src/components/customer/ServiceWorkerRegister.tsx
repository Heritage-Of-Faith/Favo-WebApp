// Service worker registration — owner: Nikao (task N5 / Phase 3)
// Registers /sw.js for offline support on customer surfaces. The SW itself
// bypasses /api, /pos, /admin and all non-GET requests (see public/sw.js).
"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Avoid registering during local dev to keep HMR clean.
    if (process.env.NODE_ENV !== "production") return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Silent — offline support is progressive enhancement.
      });
    };

    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
