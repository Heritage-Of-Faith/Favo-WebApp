// Landing hero — owner: Nikao (task N3)
// Full-bleed Dark Teal. Barlow Condensed 900 headline.
// Responsive via .landing-hero-grid in globals.css.

const S = {
  section: {
    backgroundColor: "var(--color-dark-teal)",
    color: "var(--color-porcelain)",
  } satisfies React.CSSProperties,
  eyebrow: {
    fontFamily: "'DM Sans', 'Helvetica Neue', Arial, sans-serif",
    fontWeight: 300,
    fontSize: 11,
    letterSpacing: "0.14em",
    textTransform: "uppercase" as const,
    color: "var(--color-crimson-carrot)",
    marginBottom: 20,
  } satisfies React.CSSProperties,
  headline: {
    fontFamily: "'Barlow Condensed', 'Oswald', 'Arial Narrow', sans-serif",
    fontWeight: 900,
    fontSize: "clamp(3.5rem, 7vw, 7.5rem)",
    lineHeight: 0.9,
    letterSpacing: "0.04em",
    textTransform: "uppercase" as const,
    color: "var(--color-porcelain)",
    margin: 0,
    marginBottom: 28,
  } satisfies React.CSSProperties,
  body: {
    fontFamily: "'DM Sans', 'Helvetica Neue', Arial, sans-serif",
    fontWeight: 400,
    fontSize: 17,
    lineHeight: 1.7,
    color: "var(--color-porcelain)",
    opacity: 0.9,
    maxWidth: "38ch",
    marginBottom: 40,
    textWrap: "pretty" as const,
  } satisfies React.CSSProperties,
  cta: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    backgroundColor: "var(--color-crimson-carrot)",
    color: "var(--color-paper)",
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 700,
    fontSize: 12,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    textDecoration: "none",
    padding: "14px 28px",
    borderRadius: 2,
  } satisfies React.CSSProperties,
  visual: {
    display: "flex",
    flexDirection: "column" as const,
    justifyContent: "center",
    alignItems: "flex-start",
    paddingLeft: 16,
    borderLeft: "2px solid rgba(247,246,242,0.12)",
    gap: 0,
  } satisfies React.CSSProperties,
  menuLabel: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 300,
    fontSize: 11,
    letterSpacing: "0.18em",
    textTransform: "uppercase" as const,
    color: "var(--color-crimson-carrot)",
    marginBottom: 20,
  } satisfies React.CSSProperties,
  menuItem: {
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
    fontWeight: 700,
    fontSize: "clamp(1.5rem, 3vw, 2.5rem)",
    lineHeight: 1.1,
    letterSpacing: "0.04em",
    textTransform: "uppercase" as const,
    color: "var(--color-porcelain)",
    marginBottom: 6,
    opacity: 0.85,
  } satisfies React.CSSProperties,
} as const;

const MENU = ["Cappuccino", "Americano", "Hot Chocolate", "Mocha", "Chai Latte"] as const;

export default function Hero() {
  return (
    <section style={S.section} className="landing-section-pad">
      <div className="landing-hero-grid">
        {/* Left column */}
        <div>
          <p style={S.eyebrow}>Heritage of Faith · Emalahleni</p>
          <h1 style={S.headline}>
            Coffee for<br />
            the family.
          </h1>
          <p style={S.body}>
            FAVO is the café at Heritage of Faith Ministries.
            Our baristas are iXchange interns — people learning to serve
            the community, one drink at a time. Come as you are.
          </p>
          <a href="/login" style={S.cta}>
            Join the loyalty programme →
          </a>
        </div>

        {/* Right column — menu (hidden on mobile via .landing-hero-visual) */}
        <div style={S.visual} className="landing-hero-visual">
          <p style={S.menuLabel}>What we make</p>
          {MENU.map((item) => (
            <p key={item} style={S.menuItem}>{item}</p>
          ))}
        </div>
      </div>
    </section>
  );
}
