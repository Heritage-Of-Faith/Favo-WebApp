// AT-209 — /admin/write-downs, the comps-review surface (§7.3.1, REQ-059,
// REQ-124). Admin only: the (dashboard) layout and proxy.ts gate the route,
// and getWriteDownsReport authorizes "admin" itself. Read only.
// The §6.0.5 write-off approval queue renders above it from the layout banner.

import WriteDownsReport from "@/components/admin/WriteDownsReport";
import { getWriteDownsReport } from "@/server/actions/write-downs-report";

export const metadata = { title: "Write-downs" };
export const dynamic = "force-dynamic";

export default async function WriteDownsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { from, to } = await searchParams;
  const res = await getWriteDownsReport({ from, to });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="admin-page-title">Write-downs</h1>
        <p className="mt-1 favo-small" style={{ color: "var(--color-text-muted)" }}>
          Comps, deferred write-offs and abandoned orders, per barista, by revenue day.
        </p>
      </header>

      {res.ok ? (
        <WriteDownsReport {...res.data} />
      ) : (
        <p className="favo-small" style={{ color: "var(--color-error)" }}>
          {res.message}
        </p>
      )}
    </div>
  );
}
