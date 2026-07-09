"use client";

/**
 * FavoSection — AT-143 (wireframe screen 5): "Your Favo" on the customer
 * loyalty page. Unset → prompt + Set button; set → summary line + Edit link.
 * Both open the shared FavoPicker (the same component the barista uses on the
 * POS, AT-144) against the same record.
 */

import { useState } from "react";
import FavoPicker, { formatFavoSummary } from "@/components/favo/FavoPicker";
import type { FavoView } from "@/server/favo/schema";
import type { MenuItem } from "@/lib/types";

export type FavoSectionProps = {
  customerId: string;
  menu: MenuItem[];
  initialFavo: FavoView | null;
};

export default function FavoSection({ customerId, menu, initialFavo }: FavoSectionProps) {
  const [favo, setFavoView] = useState<FavoView | null>(initialFavo);
  const [editing, setEditing] = useState(false);

  return (
    <section aria-label="Your Favo" className="flex flex-col gap-3">
      <p style={{
        fontFamily: "'DM Sans', sans-serif", fontWeight: 300, fontSize: 11,
        letterSpacing: "0.14em", textTransform: "uppercase",
        color: "var(--color-cool-steel)", margin: 0,
      }}>
        Your Favo
      </p>

      {editing ? (
        <FavoPicker
          customerId={customerId}
          title="Your Favo"
          menu={menu}
          initialFavo={favo}
          onSaved={(saved) => { setFavoView(saved); setEditing(false); }}
          onCancel={() => setEditing(false)}
        />
      ) : favo ? (
        <div className="flex items-center justify-between gap-3 rounded-[2px] border border-porcelain/15 bg-porcelain/5 px-4 py-3">
          <p className="favo-small text-porcelain m-0">{formatFavoSummary(favo, menu)}</p>
          <button type="button" onClick={() => setEditing(true)}
            className="favo-small text-porcelain underline underline-offset-4 hover:opacity-80 shrink-0 min-h-[44px]">
            Edit
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-[2px] border border-porcelain/15 bg-porcelain/5 px-4 py-3">
          <p className="favo-small text-porcelain/70 m-0">Set your usual order — one tap to reorder at the counter.</p>
          <button type="button" onClick={() => setEditing(true)}
            className="shrink-0 rounded-[var(--radius-btn)] px-4 py-2.5 min-h-[44px] favo-small font-bold uppercase"
            style={{ background: "var(--color-crimson-carrot)", color: "var(--color-porcelain)", letterSpacing: "var(--tracking-cta)" }}>
            Set your Favo
          </button>
        </div>
      )}
    </section>
  );
}
