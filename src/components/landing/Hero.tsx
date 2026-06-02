// Landing hero â€” owner: Nikao (task N3)
// Full-bleed Dark Teal. Barlow Condensed 900 headline. Specific cafÃ© copy.

const S = {
  section: {
    backgroundColor: "var(--color-dark-teal)",
    color: "var(--color-porcelain)",
    padding: "80px 40px 96px",
  } satisfies React.CSSProperties,
  inner: {
    maxWidth: 1200,
    margin: "0 auto",
    display: "grid",
    gridTemplateColumns: "1.2fr 1fr",
    gap: 56,
    alignItems: "center",
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
  lotLabel: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 300,
    fontSize: 11,
    letterSpacing: "0.18em",
    textTransform: "uppercase" as const,
    color: "var(--color-crimson-carrot)",
    marginBottom: 12,
  } satisfies React.CSSProperties,
  lotName: {
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
    fontWeight: 900,
    fontSize: "clamp(3rem, 6vw, 6rem)",
    lineHeight: 0.88,
    letterSpacing: "0.04em",
    textTransform: "uppercase" as const,
    color: "var(--color-crimson-carrot)",
    marginBottom: 16,
  } satisfies React.CSSProperties,
  lotDetail: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 400,
    fontSize: 13,
    lineHeight: 1.8,
    color: "var(--color-porcelain)",
    opacity: 0.75,
  } satisfies React.CSSProperties,
} as const;

export default function Hero() {
  return (
    <section style={S.section}>
      <div style={S.inner}>
        {/* â”€â”€ Left column â”€â”€ */}
        <div>
          <p style={S.eyebrow}>Speciality coffee Â· Cape Town</p>
          <h1 style={S.headline}>
            Single&#8209;origin.<br />
            No shortcuts.
          </h1>
          <p style={S.body}>
            Every cup names the farm, the harvest, and the roast date.
            We pull espresso at 93&deg;C and brew filter to order &mdash;
            nothing sits on a burner.
          </p>
          <a href="/login" style={S.cta}>
            Join the loyalty programme â†’
          </a>
        </div>

        {/* â”€â”€ Right column â€” current lot â”€â”€ */}
        <div style={S.visual}>
          <p style={S.lotLabel}>Current lot Â· Colombia</p>
          <p style={S.lotName}>El JordÃ¡n</p>
          <p style={S.lotDetail}>
            Caturra, washed<br />
            1,750 m Â· Huila<br />
            Blackberry jam, dark cane sugar
          </p>
        </div>
      </div>
    </section>
  );
}
