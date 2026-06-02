// Customer login stub — owner: Nikao (task N6)
// Phase 3 placeholder. No auth. Visual match with landing page.
// Route: /login  (inside (customer) route group — gets PWA layout + meta)

export const metadata = {
  title: "Your Reward Portal",
  description: "Sign in to your FAVO loyalty account — magic link, no password needed.",
};

const S = {
  page: {
    backgroundColor: "var(--color-dark-teal)",
    color: "var(--color-porcelain)",
    minHeight: "100dvh",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    padding: "64px 40px",
    textAlign: "center" as const,
  } satisfies React.CSSProperties,
  wordmark: {
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
    fontWeight: 900,
    fontSize: "clamp(4rem, 8vw, 8rem)",
    lineHeight: 0.9,
    letterSpacing: "0.22em",
    textTransform: "uppercase" as const,
    color: "var(--color-porcelain)",
    marginBottom: 48,
  } satisfies React.CSSProperties,
  eyebrow: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 300,
    fontSize: 11,
    letterSpacing: "0.14em",
    textTransform: "uppercase" as const,
    color: "var(--color-crimson-carrot)",
    marginBottom: 16,
  } satisfies React.CSSProperties,
  heading: {
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
    fontWeight: 900,
    fontSize: "clamp(2rem, 4vw, 3.5rem)",
    lineHeight: 1.0,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: "var(--color-porcelain)",
    margin: 0,
    marginBottom: 24,
  } satisfies React.CSSProperties,
  body: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 400,
    fontSize: 16,
    lineHeight: 1.75,
    color: "var(--color-porcelain)",
    opacity: 0.85,
    maxWidth: "34ch",
    textWrap: "pretty" as const,
    marginBottom: 32,
  } satisfies React.CSSProperties,
  phase: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 300,
    fontSize: 11,
    letterSpacing: "0.14em",
    textTransform: "uppercase" as const,
    color: "var(--color-cool-steel)",
    marginBottom: 40,
  } satisfies React.CSSProperties,
  divider: {
    width: 40,
    height: 1,
    backgroundColor: "rgba(247,246,242,0.2)",
    marginBottom: 40,
  } satisfies React.CSSProperties,
  back: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 700,
    fontSize: 12,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    color: "var(--color-crimson-carrot)",
    textDecoration: "none",
  } satisfies React.CSSProperties,
} as const;

export default function CustomerLoginPage() {
  return (
    <main style={S.page}>
      <p style={S.wordmark}>FAVO</p>
      <p style={S.eyebrow}>Loyalty portal</p>
      <h1 style={S.heading}>Your reward portal</h1>
      <p style={S.body}>
        We&rsquo;re building your loyalty portal. When it&rsquo;s ready,
        you&rsquo;ll sign in with a magic link sent to your email &mdash;
        no password needed.
      </p>
      <p style={S.phase}>Coming in Phase 3</p>
      <div style={S.divider} />
      <a href="/" style={S.back}>← Back to FAVO</a>
    </main>
  );
}
