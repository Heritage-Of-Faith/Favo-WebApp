// AT-209 — /admin/write-downs: §7.3.1's per-barista write-down block and the
// list behind it (REQ-059, REQ-124). Read only. Zero prints as 0, never
// omitted; a money figure whose audit row carries no value reads UNAVAILABLE,
// never 0. Money is integer cents, rendered by formatZar. Write-offs on a day
// the §6.0.5 queue has not cleared are marked `unapproved`.

import { formatZar } from "@/lib/format";
import {
  WRITE_OFF_REASON_LIST,
  type BaristaWriteDowns,
  type CountAndZar,
  type WriteDownKind,
  type WriteDownRow,
} from "@/server/write-downs/summary";

export type Props = {
  from: string;
  to: string;
  perBarista: BaristaWriteDowns[];
  rows: WriteDownRow[];
};

const KIND_LABEL: Record<WriteDownKind, string> = {
  comp: "Comp",
  write_off: "Deferred write-off",
  abandoned: "Abandoned order",
};

/** The enum value, readable: `unresolved_at_close` → "unresolved at close". No new wording. */
const readable = (v: string) => v.replace(/_/g, " ");

function zar(v: number | null): string {
  return v === null ? "UNAVAILABLE" : formatZar(v);
}

/** One figure: "count · value". */
function CountZar({ v }: { v: CountAndZar }) {
  return (
    <td className="px-3 py-2" style={{ fontVariantNumeric: "tabular-nums" }}>
      {v.count} · <span style={{ color: v.zar === null ? "var(--color-error)" : undefined }}>{zar(v.zar)}</span>
    </td>
  );
}

/** daily_seq does not exist yet: a short order id, the full id on hover. */
const shortId = (id: string) => (id.length > 8 ? `${id.slice(0, 8)}…` : id);

const cardStyle = { borderColor: "var(--color-border-subtle)" };
const headRow = "border-b favo-caption";
const headStyle = { borderColor: "var(--color-border-subtle)", color: "var(--color-text-muted)" };
const bodyRow = "border-b last:border-0 favo-small align-top";
const noteStyle = { color: "var(--color-text-muted)", textTransform: "none" as const, letterSpacing: 0 };

export default function WriteDownsReport({ from, to, perBarista, rows }: Props) {
  return (
    <div className="space-y-8">
      <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Period">
        <label className="flex flex-col gap-1 favo-small">
          From
          <input type="date" name="from" defaultValue={from} className="h-11 rounded-[var(--radius-btn)] border px-2 text-base bg-[color:var(--color-surface)]" />
        </label>
        <label className="flex flex-col gap-1 favo-small">
          To
          <input type="date" name="to" defaultValue={to} className="h-11 rounded-[var(--radius-btn)] border px-2 text-base bg-[color:var(--color-surface)]" />
        </label>
        <button type="submit" className="h-11 rounded-[var(--radius-btn)] border px-4 favo-small transition-colors hover:bg-[color:var(--color-porcelain-soft)]">
          Show
        </button>
      </form>

      <section className="space-y-3" aria-labelledby="wd-per-barista">
        <h2 id="wd-per-barista" className="admin-section-title" style={{ color: "var(--color-text-strong)" }}>
          Per barista · {from} to {to}
        </h2>
        <p className="favo-caption" style={noteStyle}>Each figure is count · value.</p>
        <div className="overflow-x-auto rounded-[var(--radius-card)] border" style={cardStyle}>
          <table className="w-full text-left">
            <thead>
              <tr className={headRow} style={headStyle}>
                <th className="px-3 py-2">Barista</th>
                <th className="px-3 py-2">Comps</th>
                <th className="px-3 py-2">Deferred write-offs</th>
                {WRITE_OFF_REASON_LIST.map((r) => (
                  <th key={r} className="px-3 py-2">{readable(r)}</th>
                ))}
                <th className="px-3 py-2">unapproved</th>
                <th className="px-3 py-2">Abandoned orders</th>
              </tr>
            </thead>
            <tbody>
              {perBarista.map((b) => (
                <tr key={b.staffId} className={bodyRow} style={cardStyle}>
                  <td className="px-3 py-2" style={{ color: "var(--color-text-strong)" }}>{b.name}</td>
                  <CountZar v={b.comps} />
                  <CountZar v={b.writeOffs} />
                  {WRITE_OFF_REASON_LIST.map((r) => (
                    <CountZar key={r} v={b.writeOffs.byReason[r]} />
                  ))}
                  <CountZar v={b.writeOffs.unapproved} />
                  <td className="px-3 py-2" style={{ fontVariantNumeric: "tabular-nums" }}>{b.abandoned.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="wd-list">
        <h2 id="wd-list" className="admin-section-title" style={{ color: "var(--color-text-strong)" }}>
          Comps, write-offs and abandoned orders
        </h2>
        {rows.length === 0 ? (
          <p className="rounded-[var(--radius-card)] border p-6 text-center favo-small" style={{ ...cardStyle, color: "var(--color-text-muted)" }}>
            No write-downs this period
          </p>
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius-card)] border" style={cardStyle}>
            <table className="w-full text-left">
              <thead>
                <tr className={headRow} style={headStyle}>
                  <th className="px-3 py-2">Revenue day</th>
                  <th className="px-3 py-2">Kind</th>
                  <th className="px-3 py-2">Barista</th>
                  <th className="px-3 py-2">Order</th>
                  <th className="px-3 py-2">Value</th>
                  <th className="px-3 py-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.auditId} className={bodyRow} style={cardStyle}>
                    <td className="px-3 py-2">{r.revenueDay}</td>
                    <td className="px-3 py-2">
                      {KIND_LABEL[r.kind]}
                      {r.unapproved && (
                        <span className="block favo-caption" style={{ ...noteStyle, color: "var(--color-warning)" }}>
                          unapproved
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.staffName ?? r.staffId ?? "unattributed"}
                      {r.onBehalfOfName && (
                        <span className="block favo-caption" style={noteStyle}>
                          admin PIN: {r.onBehalfOfName}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs" title={r.orderId}>{shortId(r.orderId)}</td>
                    <td className="px-3 py-2" style={{ fontVariantNumeric: "tabular-nums", color: r.kind !== "abandoned" && r.valueZar === null ? "var(--color-error)" : undefined }}>
                      {r.kind === "abandoned" ? "—" : zar(r.valueZar)}
                    </td>
                    <td className="px-3 py-2">
                      {r.reason === null ? "no reason recorded" : r.kind === "write_off" ? readable(r.reason) : r.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
