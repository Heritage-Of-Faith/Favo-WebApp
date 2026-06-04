// Customer PWA home — owner: Nikao (task N5)
// Push notification opt-in + Phase 1 staging customer form.
// Route: /customer  (inside (customer) route group — inherits PWA layout + meta)
"use client";

import { useState } from "react";
import Image from "next/image";
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
        {/* Banner photo */}
        <div
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: "16 / 9",
            borderRadius: 2,
            overflow: "hidden",
            backgroundColor: "rgba(247,246,242,0.05)",
          }}
        >
          <Image
            src="/images/espresso-pour.jpg"
            alt="Espresso pouring into a glass on the FAVO machine"
            fill
            sizes="(max-width: 640px) 100vw, 600px"
            style={{ objectFit: "cover", objectPosition: "center 40%" }}
          />
        </div>

        {/* Greeting */}
        <div>
          <h1 style={S.greeting}>
            {customerId ? "You're set." : "Your rewards."}
          </h1>
          <p style={S.sub}>
            {customerId
              ? "Notifications are being set up for this device."
              : "Earn points with every order. Get notified when it's ready."}
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

        {/* Production: loyalty portal not yet open — preview what's coming */}
        {!isStaging && !customerId && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
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
                Opening soon
              </p>
              <p style={{
                fontFamily: "'DM Sans', sans-serif",
                fontWeight: 400,
                fontSize: 15,
                lineHeight: 1.7,
                color: "var(--color-porcelain)",
                opacity: 0.7,
              }}>
                Your loyalty dashboard is on its way. Here&rsquo;s what you&rsquo;ll get
                once it opens.
              </p>
            </div>

            {/* Feature preview */}
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {[
                { t: "Points on every cup", d: "Earn as you sip — every order counts." },
                { t: "Rewards that add up", d: "100 points = R20 off your next coffee." },
                { t: "Ready alerts", d: "We'll notify you the moment your order is up." },
              ].map((f) => (
                <div
                  key={f.t}
                  style={{
                    display: "flex",
                    gap: 16,
                    alignItems: "flex-start",
                    padding: "18px 0",
                    borderBottom: "1px solid rgba(247,246,242,0.1)",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      flexShrink: 0,
                      width: 8,
                      height: 8,
                      marginTop: 7,
                      borderRadius: 999,
                      backgroundColor: "var(--color-crimson-carrot)",
                    }}
                  />
                  <div>
                    <p style={{
                      fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
                      fontWeight: 700,
                      fontSize: 18,
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      color: "var(--color-porcelain)",
                      margin: 0,
                    }}>
                      {f.t}
                    </p>
                    <p style={{
                      fontFamily: "'DM Sans', sans-serif",
                      fontWeight: 400,
                      fontSize: 14,
                      lineHeight: 1.6,
                      color: "var(--color-porcelain)",
                      opacity: 0.65,
                      margin: "2px 0 0",
                    }}>
                      {f.d}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
