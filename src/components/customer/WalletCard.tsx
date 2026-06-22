// WalletCard — owner: Nikao (task N13, AT-65)
// Presentational + server-safe. Read-only: top-ups happen at the counter (L05/L16).

import type { CSSProperties } from "react";
import { formatZar } from "@/lib/format";

export interface WalletCardProps {
  balanceZar: number;
}

const card: CSSProperties = {
  backgroundColor: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(247,246,242,0.12)",
  borderRadius: 2,
  padding: 24,
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const label: CSSProperties = {
  fontFamily: "'DM Sans', sans-serif",
  fontWeight: 300,
  fontSize: 11,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--color-cool-steel)",
  margin: 0,
};

export default function WalletCard({ balanceZar }: WalletCardProps) {
  return (
    <section style={card} aria-label="Wallet balance">
      <p style={label}>Wallet</p>
      <p
        style={{
          fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
          fontWeight: 900,
          fontSize: "clamp(2rem, 7vw, 2.75rem)",
          lineHeight: 0.95,
          color: "var(--color-porcelain)",
          margin: 0,
        }}
      >
        {formatZar(balanceZar)}
      </p>
      <p
        style={{
          fontFamily: "'DM Sans', sans-serif",
          fontWeight: 400,
          fontSize: 13,
          lineHeight: 1.6,
          color: "var(--color-porcelain)",
          opacity: 0.65,
          margin: 0,
        }}
      >
        Top up at the counter.
      </p>
    </section>
  );
}
