// CustomerTable — owner: Mia (AT-78, A16)
// Searchable customer list for admin. Read-only — no mutation entry points.
"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { listCustomers, type CustomerListItem } from "@/server/actions/customers";
import { formatZar, formatDate } from "@/lib/format";

export interface CustomerTableProps {
  initialQuery?: string;
}

export default function CustomerTable({ initialQuery = "" }: CustomerTableProps) {
  const [query, setQuery] = useState(initialQuery);
  const [rows, setRows] = useState<CustomerListItem[]>([]);
  const [isPending, startTransition] = useTransition();
  const [loaded, setLoaded] = useState(false);

  const fetchRows = useCallback((q: string) => {
    startTransition(async () => {
      const res = await listCustomers({ query: q, limit: 100 });
      if (res.ok) setRows(res.data);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    fetchRows(initialQuery);
  }, [fetchRows, initialQuery]);

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      fetchRows(query);
    },
    [fetchRows, query]
  );

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or email…"
          aria-label="Search customers"
          className="flex-1 max-w-sm rounded border border-border-subtle bg-surface px-3 py-2 text-sm text-text-strong focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="submit"
          disabled={isPending}
          className="rounded border border-border-subtle bg-elevated px-4 py-2 text-sm font-medium text-text-strong hover:bg-surface disabled:opacity-40"
        >
          {isPending ? "Searching…" : "Search"}
        </button>
      </form>

      {!loaded ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-text-muted">No customers found.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border-subtle">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-elevated">
                <th className="px-4 py-3 text-left font-medium text-text-muted">Name</th>
                <th className="px-4 py-3 text-left font-medium text-text-muted">Email</th>
                <th className="px-4 py-3 text-left font-medium text-text-muted">Phone</th>
                <th className="px-4 py-3 text-right font-medium text-text-muted">Points</th>
                <th className="px-4 py-3 text-right font-medium text-text-muted">Wallet</th>
                <th className="px-4 py-3 text-left font-medium text-text-muted">Joined</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-border-subtle last:border-0 hover:bg-elevated/50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <a
                      href={`/admin/customers/${c.id}`}
                      className="font-medium text-text-strong hover:underline"
                    >
                      {c.name}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-text-muted">{c.email ?? "—"}</td>
                  <td className="px-4 py-3 text-text-muted">{c.phone ?? "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{c.loyaltyPoints}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatZar(c.walletZar)}
                  </td>
                  <td className="px-4 py-3 text-text-muted">
                    {formatDate(c.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-text-muted">
        Showing {rows.length} customer{rows.length !== 1 ? "s" : ""} — read-only
        view.
      </p>
    </div>
  );
}
