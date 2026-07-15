// LoyaltyCard — owner: Nikao (task N13, AT-65)
// Presentational + server-safe (no client hooks). Money-first hero, matching
// the POS/loyalty-page rule (AT-139, POS_REBUILD_DECISIONS.md): the Rand
// value is the largest element, points are the subtext — never the reverse.
// Read-only: redemption happens at the counter, never here (L05 / L06 / L16).

import type { CSSProperties } from "react";
import { formatZar } from "@/lib/format";
import { pointsValueZar } from "@/server/loyalty/calc";

/** Points needed for one R20 reward (L06: 100 pts = R20 off). */
const REDEEM_AT = 100;

export interface LoyaltyCardProps {
  points: number;
}

const card: CSSProperties = {
  backgroundColor: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(247,246,242,0.12)",
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
  const valueZar = pointsValueZar(safePoints);
  const redeemableUnits = Math.floor(safePoints / REDEEM_AT);
  const intoCycle = safePoints % REDEEM_AT;
  const progressPct = (intoCycle / REDEEM_AT) * 100;
  const toNext = intoCycle === 0 ? REDEEM_AT : REDEEM_AT - intoCycle;

  let statusMsg: string;
  if (redeemableUnits === 0) {
    statusMsg = `${toNext} ${toNext === 1 ? "point" : "points"} to your next R20 reward.`;
  } else if (redeemableUnits === 1) {
    statusMsg = `1 reward ready — R20 off. ${toNext} pts to the next.`;
  } else {
    statusMsg = `${redeemableUnits} × R20 rewards ready — R${redeemableUnits * 20} off total. ${toNext} pts to the next.`;
  }

  return (
    <section style={card} aria-label="Loyalty points">
      <p style={label}>Loyalty balance</p>

      {/* Hero number — the Rand value, largest single element on the card. */}
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
        {formatZar(valueZar)}{" "}
        <span style={{ fontSize: "0.4em", fontWeight: 400, color: "var(--color-cool-steel)" }}>
          ({safePoints} pts)
        </span>
      </p>

      {/* Reward pips — one dot per redeemable R20 reward, up to 5 visible. */}
      {redeemableUnits > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {Array.from({ length: Math.min(redeemableUnits, 5) }).map((_, i) => (
            <div
              key={i}
              aria-hidden="true"
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                backgroundColor: "var(--color-crimson-carrot)",
              }}
            />
          ))}
          {redeemableUnits > 5 && (
            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11, fontWeight: 600, color: "var(--color-crimson-carrot)" }}>
              +{redeemableUnits - 5}
            </span>
          )}
          <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, color: "var(--color-crimson-carrot)", marginLeft: 2 }}>
            {redeemableUnits === 1 ? "R20 off ready" : `${redeemableUnits} × R20 ready`}
          </span>
        </div>
      )}

      {/* Progress bar — shows progress within the current 100-pt cycle. */}
      <div
        aria-hidden="true"
        style={{
          height: 6,
          borderRadius: 999,
          backgroundColor: "rgba(255,255,255,0.1)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${progressPct}%`,
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
        {statusMsg}
      </p>

      <p
        style={{
          fontFamily: "'DM Sans', sans-serif",
          fontWeight: 400,
          fontSize: 12,
          lineHeight: 1.6,
          color: "var(--color-porcelain)",
          opacity: 0.5,
          margin: 0,
          paddingTop: 12,
          borderTop: "1px solid rgba(247,246,242,0.08)",
        }}
      >
        Earn 5 pts per R10 spent. Redeem 100 pts = R20 off.
      </p>

      <a
        href="/loyalty"
        style={{
          fontFamily: "'DM Sans', sans-serif",
          fontWeight: 600,
          fontSize: 12,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--color-crimson-carrot)",
          textDecoration: "none",
          alignSelf: "flex-start",
        }}
      >
        View history →
      </a>
    </section>
  );
}
