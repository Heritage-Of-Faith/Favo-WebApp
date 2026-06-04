// Customer login — owner: Nikao (task N6)
// Magic-link login placeholder. Visible to the public — no internal language.

export const metadata = {
  title: "Sign in · FAVO Café",
  description: "Sign in to your FAVO loyalty account.",
};

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
          textTransform: "uppercase" as const,
          color: "var(--color-porcelain)",
        }}
      >
        FAVO
      </span>

      {/* Heading */}
      <h1 className="favo-h2" style={{ color: "var(--color-porcelain)" }}>
        Your loyalty portal
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
          textWrap: "pretty" as const,
          opacity: 0.85,
        }}
      >
        We&rsquo;re putting the finishing touches on your rewards portal.
        Sign-in will use a magic link sent straight to your email &mdash;
        no password needed.
      </p>

      {/* Status label */}
      <span className="favo-label" style={{ color: "var(--color-cool-steel)" }}>
        Opening soon
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
