// PackDetailCard — owner: Nikao (AT-69, N17)
// Shows one coffee pack: item, qty remaining, expiry countdown.
// Expiry text goes red when < 7 days (urgency cue, not a time gate — L04/L05).

import type { CSSProperties } from "react";
import type { CoffeePack } from "@/lib/customer/contract";
import { formatDate } from "@/lib/format";

export interface PackDetailCardProps {
  pack: CoffeePack;
  expired?: boolean;
}

const DAYS_WARNING = 7;

function daysUntil(isoDate: string): number {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  return Math.ceil((then - now) / (1000 * 60 * 60 * 24));
}

const card: CSSProperties = {
  backgroundColor: "rgba(247,246,242,0.05)",
  border: "1px solid rgba(247,246,242,0.1)",
  borderRadius: 2,
  padding: 20,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const cardExpired: CSSProperties = {
  ...card,
  opacity: 0.5,
};

const label: CSSProperties = {
  fontFamily: "'DM Sans', sans-serif",
  fontWeight: 300,
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--color-cool-steel)",
  margin: 0,
};

const itemName: CSSProperties = {
  fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
  fontWeight: 700,
  fontSize: 22,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--color-porcelain)",
  margin: 0,
};

export default function PackDetailCard({ pack, expired = false }: PackDetailCardProps) {
  const daysLeft = daysUntil(pack.expiresAt);
  const isExpiringSoon = !expired && daysLeft > 0 && daysLeft <= DAYS_WARNING;
  const expiryColor = isExpiringSoon
    ? "var(--color-error)"
    : "var(--color-cool-steel)";

  const progressPct = Math.round((pack.qtyRemaining / pack.qtyTotal) * 100);

  return (
    <article style={expired ? cardExpired : card} aria-label={`${pack.itemName} pack`}>
      <p style={label}>{expired ? "Expired" : "Active pack"}</p>
      <p style={itemName}>{pack.itemName}</p>

      {/* Qty bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          aria-hidden="true"
          style={{
            flex: 1,
            height: 6,
            borderRadius: 999,
            backgroundColor: "rgba(247,246,242,0.12)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${progressPct}%`,
              height: "100%",
              backgroundColor: expired ? "var(--color-cool-steel)" : "var(--color-crimson-carrot)",
            }}
          />
        </div>
        <span
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontWeight: 600,
            fontSize: 13,
            color: "var(--color-porcelain)",
            opacity: 0.8,
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {pack.qtyRemaining}/{pack.qtyTotal}
        </span>
      </div>

      <p
        style={{
          fontFamily: "'DM Sans', sans-serif",
          fontWeight: 400,
          fontSize: 12,
          color: expiryColor,
          margin: 0,
        }}
      >
        {expired
          ? `Expired ${formatDate(pack.expiresAt)}`
          : isExpiringSoon
          ? `Expires in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`
          : `Expires ${formatDate(pack.expiresAt)}`}
      </p>
    </article>
  );
}
