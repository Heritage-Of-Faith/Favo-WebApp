// Customer login stub — owner: Nikao (task N6)
// Phase 3 placeholder. No auth. Visual match with landing page.
// Docs: docs/DESIGN.md

export default function CustomerLoginPage() {
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
        padding: "var(--spacing-xl) var(--spacing-m)",
        textAlign: "center",
        gap: "var(--spacing-l)",
      }}
    >
      {/* FAVO Wordmark */}
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 900,
          fontSize: "var(--text-hero)",
          lineHeight: 0.92,
          letterSpacing: "var(--tracking-hero)",
          textTransform: "uppercase",
          color: "var(--color-porcelain)",
        }}
      >
        FAVO
      </span>

      {/* Heading */}
      <h1 className="favo-h2" style={{ color: "var(--color-porcelain)" }}>
        Your Reward Portal
      </h1>

      {/* Body copy */}
      <p
        style={{
          fontFamily: "var(--font-sans)",
          fontWeight: 400,
          fontSize: "var(--text-base)",
          lineHeight: 1.7,
          color: "var(--color-porcelain)",
          maxWidth: "34ch",
          textWrap: "pretty",
        }}
      >
        We&rsquo;re building your loyalty portal. When it&rsquo;s ready,
        you&rsquo;ll sign in with a magic link sent to your email &mdash; no
        password needed.
      </p>

      {/* Phase label */}
      <span
        className="favo-label"
        style={{ color: "var(--color-cool-steel)" }}
      >
        Coming in Phase 3
      </span>

      {/* Back link */}
      <a
        href="/"
        className="favo-cta"
        style={{
          marginTop: "var(--spacing-s)",
          color: "var(--color-crimson-carrot)",
          textDecoration: "none",
        }}
      >
        &larr; Back to FAVO
      </a>
    </main>
  );
}
