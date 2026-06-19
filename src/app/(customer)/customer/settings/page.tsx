// Customer settings page — profile + notifications + sign out.
// Route: /customer/settings

import type { CSSProperties } from "react";
import { redirect } from "next/navigation";
import { getCustomerProfile, getCustomerSummary } from "@/server/actions/customer";
import SettingsForm from "@/components/customer/SettingsForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings — FAVO" };

const S: Record<string, CSSProperties> = {
  page: {
    backgroundColor: "var(--color-porcelain)",
    minHeight: "100dvh",
    display: "flex",
    flexDirection: "column",
  },
  nav: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "20px clamp(20px, 5vw, 40px)",
    borderBottom: "1px solid rgba(28,5,1,0.1)",
  },
  wordmark: {
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
    fontWeight: 900,
    fontSize: 22,
    letterSpacing: "0.22em",
    textTransform: "uppercase",
    color: "var(--color-coffee-bean)",
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
    gap: 36,
  },
  heading: {
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
    fontWeight: 900,
    fontSize: "clamp(3rem, 12vw, 5.5rem)",
    lineHeight: 0.95,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--color-coffee-bean)",
    margin: 0,
  },
};

export default async function SettingsPage() {
  const [profileRes, summaryRes] = await Promise.all([
    getCustomerProfile(),
    getCustomerSummary(),
  ]);

  if (!profileRes.ok && profileRes.code === "UNAUTHORIZED") redirect("/login");
  if (!profileRes.ok) redirect("/customer");

  const profile = profileRes.data;
  const hasPushSubscription = summaryRes.ok ? summaryRes.data.hasPushSubscription : false;

  return (
    <div style={S.page}>
      <nav style={S.nav}>
        <a href="/customer" style={S.back}>← Dashboard</a>
        <a href="/" style={S.wordmark}>FAVO</a>
      </nav>

      <main style={S.main}>
        <h1 style={S.heading}>Settings</h1>

        <SettingsForm
          customerId={profile.id}
          initialName={profile.name}
          initialEmail={profile.email}
          initialPhone={profile.phone}
          hasPushSubscription={hasPushSubscription}
        />
      </main>
    </div>
  );
}
