/**
 * §7.3.1's write-down block on the weekly ops summary — REQ-124, REQ-145.
 * Per barista, with the PRD's row names: Comps (count · value), Deferred
 * write-offs (count · value, split by reason), Abandoned orders (count) and
 * Vouchers (count · value, so the average per slip is readable at a glance).
 * Zero prints as 0, never omitted; a value whose source row carried none
 * reads UNAVAILABLE, never 0. Integer cents, rendered by formatZar.
 */

import { formatZar } from "@/lib/format";
import { UNAVAILABLE } from "@/lib/cost-state";
import { WRITE_OFF_REASON_LIST, type CountAndZar } from "@/server/write-downs/summary";
import type { BaristaWriteDownLine } from "@/server/write-downs/vouchers";

/** "3 · R60,00" — or "1 · UNAVAILABLE" when a contributing row had no value. */
export function countZarText(v: CountAndZar): string {
  return `${v.count} · ${v.zar === null ? UNAVAILABLE : formatZar(v.zar)}`;
}

/** The enum value, readable: `unresolved_at_close` → "unresolved at close". */
const readable = (v: string) => v.replace(/_/g, " ");

function Line({ label, value, indent }: { label: string; value: string; indent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-cool-steel/10 py-2">
      <span className={`favo-small text-cool-steel${indent ? " pl-4" : ""}`}>{label}</span>
      <span className="favo-body text-porcelain text-right" style={{ fontVariantNumeric: "tabular-nums" }}>
        {value}
      </span>
    </div>
  );
}

export default function WeeklyWriteDowns({ perBarista }: { perBarista: readonly BaristaWriteDownLine[] }) {
  return (
    <section>
      <h2 className="favo-label text-cool-steel mb-2">Write-downs per barista</h2>
      <div className="flex flex-col gap-4">
        {perBarista.map((b) => (
          <div key={b.staffId} data-staff-id={b.staffId}>
            <h3 className="favo-small text-porcelain mb-1">{b.name}</h3>
            <Line label="Comps" value={countZarText(b.comps)} />
            <Line label="Deferred write-offs" value={countZarText(b.writeOffs)} />
            {WRITE_OFF_REASON_LIST.map((r) => (
              <Line key={r} label={readable(r)} value={countZarText(b.writeOffs.byReason[r])} indent />
            ))}
            <Line label="Abandoned orders" value={String(b.abandoned.count)} />
            <Line label="Vouchers" value={countZarText(b.vouchers)} />
          </div>
        ))}
      </div>
    </section>
  );
}
