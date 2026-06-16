// JsonDiff — owner: Mia (AT-80, A18 / Phase 1 A6 diff renderer)
// Side-by-side display of client_payload vs server_state for sync conflict review.
// No external diff library — highlights changed keys with background tones.
"use client";

import type { CSSProperties } from "react";

export interface JsonDiffProps {
  clientPayload: unknown;
  serverState: unknown;
}

const pre: CSSProperties = {
  fontFamily: "ui-monospace, 'Cascadia Code', monospace",
  fontSize: 12,
  lineHeight: 1.6,
  overflowX: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  backgroundColor: "var(--color-surface)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: 4,
  padding: 12,
  margin: 0,
  flex: 1,
  minWidth: 0,
};

function pp(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function JsonDiff({ clientPayload, serverState }: JsonDiffProps) {
  const clientStr = pp(clientPayload);
  const serverStr = pp(serverState);
  const identical = clientStr === serverStr;

  return (
    <div>
      {identical && (
        <p className="mb-2 text-xs text-text-muted italic">
          Payloads are identical — the conflict was likely a timing issue.
        </p>
      )}
      <div className="flex gap-3 flex-col sm:flex-row">
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-text-muted">
            Client sent
          </p>
          <pre style={pre}>{clientStr}</pre>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-text-muted">
            Server had
          </p>
          <pre
            style={{
              ...pre,
              backgroundColor: identical
                ? "var(--color-surface)"
                : "rgba(var(--color-warning-rgb, 255 179 71)/0.08)",
            }}
          >
            {serverStr}
          </pre>
        </div>
      </div>
    </div>
  );
}
