// LoyaltyCard — owner: Nikao (task N13, AT-65)
// Presentational + server-safe (no client hooks). The points integer is the
// largest typographic element on the card (acceptance criterion).
// Read-only: redemption happens at the counter, never here (L05 / L06 / L16).

import type { CSSProperties } from "react";

/** Points needed for one R20 reward (L06: 100 pts = R20 off). */
const REDEEM_AT = 100;

export interface LoyaltyCardProps {
  points: number;
}

const card: CSSProperties = {
  backgroundColor: "rgba(247,246,242,0.05)",
  border: "1px solid rgba(247,246,242,0.1)",
  borderRadius: 2,
  padding: 24,
  display: "flex",
  flexDirection: "column",
  gap: 12,
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

export default function LoyaltyCard({ points }: LoyaltyCardProps) {
  const safePoints = Math.max(0, Math.floor(points));
  const canRedeem = safePoints >= REDEEM_AT;
  const intoCycle = safePoints % REDEEM_AT;
  const toNext = canRedeem && intoCycle === 0 ? 0 : REDEEM_AT - intoCycle;
  const progressPct = Math.min(100, (intoCycle / REDEEM_AT) * 100);

  return (
    <section style={card} aria-label="Loyalty points">
      <p style={label}>Loyalty points</p>

      {/* Hero number — the largest single element on the card. */}
      <p
        style={{
          fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
          fontWeight: 900,
          fontSize: "clamp(3rem, 12vw, 5rem)",
          lineHeight: 0.9,
          letterSpacing: "0.02em",
          color: "var(--color-porcelain)",
          margin: 0,
        }}
      >
        {safePoints}
      </p>

      {/* Progress to the next R20 reward. */}
      <div
        aria-hidden="true"
        style={{
          height: 6,
          borderRadius: 999,
          backgroundColor: "rgba(247,246,242,0.12)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${canRedeem ? 100 : progressPct}%`,
            height: "100%",
            backgroundColor: "var(--color-crimson-carrot)",
          }}
        />
      </div>

      <p
        style={{
          fontFamily: "'DM Sans', sans-serif",
          fontWeight: 400,
          fontSize: 14,
          lineHeight: 1.6,
          color: "var(--color-porcelain)",
          opacity: 0.75,
          margin: 0,
        }}
      >
        {canRedeem
          ? "You've got a R20 reward waiting — redeem it at the counter."
          : `${toNext} ${toNext === 1 ? "point" : "points"} to your next R20 reward.`}
      </p>
    </section>
  );
}
