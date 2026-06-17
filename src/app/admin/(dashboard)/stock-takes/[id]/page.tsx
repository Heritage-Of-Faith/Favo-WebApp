// Stock take walk-lots / summary — task A9.
// Resolves a take by id and hands it to the client runner. Docs: API.md.

import Link from "next/link";
import type { Route } from "next";
import { getStockTake } from "@/server/actions/stock-takes";
import StockTakeRunner from "@/components/admin/StockTakeRunner";

export default async function StockTakeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const res = await getStockTake(id);

  if (!res.ok) {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <p className="favo-small" style={{ color: "var(--color-error)" }}>
          {res.message}
        </p>
        <Link
          href={"/admin/stock-takes" as Route}
          className="inline-flex min-h-10 items-center rounded-[var(--radius-btn)] border px-4 favo-small"
          style={{ borderColor: "var(--color-border-subtle)", color: "var(--color-text-strong)" }}
        >
          ← Back to stock takes
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link
        href={"/admin/stock-takes" as Route}
        className="inline-flex items-center gap-1 favo-small transition-colors hover:opacity-80"
        style={{ color: "var(--color-text-muted)" }}
      >
        ← Stock takes
      </Link>
      <StockTakeRunner initialTake={res.data.take} />
    </div>
  );
}
