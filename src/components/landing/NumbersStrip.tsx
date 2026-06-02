// Numbers strip — owner: Nikao (task N3)
// Four café facts set large in Barlow Condensed on a paper background.
// These are decorative data points — specific, not generic.

const facts = [
  { number: "09:00",  label: "Mon – Fri open",       sub: "Saturdays closed" },
  { number: "93°C",   label: "Espresso temperature",  sub: "9 bar · 28 second extraction" },
  { number: "1,750",  label: "Metres elevation",       sub: "Current lot · El Jordán, Huila" },
  { number: "62%",    label: "Paid to producer",       sub: "On this lot · nothing hidden" },
] as const;

const S = {
  section: {
    backgroundColor: "#FBFAF6",
    borderTop: "1px solid #E5E4DE",
    borderBottom: "1px solid #E5E4DE",
  } satisfies React.CSSProperties,
  grid: {
    maxWidth: 1200,
    margin: "0 auto",
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    padding: "40px 40px",
  } satisfies React.CSSProperties,
  cell: (i: number) => ({
    borderLeft: i > 0 ? "1px solid #E5E4DE" : "none",
    paddingLeft: i > 0 ? 28 : 0,
    paddingRight: 20,
  } satisfies React.CSSProperties),
  number: {
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
    fontWeight: 900,
    fontSize: "clamp(2.5rem, 4vw, 4rem)",
    letterSpacing: "0.04em",
    color: "#1C0501",
    lineHeight: 1,
    marginBottom: 8,
  } satisfies React.CSSProperties,
  label: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 300,
    fontSize: 11,
    letterSpacing: "0.14em",
    textTransform: "uppercase" as const,
    color: "#81A4B1",
    marginBottom: 3,
  } satisfies React.CSSProperties,
  sub: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 400,
    fontSize: 12,
    color: "#81A4B1",
    opacity: 0.8,
  } satisfies React.CSSProperties,
} as const;

export default function NumbersStrip() {
  return (
    <section style={S.section} aria-label="Key facts about FAVO">
      <div style={S.grid}>
        {facts.map((f, i) => (
          <div key={f.number} style={S.cell(i)}>
            <p style={S.number}>{f.number}</p>
            <p style={S.label}>{f.label}</p>
            <p style={S.sub}>{f.sub}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
