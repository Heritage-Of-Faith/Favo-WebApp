// Visit / hours section — owner: Nikao (task N3)
// Split: hours table left, address + CTA right. Porcelain background.
// TODO: replace placeholder address before launch.

const S = {
  section: {
    backgroundColor: "#F7F6F2",
    padding: "88px 40px",
    borderTop: "1px solid #E5E4DE",
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
    color: "#81A4B1",
    marginBottom: 20,
  } satisfies React.CSSProperties,
  heading: {
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
    fontWeight: 900,
    fontSize: "clamp(2rem, 3.5vw, 3.5rem)",
    lineHeight: 0.95,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: "#1C0501",
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
    color: "#1C0501",
    marginBottom: 8,
    fontStyle: "normal",
  } satisfies React.CSSProperties,
  addressSub: {
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 400,
    fontSize: 14,
    color: "#81A4B1",
    marginBottom: 40,
    fontStyle: "normal",
  } satisfies React.CSSProperties,
  cta: {
    display: "inline-flex",
    alignItems: "center",
    backgroundColor: "#1C0501",
    color: "#F7F6F2",
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

// Static hours — shown when OperatingHours server component falls back.
// Will be replaced by live data from N4/OperatingHours once G3 seeds the table.
const STATIC_HOURS = [
  { day: "Monday",    hours: "09:00 – 17:00" },
  { day: "Tuesday",   hours: "09:00 – 17:00" },
  { day: "Wednesday", hours: "09:00 – 17:00" },
  { day: "Thursday",  hours: "09:00 – 17:00" },
  { day: "Friday",    hours: "09:00 – 17:00" },
  { day: "Saturday",  hours: "Closed"         },
  { day: "Sunday",    hours: "07:00 – 15:00"  },
] as const;

export default function VisitSection() {
  return (
    <section style={S.section}>
      <div style={S.inner}>
        {/* ── Left: address + CTA ── */}
        <div>
          <p style={S.eyebrow}>Find us</p>
          <h2 style={S.heading}>Come in.<br />We&rsquo;ll be here.</h2>
          {/* TODO: replace with actual address before launch */}
          <address style={{ display: "block" }}>
            <p style={S.address}>12 Bean Street</p>
            <p style={S.addressSub}>Cape Town, Western Cape · 8001</p>
          </address>
          <a href="/customer/login" style={S.cta}>
            Join the loyalty programme →
          </a>
        </div>

        {/* ── Right: hours ── */}
        <div>
          <p style={S.eyebrow}>Opening hours</p>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {STATIC_HOURS.map((row) => (
                <tr
                  key={row.day}
                  style={{
                    borderBottom: "1px solid #E5E4DE",
                  }}
                >
                  <td
                    style={{
                      fontFamily: "'DM Sans', sans-serif",
                      fontWeight: 400,
                      fontSize: 15,
                      color: "#1C0501",
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
                      color: row.hours === "Closed" ? "#81A4B1" : "#1C0501",
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
              color: "#81A4B1",
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
