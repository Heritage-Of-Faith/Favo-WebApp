// PackList — owner: Nikao (task N13, AT-65)
// Glanceable active-pack count for the dashboard. Full pack detail (per-pack
// expiry, etc.) lives on the dedicated /packs page (N17). Read-only (L05/L16).

import type { CSSProperties } from "react";

export interface PackListProps {
  activePackCount: number;
}

const card: CSSProperties = {
  backgroundColor: "rgba(28,5,1,0.05)",
  border: "1px solid rgba(28,5,1,0.12)",
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

export default function PackList({ activePackCount }: PackListProps) {
  const count = Math.max(0, Math.floor(activePackCount));
  return (
    <section style={card} aria-label="Active coffee packs">
      <p style={label}>Coffee packs</p>
      <p
        style={{
          fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
          fontWeight: 900,
          fontSize: "clamp(2rem, 7vw, 2.75rem)",
          lineHeight: 0.95,
          color: "var(--color-coffee-bean)",
          margin: 0,
        }}
      >
        {count}
      </p>
      <p
        style={{
          fontFamily: "'DM Sans', sans-serif",
          fontWeight: 400,
          fontSize: 13,
          lineHeight: 1.6,
          color: "var(--color-coffee-bean)",
          opacity: 0.65,
          margin: 0,
        }}
      >
        {count === 0
          ? "No active packs. Buy a pack at the counter and save."
          : `${count} active ${count === 1 ? "pack" : "packs"} ready to use.`}
      </p>
    </section>
  );
}
