// WalletCard — owner: Nikao (task N13, AT-65)
// Presentational + server-safe. Shows the monetary value of the customer's loyalty points.
// Formula: 100 pts = R20 (whole redemption units only, matching REDEEM_AT in LoyaltyCard).

import type { CSSProperties } from "react";
import { formatZar } from "@/lib/format";

export interface WalletCardProps {
  loyaltyPoints: number;
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

export default function WalletCard({ loyaltyPoints }: WalletCardProps) {
  const valueZar = Math.floor(loyaltyPoints / 100) * 2000;
  const canRedeem = loyaltyPoints >= 100;

  return (
    <section style={card} aria-label="Points value">
      <p style={label}>Points value</p>
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
        {formatZar(valueZar)}
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
        {canRedeem ? "Redeem at the counter." : "Not enough points to redeem yet."}
      </p>
    </section>
  );
}
