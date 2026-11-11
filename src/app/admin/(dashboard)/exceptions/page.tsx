// /admin/exceptions — the admin exception list (REQ-039, T5 step 5, §6.0.5
// REPLAY_TOO_OLD: "Not shown to the barista; surfaced on the admin exception
// list"). One section today: offline orders rejected at replay for being more
// than 12 hours old. No order was created for them and no stock moved.
// Admin only: the (dashboard) layout and proxy.ts gate the route, and
// listReplayTooOld authorizes "admin" itself. Read only.
//
// The headings, column names, explanatory line and empty-state line are not
// PRD copy.

import { listReplayTooOld } from "@/server/actions/exceptions";
import { formatDate, formatZar } from "@/lib/format";

export const metadata = { title: "Exception list" };
export const dynamic = "force-dynamic";

function age(minutes: number | null): string {
  if (minutes === null) return "—";
  const h = Math.floor(minutes / 60);
  return `${h} h ${minutes % 60} min`;
}

export default async function ExceptionsPage() {
  const res = await listReplayTooOld();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="admin-page-title">Exception list</h1>
      </header>

      <section className="space-y-3">
        <h2 className="favo-subhead">Offline orders too old to replay</h2>
        <p className="favo-small" style={{ color: "var(--color-text-muted)" }}>
          Rung while the till was offline and received more than 12 hours later, so they were not recorded.
          No order was created and no stock was deducted.
        </p>

        {!res.ok ? (
          <p className="favo-small" style={{ color: "var(--color-error)" }}>{res.message}</p>
        ) : res.data.length === 0 ? (
          <p className="favo-small" style={{ color: "var(--color-text-muted)" }}>No offline orders rejected.</p>
        ) : (
          <table className="w-full favo-small">
            <thead>
              <tr className="text-left">
                <th className="px-3 py-2">Rung</th>
                <th className="px-3 py-2">Received</th>
                <th className="px-3 py-2 text-right">Age</th>
                <th className="px-3 py-2">Barista</th>
                <th className="px-3 py-2 text-right">Items</th>
                <th className="px-3 py-2 text-right">Till total</th>
                <th className="px-3 py-2">Ref</th>
              </tr>
            </thead>
            <tbody>
              {res.data.map((r) => (
                <tr key={r.auditId} className="border-t" style={{ borderColor: "var(--color-border, rgba(0,0,0,0.1))" }}>
                  <td className="px-3 py-2">{r.clientTimestamp ? formatDate(r.clientTimestamp) : "—"}</td>
                  <td className="px-3 py-2">{formatDate(r.receivedAt)}</td>
                  <td className="px-3 py-2 text-right">{age(r.ageMinutes)}</td>
                  <td className="px-3 py-2">{r.baristaName ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{r.itemCount}</td>
                  <td className="px-3 py-2 text-right">{r.clientTotalZar === null ? "—" : formatZar(r.clientTotalZar)}</td>
                  <td className="px-3 py-2" title={r.clientUuid}>{r.clientUuid.slice(0, 8)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
