// Visit section — owner: Nikao (task N3)
// Address + directions CTA. Hours removed per Mia 2026-06-17.

const S = {
  section: {
    backgroundColor: "var(--color-porcelain)",
    borderTop: "1px solid var(--color-porcelain-soft)",
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
    fontSize: "clamp(2rem, 3.5vw, 3.5rem)",
    lineHeight: 0.95,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: "var(--color-coffee-bean)",
    margin: 0,
    marginBottom: 28,
  } satisfies React.CSSProperties,
  address: {
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
    fontWeight: 700,
    fontSize: "clamp(1.5rem, 2.5vw, 2.5rem)",
    lineHeight: 1.1,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: "var(--color-dark-teal)",
    margin: "0 0 6px",
    fontStyle: "normal",
  } satisfies React.CSSProperties,
  addressSub: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 400,
    fontSize: 14,
    color: "var(--color-cool-steel)",
    margin: "0 0 44px",
    fontStyle: "normal",
  } satisfies React.CSSProperties,
} as const;

export default function VisitSection() {
  return (
    <section id="visit" style={{ ...S.section, scrollMarginTop: 64 }} className="landing-section-pad-l">
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <p style={S.eyebrow}>Visit</p>
        <h2 style={S.heading}>Come in.<br />We&rsquo;ll be here.</h2>
        <address style={{ display: "block", fontStyle: "normal" }}>
          <p style={S.address}>7 Duiker Street</p>
          <p style={S.addressSub}>Reyno Ridge · Emalahleni · 1049</p>
        </address>
        <a
          href="https://www.google.com/maps/dir/?api=1&destination=7+Duiker+Street+Reyno+Ridge+Emalahleni"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-block",
            fontFamily: "var(--font-sans)",
            fontWeight: 700,
            fontSize: 12,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--color-crimson-carrot)",
            textDecoration: "none",
          }}
        >
          Get directions ↗
        </a>
      </div>
    </section>
  );
}
