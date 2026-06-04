// Numbers strip — owner: Nikao (task N3)
// Four real facts about FAVO set large in Barlow Condensed.
// Responsive via .landing-numbers-grid in globals.css.

const facts = [
  { number: "07:50",   label: "Opens Sundays",           sub: "Before morning service · 07:50–09:15" },
  { number: "5",       label: "Drinks on the menu",       sub: "Cappuccino, Americano, Mocha & more" },
  { number: "Mon–Fri", label: "Open on weekdays",         sub: "After morning prayer · hours vary" },
  { number: "3",       label: "iXchangers serving",       sub: "Interns learning to serve you" },
] as const;

const S = {
  section: {
    backgroundColor: "var(--color-paper)",
    borderTop: "1px solid var(--color-porcelain-soft)",
    borderBottom: "1px solid var(--color-porcelain-soft)",
  } satisfies React.CSSProperties,
  number: {
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
    fontWeight: 900,
    fontSize: "clamp(2rem, 3.5vw, 3.5rem)",
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
      <div className="landing-numbers-grid">
        {facts.map((f, i) => (
          <div
            key={f.number}
            className={i > 0 ? "landing-numbers-cell-border" : ""}
            style={{
              borderLeft: i > 0 ? "1px solid var(--color-porcelain-soft)" : "none",
              paddingLeft: i > 0 ? 28 : 0,
              paddingRight: 20,
            }}
          >
            <p style={S.number}>{f.number}</p>
            <p style={S.label}>{f.label}</p>
            <p style={S.sub}>{f.sub}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
