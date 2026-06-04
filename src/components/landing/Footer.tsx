// Landing footer — owner: Nikao (task N3)
// Closes the page on Coffee Bean dark. Wordmark + tagline left, info columns right.
// Responsive via .landing-footer-grid in globals.css.

const S = {
  section: {
    backgroundColor: "var(--color-coffee-bean)",
    color: "var(--color-porcelain)",
    borderTop: "1px solid var(--color-porcelain-soft)",
  } satisfies React.CSSProperties,
  wordmark: {
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
    fontWeight: 900,
    fontSize: "clamp(3rem, 6vw, 5rem)",
    lineHeight: 0.9,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: "var(--color-porcelain)",
    margin: 0,
  } satisfies React.CSSProperties,
  tagline: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 400,
    fontSize: 14,
    lineHeight: 1.6,
    color: "var(--color-porcelain)",
    opacity: 0.7,
    marginTop: 16,
    maxWidth: "30ch",
  } satisfies React.CSSProperties,
  colHead: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 300,
    fontSize: 11,
    letterSpacing: "0.14em",
    textTransform: "uppercase" as const,
    color: "var(--color-crimson-carrot)",
    marginBottom: 14,
  } satisfies React.CSSProperties,
  line: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 400,
    fontSize: 14,
    lineHeight: 1.7,
    color: "var(--color-porcelain)",
    opacity: 0.85,
    margin: 0,
  } satisfies React.CSSProperties,
  link: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 400,
    fontSize: 14,
    lineHeight: 1.9,
    color: "var(--color-porcelain)",
    textDecoration: "none",
    display: "block",
    opacity: 0.85,
  } satisfies React.CSSProperties,
  rule: {
    border: 0,
    borderTop: "1px solid rgba(247,246,242,0.12)",
    margin: "48px 0 24px",
  } satisfies React.CSSProperties,
  bottom: {
    display: "flex",
    flexWrap: "wrap" as const,
    justifyContent: "space-between",
    gap: 12,
    fontFamily: "'DM Sans', sans-serif",
    fontSize: 12,
    color: "var(--color-cool-steel)",
  } satisfies React.CSSProperties,
} as const;

export default function Footer() {
  return (
    <footer style={S.section} className="landing-section-pad-l">
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div className="landing-footer-grid">
          {/* Brand */}
          <div>
            <p style={S.wordmark}>FAVO</p>
            <p style={S.tagline}>
              The café at Heritage of Faith Ministries — served by iXchange interns
              learning to serve the community.
            </p>
          </div>

          {/* Visit */}
          <div>
            <p style={S.colHead}>Visit</p>
            <p style={S.line}>7 Duiker Street</p>
            <p style={S.line}>Reyno Ridge</p>
            <p style={S.line}>Emalahleni · 1049</p>
          </div>

          {/* Hours */}
          <div>
            <p style={S.colHead}>Hours</p>
            <p style={S.line}>Sun · 07:50–09:15</p>
            <p style={S.line}>Mon–Fri · after prayer</p>
            <p style={S.line}>Sat · closed</p>
          </div>

          {/* Links */}
          <div>
            <p style={S.colHead}>More</p>
            <a href="/login" style={S.link}>Sign in</a>
            <a
              href="https://hofmi.org"
              style={S.link}
              target="_blank"
              rel="noopener noreferrer"
            >
              Heritage of Faith ↗
            </a>
          </div>
        </div>

        <hr style={S.rule} />

        <div style={S.bottom}>
          <span>© 2026 FAVO Café · Heritage of Faith Ministries</span>
          <span>Reyno Ridge, Emalahleni · South Africa</span>
        </div>
      </div>
    </footer>
  );
}
