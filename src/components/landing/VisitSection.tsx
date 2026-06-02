// Visit / hours section â€” owner: Nikao (task N3)
// Split: hours table left, address + CTA right. Porcelain background.
// TODO: replace placeholder address before launch.

const S = {
  section: {
    backgroundColor: "var(--color-porcelain)",
    padding: "88px 40px",
    borderTop: "1px solid var(--color-porcelain-soft)",
  } satisfies React.CSSProperties,
  inner: {
    maxWidth: 1200,
    margin: "0 auto",
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 80,
    alignItems: "flex-start",
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
} as const;

// Static hours â€” shown when OperatingHours server component falls back.
// Will be replaced by live data from N4/OperatingHours once G3 seeds the table.
const STATIC_HOURS = [
  { day: "Monday",    hours: "09:00 â€“ 17:00" },
  { day: "Tuesday",   hours: "09:00 â€“ 17:00" },
  { day: "Wednesday", hours: "09:00 â€“ 17:00" },
  { day: "Thursday",  hours: "09:00 â€“ 17:00" },
  { day: "Friday",    hours: "09:00 â€“ 17:00" },
  { day: "Saturday",  hours: "Closed"         },
  { day: "Sunday",    hours: "07:00 â€“ 15:00"  },
] as const;

export default function VisitSection() {
  return (
    <section style={S.section}>
      <div style={S.inner}>
        {/* â”€â”€ Left: address + CTA â”€â”€ */}
        <div>
          <p style={S.eyebrow}>Find us</p>
          <h2 style={S.heading}>Come in.<br />We&rsquo;ll be here.</h2>
          {/* TODO: replace with actual address before launch */}
          <address style={{ display: "block" }}>
            <p style={S.address}>12 Bean Street</p>
            <p style={S.addressSub}>Cape Town, Western Cape Â· 8001</p>
          </address>
          <a href="/login" style={S.cta}>
            Join the loyalty programme â†’
          </a>
        </div>

        {/* â”€â”€ Right: hours â”€â”€ */}
        <div>
          <p style={S.eyebrow}>Opening hours</p>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {STATIC_HOURS.map((row) => (
                <tr
                  key={row.day}
                  style={{
                    borderBottom: "1px solid var(--color-porcelain-soft)",
                  }}
                >
                  <td
                    style={{
                      fontFamily: "'DM Sans', sans-serif",
                      fontWeight: 400,
                      fontSize: 15,
                      color: "var(--color-coffee-bean)",
                      padding: "10px 0",
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
                      padding: "10px 0",
                      letterSpacing: "0.02em",
                    }}
                  >
                    {row.hours}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 11,
              letterSpacing: "0.10em",
              textTransform: "uppercase",
              color: "var(--color-cool-steel)",
              marginTop: 20,
            }}
          >
            Hours informational only
          </p>
        </div>
      </div>
    </section>
  );
}
