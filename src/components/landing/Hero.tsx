// Landing hero — owner: Nikao (task N3)
// Full-bleed Dark Teal. Barlow Condensed 900 headline + café photo.
// Responsive via .landing-hero-grid in globals.css.

import Image from "next/image";

const S = {
  section: {
    position: "relative" as const,
    overflow: "hidden",
    backgroundColor: "var(--color-dark-teal)",
    color: "var(--color-porcelain)",
  } satisfies React.CSSProperties,
  // Faint hand-drawn watermark — bleeds off the bottom-left, behind content.
  watermark: {
    position: "absolute" as const,
    left: "-3%",
    bottom: "-12%",
    width: "clamp(280px, 34vw, 520px)",
    aspectRatio: "1000 / 1039",
    opacity: 0.07,
    filter: "invert(1)",
    pointerEvents: "none" as const,
    zIndex: 0,
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
    position: "relative" as const,
    width: "100%",
    aspectRatio: "4 / 5",
    borderRadius: 2,
    overflow: "hidden",
    backgroundColor: "var(--color-dark-teal-deep)",
  } satisfies React.CSSProperties,
} as const;

export default function Hero() {
  return (
    <section style={S.section} className="landing-section-pad">
      {/* Subtle café-theme watermark */}
      <div style={S.watermark} aria-hidden="true">
        <Image
          src="/illustrations/coffee-machine.png"
          alt=""
          fill
          sizes="520px"
          style={{ objectFit: "contain" }}
        />
      </div>

      <div className="landing-hero-grid" style={{ position: "relative", zIndex: 1 }}>
        {/* Left column */}
        <div className="reveal">
          <p style={S.eyebrow}>Heritage of Faith · Emalahleni</p>
          <h1 style={S.headline}>
            Coffee for<br />
            the family.
          </h1>
          <p style={S.body}>
            FAVO is the café at Heritage of Faith Ministries.
            Our baristas are iXchange interns — people learning to serve
            the community, one drink at a time. Come as you are.
          </p>
          <a href="/signup" style={S.cta}>
            Join the loyalty programme →
          </a>
        </div>

        {/* Right column — café photo (shown on mobile too via .landing-hero-visual) */}
        <div style={S.visual} className="landing-hero-visual">
          <Image
            src="/images/hero-barista.jpg"
            alt="A FAVO barista pulling a shot on the espresso machine"
            fill
            priority
            sizes="(max-width: 900px) 100vw, 40vw"
            style={{ objectFit: "cover" }}
          />
        </div>
      </div>
    </section>
  );
}
