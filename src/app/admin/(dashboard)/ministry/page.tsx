// REQ-122 · PRD §7.2 — /admin/ministry, the ministry rollup: one view over a
// selected week or month. Admin only (§10.7: getMinistryRollup admin ✔ only):
// proxy.ts and the (dashboard) layout gate the route, and getMinistryRollup
// authorizes "admin" itself. Reads only.

import MinistryRollupView from "@/components/admin/MinistryRollupView";
import { getMinistryRollup } from "@/server/actions/ministry";
import { revenueDay } from "@/lib/format";
import { isCalendarDay, periodContaining, type RollupPeriodKind } from "@/lib/ministry-period";

export const metadata = { title: "Ministry rollup" };
export const dynamic = "force-dynamic";

export default async function MinistryRollupPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; date?: string }>;
}) {
  const sp = await searchParams;
  const periodKind: RollupPeriodKind = sp.period === "week" ? "week" : "month";
  const date = sp.date && isCalendarDay(sp.date) ? sp.date : revenueDay();
  const { from, to } = periodContaining(periodKind, date);
  const res = await getMinistryRollup(from, to);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="admin-page-title">Ministry rollup</h1>
        <p className="mt-1 favo-small" style={{ color: "var(--color-text-muted)" }}>
          Weekday cost, Sunday revenue and cost, and events, netted in one place.
        </p>
      </header>

      {res.ok ? (
        <MinistryRollupView {...res.data} periodKind={periodKind} date={date} />
      ) : (
        <p className="favo-small" role="alert" style={{ color: "var(--color-error)" }}>
          {res.code === "UNKNOWN_PAYMENT_MODE" ? `${res.code}: ${res.message}` : res.message}
        </p>
      )}
    </div>
  );
}
