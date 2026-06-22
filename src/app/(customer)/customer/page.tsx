// Customer dashboard — owner: Nikao (task N13, AT-65)
// Route: /customer  (where login lands). Replaces the Phase 1 N5 staging stub.
// Server component — renders identically with JavaScript disabled (acceptance).
// Read-only surface (L05/L16): no buttons here mutate money/points.
// Docs: API.md (getCustomerSummary, listCustomerOrders) · DESIGN.md · BUSINESS_RULES.md L05/L06/L16

import type { CSSProperties } from "react";
import { redirect } from "next/navigation";
import { getCustomerSummary, listCustomerOrders } from "@/server/actions/customer";
import { getOperatingHours } from "@/server/actions/hours";
import LoyaltyCard from "@/components/customer/LoyaltyCard";
import WalletCard from "@/components/customer/WalletCard";
import PackList from "@/components/customer/PackList";
import OrderHistoryList from "@/components/customer/OrderHistoryList";
import WelcomeModal from "@/components/customer/WelcomeModal";

// Always render fresh data (hours/loyalty change at the counter): no static cache.
export const dynamic = "force-dynamic";

const S: Record<string, CSSProperties> = {
  page: {
    backgroundColor: "var(--color-dark-teal)",
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
    color: "var(--color-crimson-carrot)",
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
    gap: 28,
  },
  greeting: {
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
    fontWeight: 900,
    fontSize: "clamp(4rem, 14vw, 7rem)",
    lineHeight: 0.95,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--color-porcelain)",
    margin: 0,
  },
  hoursBlock: {
    padding: "16px 20px",
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(247,246,242,0.1)",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  hoursLabel: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 300,
    fontSize: 11,
    letterSpacing: "0.14em",
    textTransform: "uppercase" as const,
    color: "var(--color-cool-steel)",
    margin: 0,
  },
  hoursOpen: {
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
    fontWeight: 700,
    fontSize: 22,
    letterSpacing: "0.04em",
    color: "var(--color-crimson-carrot)",
    margin: 0,
  },
  hoursClosed: {
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
    fontWeight: 700,
    fontSize: 22,
    letterSpacing: "0.04em",
    color: "var(--color-cool-steel)",
    opacity: 0.55,
    margin: 0,
  },
  twoCol: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 16,
  },
};

export default async function CustomerDashboard() {
  const summaryRes = await getCustomerSummary();

  // Not signed in → send to login. (Session is the source of truth, L05.)
  if (!summaryRes.ok) {
    if (summaryRes.code === "UNAUTHORIZED") redirect("/login");
    // Any other failure: fall back to a minimal shell rather than crashing.
  }

  const summary = summaryRes.ok ? summaryRes.data : null;
  const [ordersRes, hoursRes] = await Promise.all([
    listCustomerOrders(10),
    getOperatingHours().catch(() => ({ ok: false as const, code: "FETCH_ERROR", message: "Hours unavailable" })),
  ]);
  const orders = ordersRes.ok ? ordersRes.data : [];

  const todayDow = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Africa/Johannesburg" })
  ).getDay();
  const allHours = hoursRes.ok ? hoursRes.data : [];
  const todayHours = allHours.find((h) => h.dayOfWeek === todayDow) ?? null;

  const firstName = summary?.name?.trim().split(/\s+/)[0] ?? "there";

  return (
    <div style={S.page}>
      <nav style={S.nav}>
        <a href="/" style={S.wordmark}>FAVO</a>
        <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
          <a href="/customer/settings" style={S.back}>Settings</a>
          <a href="/" style={S.back}>← Home</a>
        </div>
      </nav>

      <main style={S.main}>
        <h1 style={S.greeting}>Hi {firstName}</h1>

        {todayHours && (
          <section aria-label="Today's hours" style={S.hoursBlock}>
            <p style={S.hoursLabel}>Today&apos;s hours</p>
            {todayHours.isClosed ? (
              <p style={S.hoursClosed}>Closed today</p>
            ) : (
              <p style={S.hoursOpen}>{todayHours.opensAt} – {todayHours.closesAt}</p>
            )}
          </section>
        )}

        {/* Loyalty is the hero card (largest number on the page). */}
        <LoyaltyCard points={summary?.loyaltyPoints ?? 0} />

        <div style={S.twoCol}>
          <WalletCard balanceZar={summary?.walletBalanceZar ?? 0} />
          <PackList activePackCount={summary?.activePackCount ?? 0} />
        </div>

        <OrderHistoryList orders={orders} />

      </main>

      {/* First-login notification prompt — fires once, then never again. */}
      {summary && (
        <WelcomeModal
          customerId={summary.customerId}
          firstName={firstName}
        />
      )}
    </div>
  );
}
