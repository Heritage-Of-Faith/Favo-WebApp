"use client";

// L03 free weekday cup — the barista's view of it (AT-183 / AT-184).
// The cup is applied automatically at ring-up; the barista taps only to
// decline it (REQ-024, PRD §6: "auto-applied, one tap only to decline").

import { Loader2 } from "lucide-react";

export default function FreeCupRow({ busy, onDecline }: { busy: boolean; onDecline: () => void }) {
  return (
    <div
      className="flex items-center justify-between gap-2 rounded-[2px] border border-cool-steel/20 bg-coffee-bean/5 px-2 py-1"
      role="status"
    >
      <span className="favo-caption text-coffee-bean">Free cup applied</span>
      <button
        type="button"
        onClick={onDecline}
        disabled={busy}
        className="favo-caption min-h-[44px] px-2 text-cool-steel underline underline-offset-2 hover:text-coffee-bean disabled:opacity-40"
      >
        {busy ? <Loader2 size={12} strokeWidth={2} className="animate-spin" /> : "Decline"}
      </button>
    </div>
  );
}
