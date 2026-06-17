// Privacy policy — owner: Nikao (AT-94, N20)
// Renders the POPIA-compliant privacy policy at /privacy.
// Server component — no auth required (public page).

import type { Metadata } from "next";
import type { CSSProperties } from "react";

export const metadata: Metadata = {
  title: "Privacy Policy · FAVO Café",
  description: "How FAVO Café collects, uses, and protects your personal information.",
};

const S: Record<string, CSSProperties> = {
  page: {
    backgroundColor: "var(--color-coffee-bean)",
    minHeight: "100dvh",
    color: "var(--color-porcelain)",
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
  } as CSSProperties,
  main: {
    maxWidth: 760,
    margin: "0 auto",
    padding: "clamp(32px, 6vw, 64px) clamp(20px, 5vw, 40px)",
  },
  h1: {
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
    fontWeight: 900,
    fontSize: "clamp(2rem, 5vw, 3rem)",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--color-porcelain)",
    marginBottom: 8,
  },
  updated: {
    fontFamily: "'DM Sans', sans-serif",
    fontSize: 13,
    color: "var(--color-cool-steel)",
    marginBottom: 40,
  },
  h2: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 600,
    fontSize: 18,
    color: "var(--color-porcelain)",
    marginTop: 40,
    marginBottom: 12,
    borderBottom: "1px solid rgba(247,246,242,0.1)",
    paddingBottom: 8,
  },
  p: {
    fontFamily: "'DM Sans', sans-serif",
    fontSize: 15,
    lineHeight: 1.75,
    color: "var(--color-porcelain)",
    opacity: 0.85,
    marginBottom: 16,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: 14,
    marginBottom: 24,
  },
  th: {
    textAlign: "left" as const,
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 600,
    fontSize: 11,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "var(--color-crimson-carrot)",
    padding: "8px 12px",
    borderBottom: "1px solid rgba(247,246,242,0.2)",
  },
  td: {
    fontFamily: "'DM Sans', sans-serif",
    fontSize: 13,
    color: "var(--color-porcelain)",
    opacity: 0.8,
    padding: "8px 12px",
    borderBottom: "1px solid rgba(247,246,242,0.07)",
    verticalAlign: "top" as const,
  },
  contact: {
    background: "rgba(247,246,242,0.06)",
    border: "1px solid rgba(247,246,242,0.12)",
    borderRadius: 8,
    padding: "20px 24px",
    marginTop: 32,
  },
  contactLabel: {
    fontFamily: "'DM Sans', sans-serif",
    fontSize: 11,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "var(--color-crimson-carrot)",
    marginBottom: 8,
  },
  contactLine: {
    fontFamily: "'DM Sans', sans-serif",
    fontSize: 14,
    color: "var(--color-porcelain)",
    lineHeight: 1.8,
    opacity: 0.85,
  },
};

export default function PrivacyPage() {
  return (
    <div style={S.page}>
      <nav style={S.nav}>
        <a href="/" style={S.wordmark}>FAVO</a>
        <a href="/login" style={{ ...S.wordmark, fontSize: 13, opacity: 0.6 }}>
          Sign in
        </a>
      </nav>

      <main style={S.main}>
        <h1 style={S.h1}>Privacy Policy</h1>
        <p style={S.updated}>Last updated: 17 June 2026 · Effective: 17 June 2026</p>

        <h2 style={S.h2}>Who we are</h2>
        <p style={S.p}>
          FAVO Café is operated by Heritage of Faith Ministries (HOFMI), a South African
          non-profit organisation based in Reyno Ridge, Emalahleni, Mpumalanga.
        </p>
        <p style={S.p}>
          <strong>Responsible party (POPIA):</strong> Heritage of Faith Ministries,
          7 Duiker Street, Reyno Ridge, Emalahleni, 1049, South Africa.
          Email: privacy@hofmi.org
        </p>

        <h2 style={S.h2}>What we collect and why</h2>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Data</th>
              <th style={S.th}>Why we collect it</th>
              <th style={S.th}>Legal basis</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Email address", "Account creation and sign-in", "Contractual necessity"],
              ["Full name", "Personalising your loyalty account; barista lookup at the counter", "Contractual necessity"],
              ["Phone number", "Counter lookup; order support", "Legitimate interest"],
              ["Purchase history", "Calculating loyalty points and wallet credits", "Contractual necessity"],
              ["Loyalty points balance", "Awarding and redeeming points", "Contractual necessity"],
              ["Wallet balance and transactions", "Recording credits and debits accurately", "Contractual necessity"],
              ["Coffee pack purchases", "Tracking active packs and 90-day expiry", "Contractual necessity"],
              ["Push notification subscription", "Order-ready alerts when you opt in", "Consent (withdrawable)"],
              ["Audit log entries", "Tamper-proof record of every account change", "Legal obligation"],
            ].map(([data, why, basis]) => (
              <tr key={data}>
                <td style={S.td}><strong>{data}</strong></td>
                <td style={S.td}>{why}</td>
                <td style={S.td}>{basis}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={S.p}>
          We do <strong>not</strong> store payment card details. All card payments
          are processed by Yoco using their hosted payment page.
        </p>

        <h2 style={S.h2}>How long we keep your data</h2>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Data</th>
              <th style={S.th}>Retention period</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Account details (name, email, phone)", "Until you request anonymisation"],
              ["Order and payment records", "Indefinitely (minimum 5 years — tax law)"],
              ["Loyalty, wallet, and pack records", "Indefinitely (financial ledger)"],
              ["Audit log", "Indefinitely (append-only, legal obligation)"],
              ["Push subscriptions", "Until revoked by you or your browser"],
            ].map(([data, period]) => (
              <tr key={data}>
                <td style={S.td}><strong>{data}</strong></td>
                <td style={S.td}>{period}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2 style={S.h2}>Who can access your data</h2>
        <p style={S.p}>
          FAVO uses strict role-based access control. No staff member can access
          data beyond their role.
        </p>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Role</th>
              <th style={S.th}>What they can see</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Barista", "Your name and phone number only (to find your account at the counter)"],
              ["Manager / Admin", "Full profile, order history, loyalty and wallet records (for support)"],
              ["Owner", "Full access for oversight and compliance"],
            ].map(([role, access]) => (
              <tr key={role}>
                <td style={S.td}><strong>{role}</strong></td>
                <td style={S.td}>{access}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={S.p}>
          Your data is stored on Supabase (EU West — Frankfurt, Germany). No data
          is shared with third parties except Yoco for payment processing.
        </p>

        <h2 style={S.h2}>Your rights under POPIA</h2>
        <p style={S.p}>You have the right to:</p>
        <ul style={{ ...S.p, paddingLeft: 24 }}>
          <li><strong>Access</strong> — request a copy of all personal information we hold about you</li>
          <li><strong>Correction</strong> — request correction of inaccurate or incomplete information</li>
          <li><strong>Deletion</strong> — request erasure of your personal information (subject to legal retention requirements)</li>
          <li><strong>Objection</strong> — object to processing based on legitimate interest</li>
          <li><strong>Complaint</strong> — lodge a complaint with the Information Regulator of South Africa</li>
        </ul>
        <p style={S.p}>
          To exercise any right, email <strong>privacy@hofmi.org</strong>. We will respond
          within 30 days.
        </p>
        <p style={S.p}>
          <strong>Note on audit log anonymisation:</strong> Our audit log is legally
          required to be append-only and cannot be deleted. When a deletion request is
          received, we anonymise your personal details and insert a POPIA redaction marker.
          Financial transaction amounts and timestamps are preserved as required by tax law.
        </p>

        <h2 style={S.h2}>Changes to this policy</h2>
        <p style={S.p}>
          We will notify registered customers by email of any material changes.
          The &quot;Last updated&quot; date at the top always reflects the current version.
        </p>

        <div style={S.contact}>
          <p style={S.contactLabel}>Contact</p>
          <p style={S.contactLine}>
            <strong>Email:</strong> privacy@hofmi.org<br />
            <strong>Post:</strong> Heritage of Faith Ministries, 7 Duiker Street,
            Reyno Ridge, Emalahleni, 1049, South Africa<br />
            <strong>Information Regulator:</strong>{" "}
            <a
              href="https://inforegulator.org.za"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--color-crimson-carrot)" }}
            >
              inforegulator.org.za ↗
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
