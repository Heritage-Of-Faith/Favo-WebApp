// Global 404 — owner: Nikao (task N3)
// On-brand not-found. Renders inside the root layout.

export const metadata = { title: "Page not found · FAVO Café" };

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
        padding: "var(--spacing-xl) var(--spacing-m)",
        textAlign: "center",
        gap: "var(--spacing-l)",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 900,
          fontSize: "clamp(4rem, 14vw, 9rem)",
          lineHeight: 0.9,
          letterSpacing: "var(--tracking-hero)",
          textTransform: "uppercase",
          color: "var(--color-crimson-carrot)",
        }}
      >
        404
      </span>

      <h1 className="favo-h2" style={{ color: "var(--color-porcelain)" }}>
        This cup&rsquo;s empty
      </h1>

      <p
        style={{
          fontFamily: "var(--font-sans)",
          fontWeight: 400,
          fontSize: "var(--text-base)",
          lineHeight: 1.7,
          color: "var(--color-porcelain)",
          maxWidth: "34ch",
          textWrap: "pretty",
          opacity: 0.85,
        }}
      >
        We couldn&rsquo;t find that page. It may have moved, or never existed.
        Let&rsquo;s get you back to something warm.
      </p>

      <a
        href="/"
        className="favo-cta"
        style={{
          marginTop: "var(--spacing-s)",
          backgroundColor: "var(--color-crimson-carrot)",
          color: "var(--color-paper)",
          padding: "14px 28px",
          borderRadius: 2,
          textDecoration: "none",
        }}
      >
        &larr; Back to FAVO
      </a>
    </main>
  );
}
