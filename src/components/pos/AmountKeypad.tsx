"use client";

/**
 * AmountKeypad — task M16.
 * Rand-entry numeric pad with preset chips. Reports the value to the parent in
 * integer cents (never floats — money is always cents per BUSINESS_RULES.md).
 */

import { Delete } from "lucide-react";
import { formatZar } from "@/lib/format";

const PRESETS_ZAR = [50, 100, 200, 500]; // rand presets
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "del"] as const;

export type Props = {
  /** Current value in integer cents. */
  valueCents: number;
  /** Called with the new value in integer cents. */
  onChange: (cents: number) => void;
};

export default function AmountKeypad({ valueCents, onChange }: Props) {
  // Treat the entered digits as a cents register (e.g. tapping 1,5,0,0 → R15,00).
  function pressDigit(d: string) {
    const next = `${valueCents}${d}`.replace(/^0+/, "");
    const cents = Math.min(parseInt(next || "0", 10), 99_999_99); // cap R99,999.99
    onChange(Number.isNaN(cents) ? 0 : cents);
  }
  function backspace() {
    onChange(Math.floor(valueCents / 10));
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Display */}
      <div className="rounded-[var(--radius-btn)] border border-cool-steel/30 bg-porcelain/10 px-4 py-3 text-center">
        <span className="favo-h2 text-porcelain">{formatZar(valueCents)}</span>
      </div>

      {/* Preset chips */}
      <div className="flex gap-2">
        {PRESETS_ZAR.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => onChange(r * 100)}
            className="flex-1 rounded-[var(--radius-pill)] border border-cool-steel/30 py-2 favo-small text-porcelain transition-colors hover:bg-porcelain/10 min-h-[40px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot"
          >
            R{r}
          </button>
        ))}
      </div>

      {/* Numeric pad */}
      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((k) =>
          k === "del" ? (
            <button
              key="del"
              type="button"
              onClick={backspace}
              aria-label="Delete last digit"
              className="flex items-center justify-center rounded-[var(--radius-btn)] border border-cool-steel/30 bg-porcelain/5 py-3 min-h-[52px] text-porcelain transition-colors hover:bg-porcelain/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot"
            >
              <Delete size={18} strokeWidth={2.25} />
            </button>
          ) : (
            <button
              key={k}
              type="button"
              onClick={() => pressDigit(k)}
              aria-label={`Digit ${k}`}
              className="rounded-[var(--radius-btn)] border border-cool-steel/30 bg-porcelain/5 py-3 min-h-[52px] text-porcelain transition-colors hover:bg-porcelain/10 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot"
              style={{ fontFamily: "var(--font-sans)", fontSize: "var(--text-h3)", fontWeight: 600 }}
            >
              {k}
            </button>
          )
        )}
      </div>
    </div>
  );
}
