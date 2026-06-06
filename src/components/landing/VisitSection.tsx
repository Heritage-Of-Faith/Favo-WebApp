// Visit / hours section — owner: Nikao (task N3)
// Split: address + CTA left, hours right. Porcelain background.
// Responsive via .landing-visit-grid in globals.css.

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
    color: "var(--color-cool-steel)",
    marginBottom: 20,
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
    marginBottom: 32,
  } satisfies React.CSSProperties,
  address: {
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
    fontWeight: 700,
    fontSize: "clamp(1.5rem, 2.5vw, 2.5rem)",
    lineHeight: 1.1,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: "var(--color-coffee-bean)",
    marginBottom: 8,
    fontStyle: "normal",
  } satisfies React.CSSProperties,
  addressSub: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 400,
    fontSize: 14,
    color: "var(--color-cool-steel)",
    marginBottom: 40,
    fontStyle: "normal",
  } satisfies React.CSSProperties,
  cta: {
    display: "inline-flex",
    alignItems: "center",
    backgroundColor: "var(--color-coffee-bean)",
    color: "var(--color-porcelain)",
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 700,
    fontSize: 12,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    textDecoration: "none",
    padding: "14px 28px",
    borderRadius: 2,
  } satisfies React.CSSProperties,
  note: {
    fontFamily: "'DM Sans', sans-serif",
    fontSize: 11,
    letterSpacing: "0.10em",
    textTransform: "uppercase" as const,
    color: "var(--color-cool-steel)",
    marginTop: 20,
  } satisfies React.CSSProperties,
} as const;

const HOURS = [
  { day: "Monday – Friday", hours: "After morning prayer", note: true },
  { day: "Saturday",        hours: "Closed",               note: false },
  { day: "Sunday",          hours: "07:50 – 09:15",        note: false },
  { day: "Sunday (events)", hours: "16:00 – 16:45 · 18:00 – 19:00", note: false },
] as const;

export default function VisitSection() {
  return (
    <section id="visit" style={{ ...S.section, scrollMarginTop: 64 }} className="landing-section-pad-l">
      <div className="landing-visit-grid">
        {/* Left: address + CTA */}
        <div>
          <p style={S.eyebrow}>Find us</p>
          <h2 style={S.heading}>Come in.<br />We&rsquo;ll be here.</h2>
          <address style={{ display: "block" }}>
            <p style={S.address}>7 Duiker Street</p>
            <p style={S.addressSub}>Reyno Ridge · Emalahleni · 1049</p>
          </address>
          <a href="/signup" style={S.cta}>
            Join the loyalty programme →
          </a>
        </div>

        {/* Right: hours */}
        <div>
          <p style={S.eyebrow}>Opening hours</p>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {HOURS.map((row) => (
                <tr
                  key={row.day}
                  style={{ borderBottom: "1px solid var(--color-porcelain-soft)" }}
                >
                  <td
                    style={{
                      fontFamily: "'DM Sans', sans-serif",
                      fontWeight: 400,
                      fontSize: 15,
                      color: "var(--color-coffee-bean)",
                      padding: "12px 0",
                      verticalAlign: "top",
                    }}
                  >
                    {row.day}
                  </td>
                  <td
                    style={{
                      fontFamily: "'DM Sans', sans-serif",
                      fontWeight: 400,
                      fontSize: 15,
                      color: row.hours === "Closed" ? "var(--color-cool-steel)" : "var(--color-coffee-bean)",
                      textAlign: "right",
                      padding: "12px 0",
                      letterSpacing: "0.02em",
                      verticalAlign: "top",
                    }}
                  >
                    {row.hours}
                    {row.note && (
                      <span style={{ display: "block", fontSize: 11, color: "var(--color-cool-steel)", marginTop: 2 }}>
                        Hours vary — not guaranteed
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={S.note}>
            Sunday event hours apply to monthly church services only
          </p>
        </div>
      </div>
    </section>
  );
}
