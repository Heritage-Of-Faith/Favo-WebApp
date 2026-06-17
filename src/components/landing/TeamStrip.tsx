// Team strip — owner: Nikao (task N3)
// Three baristas shown as a contained, framed row (not full-bleed). Sits on the
// Coffee Bean dark band between the light About and Visit sections.

import Image from "next/image";

const BARISTAS = [
  {
    src: "/images/barista-pour.jpg",
    name: "Louis",
    alt: "Louis, a FAVO barista, pouring a fresh coffee",
    position: "center 25%",
  },
  {
    src: "/images/community-cup.jpg",
    name: "Thandeka",
    alt: "Thandeka, a FAVO barista, smiling with a freshly made coffee",
    position: "center 20%",
  },
  {
    src: "/images/barista-counter.jpg",
    name: "Nkuli",
    alt: "Nkuli, a FAVO barista, at the counter ready to serve",
    position: "center 15%",
  },
] as const;

const S = {
  section: {
    position: "relative" as const,
    overflow: "hidden",
    backgroundColor: "var(--color-coffee-bean)",
  } satisfies React.CSSProperties,
  // Hand-drawn coffee-bean watermark, bottom-left. filter:invert lifts the
  // black art to a warm light tone on the dark Coffee Bean fold.
  watermarkBean: {
    position: "absolute" as const,
    left: "-2%",
    bottom: "-8%",
    width: "clamp(200px, 23vw, 340px)",
    aspectRatio: "1000 / 1113",
    opacity: 0.09,
    filter: "invert(1)",
    pointerEvents: "none" as const,
    zIndex: 0,
  } satisfies React.CSSProperties,
  inner: {
    position: "relative" as const,
    zIndex: 1,
    maxWidth: 1100,
    margin: "0 auto",
  } satisfies React.CSSProperties,
  eyebrow: {
    fontFamily: "var(--font-sans)",
    fontWeight: 300,
    fontSize: 11,
    letterSpacing: "0.14em",
    textTransform: "uppercase" as const,
    color: "var(--color-crimson-carrot)",
    marginBottom: 6,
  } satisfies React.CSSProperties,
  heading: {
    fontFamily: "var(--font-display)",
    fontWeight: 900,
    fontSize: "clamp(1.75rem, 3vw, 2.75rem)",
    lineHeight: 1.0,
    letterSpacing: "var(--tracking-head)",
    textTransform: "uppercase" as const,
    color: "var(--color-porcelain)",
    margin: 0,
    marginBottom: 28,
  } satisfies React.CSSProperties,
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 16,
  } satisfies React.CSSProperties,
  cell: {
    position: "relative" as const,
    aspectRatio: "4 / 5",
    borderRadius: 2,
    overflow: "hidden",
    backgroundColor: "var(--color-coffee-bean-deep)",
  } satisfies React.CSSProperties,
  name: {
    fontFamily: "var(--font-display)",
    fontWeight: 700,
    fontSize: "clamp(1.125rem, 2vw, 1.5rem)",
    letterSpacing: "var(--tracking-head)",
    textTransform: "uppercase" as const,
    color: "var(--color-porcelain)",
    margin: "12px 0 0",
  } satisfies React.CSSProperties,
  role: {
    fontFamily: "var(--font-sans)",
    fontWeight: 300,
    fontSize: 11,
    letterSpacing: "0.14em",
    textTransform: "uppercase" as const,
    color: "var(--color-crimson-carrot)",
    margin: "2px 0 0",
  } satisfies React.CSSProperties,
} as const;

export default function TeamStrip() {
  return (
    <section style={S.section} className="landing-section-pad-l" aria-label="The FAVO barista team">
      {/* Subtle café-theme watermark */}
      <div style={S.watermarkBean} aria-hidden="true">
        <Image
          src="/illustrations/coffee-bean.png"
          alt=""
          fill
          sizes="250px"
          style={{ objectFit: "contain" }}
        />
      </div>

      <div style={S.inner}>
        <p style={S.eyebrow}>The team</p>
        <h2 style={S.heading}>Made by hand. Served with heart.</h2>

        <div style={S.grid} className="team-strip-grid reveal-stagger">
          {BARISTAS.map((b) => (
            <div key={b.src}>
              <div style={S.cell}>
                <Image
                  src={b.src}
                  alt={b.alt}
                  fill
                  sizes="(max-width: 640px) 90vw, 360px"
                  style={{ objectFit: "cover", objectPosition: b.position }}
                />
              </div>
              <p style={S.name}>{b.name}</p>
              <p style={S.role}>iXchange intern</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
