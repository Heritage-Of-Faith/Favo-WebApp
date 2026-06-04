// Numbers strip -- owner: Nikao (task N3)
// Four cafe facts set large in Barlow Condensed on a paper background.
// These are decorative data points -- specific, not generic.
// Strings use clean UTF-8 punctuation (middot, en-dash, degree, a-acute).
// Written via UTF-8-safe tooling — do NOT re-save with PowerShell Set-Content
// -Encoding, which previously double-encoded these into mojibake.

const facts = [
  { number: "09:00",   label: "Mon – Fri open",  sub: "Saturdays closed" },
  { number: "93°C", label: "Espresso temperature", sub: "9 bar · 28 second extraction" },
  { number: "1,750",   label: "Metres elevation",     sub: "Current lot · El Jordán, Huila" },
  { number: "62%",     label: "Paid to producer",     sub: "On this lot · nothing hidden" },
] as const;

const S = {
  section: {
    backgroundColor: "var(--color-paper)",
    borderTop: "1px solid var(--color-porcelain-soft)",
    borderBottom: "1px solid var(--color-porcelain-soft)",
  } satisfies React.CSSProperties,
  grid: {
    maxWidth: 1200,
    margin: "0 auto",
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    padding: "40px 40px",
  } satisfies React.CSSProperties,
  cell: (i: number) => ({
    borderLeft: i > 0 ? "1px solid var(--color-porcelain-soft)" : "none",
    paddingLeft: i > 0 ? 28 : 0,
    paddingRight: 20,
  } satisfies React.CSSProperties),
  number: {
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
    fontWeight: 900,
    fontSize: "clamp(2.5rem, 4vw, 4rem)",
    letterSpacing: "0.04em",
    color: "var(--color-coffee-bean)",
    lineHeight: 1,
    marginBottom: 8,
  } satisfies React.CSSProperties,
  label: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 300,
    fontSize: 11,
    letterSpacing: "0.14em",
    textTransform: "uppercase" as const,
    color: "var(--color-cool-steel)",
    marginBottom: 3,
  } satisfies React.CSSProperties,
  sub: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 400,
    fontSize: 12,
    color: "var(--color-cool-steel)",
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
