// Landing header — owner: Nikao (task N3)
// Sticky top bar over the page. Wordmark left, Visit + Sign in right.
// Pure CSS sticky (no client JS). Coffee Bean backdrop works over all sections.

const S = {
  header: {
    position: "sticky" as const,
    top: 0,
    zIndex: 50,
    backgroundColor: "rgba(28,5,1,0.85)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    borderBottom: "1px solid rgba(247,246,242,0.10)",
  } satisfies React.CSSProperties,
  inner: {
    maxWidth: 1200,
    margin: "0 auto",
    padding: "16px 40px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 24,
  } satisfies React.CSSProperties,
  wordmark: {
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
    fontWeight: 900,
    fontSize: 24,
    letterSpacing: "0.18em",
    textTransform: "uppercase" as const,
    color: "var(--color-porcelain)",
    textDecoration: "none",
    lineHeight: 1,
  } satisfies React.CSSProperties,
  nav: {
    display: "flex",
    alignItems: "center",
    gap: 28,
  } satisfies React.CSSProperties,
  link: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 600,
    fontSize: 12,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    color: "var(--color-porcelain)",
    textDecoration: "none",
    opacity: 0.85,
  } satisfies React.CSSProperties,
  cta: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 700,
    fontSize: 12,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    color: "var(--color-paper)",
    backgroundColor: "var(--color-crimson-carrot)",
    textDecoration: "none",
    padding: "10px 20px",
    borderRadius: 2,
  } satisfies React.CSSProperties,
} as const;

export default function Header() {
  return (
    <header style={S.header}>
      <div style={S.inner}>
        <a href="/" style={S.wordmark}>FAVO</a>
        <nav style={S.nav}>
          <a href="#visit" style={S.link} className="landing-header-anchor">Visit</a>
          <a href="/login" style={S.cta}>Sign in</a>
        </nav>
      </div>
    </header>
  );
}
