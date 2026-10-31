"use client";
// REQ-048 / L29: shown instead of any enable/subscribed control on an iPhone
// that has not installed the PWA. The subscribed state is unreachable here.

import { INSTALL_STEP_COPY } from "@/lib/push/install-step";

export default function InstallStep() {
  return (
    <div role="note" data-testid="install-step" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <p style={{ margin: 0, fontWeight: 700, color: "var(--color-porcelain)" }}>
        {INSTALL_STEP_COPY.heading}
      </p>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "var(--color-porcelain)", opacity: 0.85 }}>
        {INSTALL_STEP_COPY.steps}
      </p>
    </div>
  );
}
