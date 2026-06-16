// Packs page — owner: Nikao (AT-69, N17)
// Route: /packs (inside (customer) route group — customer auth gate)
// Server component. Read-only — no mutation entry points (L05/L16).
// Displays active packs with expiry countdown; expired packs collapsed.

import type { CSSProperties } from "react";
import { redirect } from "next/navigation";
import { getPacks } from "@/server/actions/customer";
import PackDetailCard from "@/components/customer/PackDetailCard";

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
  heading: {
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
    fontWeight: 900,
    fontSize: "clamp(2rem, 6vw, 3rem)",
    lineHeight: 0.95,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--color-porcelain)",
    margin: 0,
  },
  notice: {
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
    margin: "0 0 16px",
  },
  empty: {
    fontFamily: "'DM Sans', sans-serif",
    fontSize: 14,
    lineHeight: 1.7,
    color: "var(--color-porcelain)",
    opacity: 0.6,
    padding: "16px 0",
  },
  grid: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
};

export default async function PacksPage() {
  const res = await getPacks();
  if (!res.ok) {
    if (res.code === "UNAUTHORIZED") redirect("/login");
  }
  const packs = res.ok ? res.data : { active: [], expired: [] };

  return (
    <div style={S.page}>
      <nav style={S.nav}>
        <a href="/" style={S.wordmark}>FAVO</a>
        <a href="/customer" style={S.back}>← Dashboard</a>
      </nav>

      <main style={S.main}>
        <h1 style={S.heading}>Coffee packs</h1>

        {/* Active packs */}
        <section>
          <p style={S.sectionLabel}>Active packs</p>
          {packs.active.length === 0 ? (
            <p style={S.empty}>
              No active packs. Ask your barista to add a pack to your account at the
              counter.
            </p>
          ) : (
            <div style={S.grid}>
              {packs.active.map((pack) => (
                <PackDetailCard key={pack.id} pack={pack} />
              ))}
            </div>
          )}
        </section>

        <p style={S.notice}>
          Coffee packs are purchased at the counter — ask your barista to load a pack
          onto your account.
        </p>

        {/* Expired packs — collapsible */}
        {packs.expired.length > 0 && (
          <section>
            <details>
              <summary
                style={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontWeight: 300,
                  fontSize: 11,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--color-cool-steel)",
                  cursor: "pointer",
                  userSelect: "none",
                  marginBottom: 16,
                  listStyle: "none",
                }}
              >
                Expired packs ({packs.expired.length})
              </summary>
              <div style={{ ...S.grid, marginTop: 12 }}>
                {packs.expired.map((pack) => (
                  <PackDetailCard key={pack.id} pack={pack} expired />
                ))}
              </div>
            </details>
          </section>
        )}
      </main>
    </div>
  );
}
