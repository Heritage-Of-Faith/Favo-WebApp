// Customer PWA home — owner: Nikao (task N5)
// Push notification opt-in + Phase 1 staging customer form.
// Route: /customer  (inside (customer) route group — inherits PWA layout + meta)
"use client";

import { useState } from "react";
import PushOptIn from "@/components/customer/PushOptIn";
import StagingCustomerResume from "@/components/customer/StagingCustomerResume";

const isStaging = process.env.NEXT_PUBLIC_STAGING === "true";

const S = {
  page: {
    backgroundColor: "var(--color-coffee-bean)",
    minHeight: "100dvh",
    display: "flex",
    flexDirection: "column" as const,
  },
  nav: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "20px 40px",
    borderBottom: "1px solid rgba(247,246,242,0.1)",
  },
  wordmark: {
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
    fontWeight: 900,
    fontSize: 22,
    letterSpacing: "0.22em",
    textTransform: "uppercase" as const,
    color: "var(--color-porcelain)",
    textDecoration: "none",
    lineHeight: 1,
  } as React.CSSProperties,
  back: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 700,
    fontSize: 11,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    color: "var(--color-cool-steel)",
    textDecoration: "none",
  } as React.CSSProperties,
  main: {
    flex: 1,
    padding: "64px 40px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 40,
    maxWidth: 600,
  },
  greeting: {
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
    fontWeight: 900,
    fontSize: "clamp(2rem, 4vw, 3.5rem)",
    lineHeight: 0.95,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: "var(--color-porcelain)",
    margin: 0,
  },
  sub: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 400,
    fontSize: 15,
    lineHeight: 1.7,
    color: "var(--color-porcelain)",
    opacity: 0.7,
    margin: 0,
  },
} as const;

export default function CustomerPage() {
  const [customerId, setCustomerId] = useState<string | null>(null);

  return (
    <div style={S.page}>
      {/* Nav */}
      <nav style={S.nav}>
        <a href="/" style={S.wordmark}>FAVO</a>
        <a href="/" style={S.back}>← Back</a>
      </nav>

      {/* Main */}
      <main style={S.main}>
        {/* Greeting */}
        <div>
          <h1 style={S.greeting}>
            {customerId ? "You're set." : "Your rewards."}
          </h1>
          <p style={S.sub}>
            {customerId
              ? "Notifications are being set up for this device."
              : "Earn a stamp with every order. Get notified when it's ready."}
          </p>
        </div>

        {/* Staging: select customer before showing push opt-in */}
        {isStaging && !customerId && (
          <StagingCustomerResume onCustomerSelected={setCustomerId} />
        )}

        {/* Push opt-in — shown once we have a customerId */}
        {customerId && (
          <PushOptIn customerId={customerId} />
        )}

        {/* Production: loyalty portal coming in Phase 3 */}
        {!isStaging && !customerId && (
          <div style={{
            backgroundColor: "rgba(247,246,242,0.05)",
            border: "1px solid rgba(247,246,242,0.1)",
            padding: 24,
            borderRadius: 2,
          }}>
            <p style={{
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: 300,
              fontSize: 11,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--color-cool-steel)",
              marginBottom: 8,
            }}>
              Coming in Phase 3
            </p>
            <p style={{
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: 400,
              fontSize: 15,
              lineHeight: 1.7,
              color: "var(--color-porcelain)",
              opacity: 0.7,
            }}>
              Your full loyalty dashboard — stamps, history, and rewards —
              launches with the magic-link login in Phase 3.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
