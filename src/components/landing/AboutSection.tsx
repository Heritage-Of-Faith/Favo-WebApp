// About / Story section — owner: Nikao (task N3)
// Coffee Bean dark background. iXchange community story left, menu right.
// Responsive via .landing-about-grid in globals.css.

import Image from "next/image";

const S = {
  section: {
    position: "relative" as const,
    overflow: "hidden",
    backgroundColor: "var(--color-coffee-bean)",
    color: "var(--color-porcelain)",
  } satisfies React.CSSProperties,
  // Hand-drawn café watermarks on the dark Coffee Bean fold. filter:invert
  // lifts the black line art to a warm light tone; low opacity keeps them subtle.
  watermarkCup: {
    position: "absolute" as const,
    right: "-2%",
    bottom: "-10%",
    width: "clamp(220px, 24vw, 360px)",
    aspectRatio: "1000 / 1476",
    opacity: 0.18,
    filter: "invert(1)",
    pointerEvents: "none" as const,
    zIndex: 0,
  } satisfies React.CSSProperties,
  watermarkBean: {
    position: "absolute" as const,
    left: "-2%",
    bottom: "-6%",
    width: "clamp(150px, 18vw, 260px)",
    aspectRatio: "1000 / 1113",
    opacity: 0.16,
    filter: "invert(1)",
    pointerEvents: "none" as const,
    zIndex: 0,
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
    paddingTop: 12,
    paddingBottom: 12,
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
    <section style={S.section} className="landing-section-pad-l">
      {/* Subtle café-theme watermarks */}
      <div style={S.watermarkBean} aria-hidden="true">
        <Image
          src="/illustrations/coffee-bean.png"
          alt=""
          fill
          sizes="260px"
          style={{ objectFit: "contain" }}
        />
      </div>
      <div style={S.watermarkCup} aria-hidden="true">
        <Image
          src="/illustrations/takeaway-cup-single.png"
          alt=""
          fill
          sizes="360px"
          style={{ objectFit: "contain" }}
        />
      </div>

      <div className="landing-about-grid" style={{ position: "relative", zIndex: 1 }}>
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
