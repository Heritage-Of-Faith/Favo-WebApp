// WalletTransactionList — owner: Nikao (AT-69, N17)
// Read-only list of wallet transactions. No mutation entry points (L05/L16).

import type { CSSProperties } from "react";
import type { WalletTransaction } from "@/lib/customer/contract";
import { formatZar, formatDate } from "@/lib/format";

export interface WalletTransactionListProps {
  transactions: WalletTransaction[];
}

const S: Record<string, CSSProperties> = {
  empty: {
    fontFamily: "'DM Sans', sans-serif",
    fontSize: 14,
    lineHeight: 1.7,
    color: "var(--color-porcelain)",
    opacity: 0.6,
    padding: "24px 0",
  },
  row: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    padding: "14px 0",
    borderBottom: "1px solid rgba(247,246,242,0.1)",
    gap: 12,
  },
  kind: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 300,
    fontSize: 10,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    color: "var(--color-cool-steel)",
    margin: "0 0 2px",
  },
  desc: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 400,
    fontSize: 14,
    color: "var(--color-porcelain)",
    opacity: 0.85,
    margin: 0,
  },
  date: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 300,
    fontSize: 12,
    color: "var(--color-cool-steel)",
    margin: "2px 0 0",
  },
};

function deltaStyle(deltaZar: number): CSSProperties {
  return {
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
    fontWeight: 700,
    fontSize: 18,
    letterSpacing: "0.02em",
    color: deltaZar >= 0 ? "var(--color-success)" : "var(--color-porcelain)",
    whiteSpace: "nowrap",
    flexShrink: 0,
  };
}

const KIND_LABEL: Record<string, string> = {
  topup: "Top-up",
  spend: "Spend",
  refund: "Refund",
  adjustment: "Adjustment",
};

export default function WalletTransactionList({ transactions }: WalletTransactionListProps) {
  if (transactions.length === 0) {
    return (
      <p style={S.empty}>
        No transactions yet. Your wallet history will appear here after your first top-up.
      </p>
    );
  }

  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {transactions.map((tx) => (
        <li key={tx.id} style={S.row}>
          <div>
            <p style={S.kind}>{KIND_LABEL[tx.kind] ?? tx.kind}</p>
            {tx.description && <p style={S.desc}>{tx.description}</p>}
            <p style={S.date}>{formatDate(tx.at)}</p>
          </div>
          <span style={deltaStyle(tx.deltaZar)}>
            {tx.deltaZar >= 0 ? "+" : ""}
            {formatZar(Math.abs(tx.deltaZar))}
          </span>
        </li>
      ))}
    </ul>
  );
}
