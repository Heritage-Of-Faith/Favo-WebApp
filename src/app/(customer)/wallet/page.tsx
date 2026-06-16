// Wallet page — owner: Nikao (AT-69, N17)
// Route: /wallet (inside (customer) route group — customer auth gate)
// Server component. Read-only — no mutation entry points (L05/L16).
// Displays current balance + full transaction history.

import type { CSSProperties } from "react";
import { redirect } from "next/navigation";
import { getWallet } from "@/server/actions/customer";
import WalletTransactionList from "@/components/customer/WalletTransactionList";
import { formatZar } from "@/lib/format";

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
    margin: "0 0 12px",
  },
};

export default async function WalletPage() {
  const res = await getWallet();
  if (!res.ok) {
    if (res.code === "UNAUTHORIZED") redirect("/login");
    // Non-auth failure: render error state rather than crashing.
  }
  const wallet = res.ok ? res.data : null;

  return (
    <div style={S.page}>
      <nav style={S.nav}>
        <a href="/" style={S.wordmark}>FAVO</a>
        <a href="/customer" style={S.back}>← Dashboard</a>
      </nav>

      <main style={S.main}>
        {/* Balance hero */}
        <section aria-label="Wallet balance">
          <p style={S.eyebrow}>Wallet balance</p>
          <p style={S.balance}>{formatZar(wallet?.balanceZar ?? 0)}</p>
          <p style={S.notice}>
            Top-ups are added at the counter by your barista — ask them to load credit
            onto your account.
          </p>
        </section>

        {/* Transaction history */}
        <section>
          <p style={S.sectionLabel}>Transaction history</p>
          <WalletTransactionList transactions={wallet?.transactions ?? []} />
        </section>
      </main>
    </div>
  );
}
