// About / Story section — owner: Nikao (task N3)
// Coffee Bean dark background. Transparency breakdown on the left, sourcing story right.
// Inspired by design system StoryBlock pattern.

const S = {
  section: {
    backgroundColor: "#1C0501",
    color: "#F7F6F2",
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
    color: "#F5560C",
    marginBottom: 16,
  } satisfies React.CSSProperties,
  heading: {
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
    fontWeight: 900,
    fontSize: "clamp(2.5rem, 4vw, 4rem)",
    lineHeight: 1.0,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: "#F5560C",
    margin: 0,
    marginBottom: 24,
  } satisfies React.CSSProperties,
  body: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 400,
    fontSize: 16,
    lineHeight: 1.75,
    color: "#F7F6F2",
    opacity: 0.9,
    marginBottom: 20,
    textWrap: "pretty" as const,
  } satisfies React.CSSProperties,
  box: {
    backgroundColor: "#054D61",
    padding: 32,
  } satisfies React.CSSProperties,
  boxEyebrow: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 300,
    fontSize: 11,
    letterSpacing: "0.14em",
    textTransform: "uppercase" as const,
    color: "#F5560C",
    marginBottom: 20,
  } satisfies React.CSSProperties,
  row: {
    display: "grid",
    gridTemplateColumns: "1fr 0.6fr 0.4fr",
    gap: 12,
    alignItems: "baseline",
    paddingTop: 14,
    paddingBottom: 14,
    borderBottom: "1px solid rgba(247,246,242,0.12)",
  } satisfies React.CSSProperties,
  rowName: {
    fontFamily: "'Barlow Condensed', sans-serif",
    fontWeight: 700,
    fontSize: 16,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: "#F7F6F2",
  } satisfies React.CSSProperties,
  rowWhat: {
    fontFamily: "'DM Sans', sans-serif",
    fontSize: 12,
    color: "#F7F6F2",
    opacity: 0.65,
  } satisfies React.CSSProperties,
  rowPct: {
    fontFamily: "'Barlow Condensed', sans-serif",
    fontWeight: 900,
    fontSize: 20,
    letterSpacing: "0.04em",
    color: "#F5560C",
    textAlign: "right" as const,
  } satisfies React.CSSProperties,
} as const;

const breakdown = [
  { who: "Diofanor Ruiz", what: "Farm gate · Huila",       pct: "62%" },
  { who: "Origin co-op",   what: "Milling, drying",         pct: "6%"  },
  { who: "Importer",       what: "Logistics, finance",       pct: "8%"  },
  { who: "FAVO",           what: "Roasting, packaging",      pct: "21%" },
  { who: "Card + VAT",     what: "Fees",                     pct: "3%"  },
] as const;

export default function AboutSection() {
  return (
    <section style={S.section}>
      <div style={S.inner}>
        {/* ── Left: story ── */}
        <div>
          <p style={S.eyebrow}>Our coffee</p>
          <h2 style={S.heading}>Specific.<br />Transparent.<br />Direct.</h2>
          <p style={S.body}>
            We source two to three single-origin lots per season &mdash; right
            now a washed Yirgacheffe from Dumerso, harvested November 2024, and
            a natural Burundi from Bukeye co-op.
          </p>
          <p style={S.body}>
            Espresso on a La Marzocco Linea Classic at 9 bar, 28-second
            extraction. Filter brewed to order on Kalita Wave. We do not keep
            batch brew. If you are in a hurry, order the espresso &mdash; it is
            ready in under a minute.
          </p>
        </div>

        {/* ── Right: price breakdown ── */}
        <div style={S.box}>
          <p style={S.boxEyebrow}>Where the bag price went · El Jordán</p>
          {breakdown.map((row, i) => (
            <div
              key={row.who}
              style={{
                ...S.row,
                borderTop: i === 0 ? "1px solid rgba(247,246,242,0.12)" : undefined,
              }}
            >
              <span style={S.rowName}>{row.who}</span>
              <span style={S.rowWhat}>{row.what}</span>
              <span style={S.rowPct}>{row.pct}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
