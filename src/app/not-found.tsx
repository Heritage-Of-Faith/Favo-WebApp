// Global 404 page — rendered for any unmatched route.

import Link from "next/link";

export const metadata = {
  title: "Page not found — FAVO Café",
};

export default function NotFound() {
  return (
    <main
      style={{
        backgroundColor: "var(--color-dark-teal)",
        color: "var(--color-porcelain)",
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "var(--spacing-xl) var(--spacing-m)",
        gap: "var(--spacing-l)",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 900,
          fontSize: "clamp(6rem, 20vw, 14rem)",
          lineHeight: 0.85,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "var(--color-porcelain)",
          opacity: 0.08,
          userSelect: "none",
        }}
        aria-hidden
      >
        404
      </span>

      <div style={{ marginTop: "-4rem" }}>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 900,
            fontSize: "clamp(2rem, 5vw, 4rem)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            margin: 0,
            marginBottom: 16,
          }}
        >
          Page not found
        </h1>
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontWeight: 400,
            fontSize: 16,
            lineHeight: 1.7,
            color: "var(--color-porcelain)",
            opacity: 0.7,
            maxWidth: "32ch",
            margin: "0 auto",
          }}
        >
          The page you&rsquo;re looking for doesn&rsquo;t exist or has moved.
        </p>
      </div>

      <Link
        href="/"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          backgroundColor: "var(--color-crimson-carrot)",
          color: "var(--color-paper)",
          fontFamily: "var(--font-sans)",
          fontWeight: 700,
          fontSize: 12,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          textDecoration: "none",
          padding: "14px 28px",
          borderRadius: 2,
        }}
      >
        ← Back to FAVO
      </Link>
    </main>
  );
}
