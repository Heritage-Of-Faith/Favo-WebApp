// About / Story section — owner: Nikao (task N3)
// Coffee Bean dark background. iXchange community story left, menu right.

const S = {
  section: {
    backgroundColor: "var(--color-coffee-bean)",
    color: "var(--color-porcelain)",
    padding: "88px 40px",
  } satisfies React.CSSProperties,
  inner: {
    maxWidth: 1200,
    margin: "0 auto",
    display: "grid",
    gridTemplateColumns: "1fr 1.4fr",
    gap: 64,
    alignItems: "flex-start",
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
    fontSize: "clamp(2.5rem, 4vw, 4rem)",
    lineHeight: 1.0,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: "var(--color-crimson-carrot)",
    margin: 0,
    marginBottom: 24,
  } satisfies React.CSSProperties,
  body: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 400,
    fontSize: 16,
    lineHeight: 1.75,
    color: "var(--color-porcelain)",
    opacity: 0.9,
    marginBottom: 20,
    textWrap: "pretty" as const,
  } satisfies React.CSSProperties,
  box: {
    backgroundColor: "var(--color-dark-teal)",
    padding: 32,
  } satisfies React.CSSProperties,
  boxEyebrow: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 300,
    fontSize: 11,
    letterSpacing: "0.14em",
    textTransform: "uppercase" as const,
    color: "var(--color-crimson-carrot)",
    marginBottom: 24,
  } satisfies React.CSSProperties,
  drinkRow: {
    display: "flex",
    alignItems: "baseline",
    paddingTop: 16,
    paddingBottom: 16,
    borderBottom: "1px solid rgba(247,246,242,0.12)",
  } satisfies React.CSSProperties,
  drinkName: {
    fontFamily: "'Barlow Condensed', sans-serif",
    fontWeight: 700,
    fontSize: 20,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: "var(--color-porcelain)",
    flex: 1,
  } satisfies React.CSSProperties,
} as const;

const DRINKS = [
  "Cappuccino",
  "Americano",
  "Hot Chocolate",
  "Mocha",
  "Chai Latte",
] as const;

export default function AboutSection() {
  return (
    <section style={S.section}>
      <div style={S.inner}>
        {/* Left: story */}
        <div>
          <p style={S.eyebrow}>Who we are</p>
          <h2 style={S.heading}>Built on<br />service.</h2>
          <p style={S.body}>
            FAVO started as a simple idea inside Heritage of Faith Ministries:
            give the iXchange Life Interns a real place to practice hospitality.
            Not a simulation — an actual café, serving the HOFMI community.
          </p>
          <p style={S.body}>
            Every cup is made by someone who chose to be here. The skills are
            real, the coffee is good, and the people behind the counter are
            learning what it means to genuinely serve.
          </p>
        </div>

        {/* Right: menu */}
        <div style={S.box}>
          <p style={S.boxEyebrow}>What we serve</p>
          {DRINKS.map((name, i) => (
            <div
              key={name}
              style={{
                ...S.drinkRow,
                borderTop: i === 0 ? "1px solid rgba(247,246,242,0.12)" : undefined,
              }}
            >
              <span style={S.drinkName}>{name}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
