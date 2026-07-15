// Container yield report — real cups-per-container tracking for milk & beans.
// Replaces the old "expected cup yield" purchase model: nothing is predicted,
// this page shows what each bottle/bag actually produced.
// Docs: docs/API.md (getContainerYields)

import { getContainerYields } from "@/server/actions/inventory";
import YieldReport from "@/components/admin/YieldReport";

export const metadata = { title: "Yield" };
export const dynamic = "force-dynamic";

export default async function YieldPage() {
  const res = await getContainerYields();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="admin-page-title">Yield</h1>
        <p className="mt-1 favo-small" style={{ color: "var(--color-text-muted)" }}>
          Real cups made per milk bottle / coffee bag — no predicted yield, just what each container actually gave.
        </p>
      </header>

      {res.ok ? (
        <YieldReport yields={res.data.yields} />
      ) : (
        <p className="favo-small" style={{ color: "var(--color-error)" }}>
          {res.message}
        </p>
      )}
    </div>
  );
}
