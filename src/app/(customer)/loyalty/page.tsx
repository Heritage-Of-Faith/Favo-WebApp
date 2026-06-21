// Loyalty history page — owner: Nikao (AT-128, LOY-8)
// Route: /loyalty (inside (customer) route group — customer auth gate)
// Server component. Read-only — displays loyalty history + current balance.

import type { CSSProperties } from "react";
import { redirect } from "next/navigation";
import { listCustomerLoyaltyHistory } from "@/server/actions/customer";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const S: Record<string, CSSProperties> = {
  page: {
    backgroundColor: "var(--color-coffee-bean)",
    minHeight: "100dvh",
    display: "flex",
    flexDirection: "column",
  },
  nav: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "20px clamp(20px, 5vw, 40px)",
    borderBottom: "1px solid rgba(247,246,242,0.1)",
  },
  wordmark: {
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
    fontWeight: 900,
    fontSize: 22,
    letterSpacing: "0.22em",
    textTransform: "uppercase",
    color: "var(--color-porcelain)",
    textDecoration: "none",
    lineHeight: 1,
  },
  back: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 700,
    fontSize: 11,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "var(--color-cool-steel)",
    textDecoration: "none",
  },
  main: {
    flex: 1,
    width: "100%",
    maxWidth: 620,
    margin: "0 auto",
    padding: "clamp(28px, 5vw, 48px) clamp(20px, 5vw, 40px)",
    display: "flex",
    flexDirection: "column",
    gap: 32,
  },
  eyebrow: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 300,
    fontSize: 11,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: "var(--color-cool-steel)",
    margin: "0 0 8px",
  },
  balance: {
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
    fontWeight: 900,
    fontSize: "clamp(3rem, 12vw, 5rem)",
    lineHeight: 0.9,
    letterSpacing: "0.02em",
    color: "var(--color-porcelain)",
    margin: 0,
  },
  balanceSub: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 400,
    fontSize: 13,
    color: "var(--color-cool-steel)",
    margin: "8px 0 0",
  },
  earnInfo: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 400,
    fontSize: 13,
    lineHeight: 1.6,
    color: "var(--color-porcelain)",
    opacity: 0.55,
    margin: 0,
    padding: "16px 0",
    borderTop: "1px solid rgba(247,246,242,0.08)",
  },
  sectionLabel: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 300,
    fontSize: 11,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: "var(--color-cool-steel)",
    margin: "0 0 12px",
  },
  txList: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
  },
  txRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 0",
    borderBottom: "1px solid rgba(247,246,242,0.06)",
  },
  txLeft: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  txRight: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 2,
  },
  txDelta: {
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
    fontWeight: 700,
    fontSize: 18,
    letterSpacing: "0.02em",
  },
  txBalance: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 400,
    fontSize: 11,
    color: "var(--color-cool-steel)",
  },
  txDate: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 400,
    fontSize: 11,
    color: "var(--color-cool-steel)",
    margin: "2px 0 0",
  },
  txMeta: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  empty: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 400,
    fontSize: 14,
    color: "var(--color-porcelain)",
    opacity: 0.45,
    textAlign: "center",
    padding: "32px 0",
  },
  pagination: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 16,
    borderTop: "1px solid rgba(247,246,242,0.08)",
  },
  pageLink: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 700,
    fontSize: 11,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "var(--color-cool-steel)",
    textDecoration: "none",
  },
  pageInfo: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 400,
    fontSize: 11,
    color: "var(--color-cool-steel)",
    opacity: 0.65,
  },
};

const KIND_COLORS: Record<string, string> = {
  earn: "var(--color-teal, #2dd4bf)",
  redeem: "#f97316",
  adjustment: "var(--color-cool-steel, #8b99a6)",
  expiry: "#ef4444",
};

const KIND_LABELS: Record<string, string> = {
  earn: "Earn",
  redeem: "Redeem",
  adjustment: "Adj",
  expiry: "Expiry",
};

function KindBadge({ kind }: { kind: string }) {
  const color = KIND_COLORS[kind] ?? "var(--color-cool-steel)";
  return (
    <span
      style={{
        fontFamily: "'DM Sans', sans-serif",
        fontWeight: 700,
        fontSize: 10,
        letterSpacing: "0.10em",
        textTransform: "uppercase",
        color,
        border: `1px solid ${color}`,
        borderRadius: 4,
        padding: "2px 6px",
        whiteSpace: "nowrap",
        opacity: 0.9,
      }}
    >
      {KIND_LABELS[kind] ?? kind}
    </span>
  );
}

export default async function LoyaltyPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(0, parseInt(params.page ?? "0", 10) || 0);

  const res = await listCustomerLoyaltyHistory(page);
  if (!res.ok) {
    if (res.code === "UNAUTHORIZED") redirect("/login");
    // Non-auth failure: render with defaults.
  }

  const data = res.ok ? res.data : null;
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const currentBalance = data?.currentBalance ?? 0;
  const PAGE_SIZE = 20;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const hasPrev = page > 0;
  const hasNext = page < totalPages - 1;

  return (
    <div style={S.page}>
      <nav style={S.nav}>
        <a href="/" style={S.wordmark}>FAVO</a>
        <a href="/customer" style={S.back}>← Back</a>
      </nav>

      <main style={S.main}>
        {/* Balance hero */}
        <section aria-label="Loyalty balance">
          <p style={S.eyebrow}>Loyalty points</p>
          <p style={S.balance}>{currentBalance}</p>
          <p style={S.balanceSub}>pts</p>
          <p style={S.earnInfo}>
            Earn 5 pts per R10 spent. Redeem 100 pts = R20 off.
          </p>
        </section>

        {/* Transaction history */}
        <section>
          <p style={S.sectionLabel}>Transaction history</p>

          {rows.length === 0 ? (
            <p style={S.empty}>No loyalty transactions yet.</p>
          ) : (
            <div style={S.txList}>
              {rows.map((row) => {
                const isPositive = row.delta >= 0;
                const deltaColor = isPositive
                  ? KIND_COLORS.earn
                  : KIND_COLORS.redeem;
                const deltaText = isPositive
                  ? `+${row.delta}`
                  : `${row.delta}`;

                return (
                  <div key={row.id} style={S.txRow}>
                    <div style={S.txLeft}>
                      <KindBadge kind={row.kind} />
                      <div style={S.txMeta}>
                        {row.reason && (
                          <span
                            style={{
                              fontFamily: "'DM Sans', sans-serif",
                              fontWeight: 400,
                              fontSize: 13,
                              color: "var(--color-porcelain)",
                              opacity: 0.8,
                            }}
                          >
                            {row.reason}
                          </span>
                        )}
                        <span style={S.txDate}>{formatDate(row.at)}</span>
                      </div>
                    </div>

                    <div style={S.txRight}>
                      <span
                        style={{
                          ...S.txDelta,
                          color: deltaColor,
                        }}
                      >
                        {deltaText} pts
                      </span>
                      <span style={S.txBalance}>
                        Balance: {row.runningBalance} pts
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={S.pagination}>
              {hasPrev ? (
                <a href={`/loyalty?page=${page - 1}`} style={S.pageLink}>
                  ← Previous
                </a>
              ) : (
                <span style={{ ...S.pageLink, opacity: 0.3 }}>← Previous</span>
              )}
              <span style={S.pageInfo}>
                Page {page + 1} of {totalPages}
              </span>
              {hasNext ? (
                <a href={`/loyalty?page=${page + 1}`} style={S.pageLink}>
                  Next →
                </a>
              ) : (
                <span style={{ ...S.pageLink, opacity: 0.3 }}>Next →</span>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
