// Team strip — owner: Nikao (task N3)
// Three baristas shown as a contained, framed row (not full-bleed). Sits on the
// Coffee Bean dark band between the light About and Visit sections.

import Image from "next/image";

const BARISTAS = [
  {
    src: "/images/hero-barista.jpg",
    alt: "A FAVO barista working at the espresso machine",
    position: "center 20%",
  },
  {
    src: "/images/community-cup.jpg",
    alt: "A FAVO barista smiling with a freshly made coffee",
    position: "center 20%",
  },
  {
    src: "/images/barista-counter.jpg",
    alt: "A FAVO barista at the counter ready to serve",
    position: "center 15%",
  },
] as const;

const S = {
  section: {
    backgroundColor: "var(--color-coffee-bean)",
  } satisfies React.CSSProperties,
  inner: {
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
} as const;

export default function TeamStrip() {
  return (
    <section style={S.section} className="landing-section-pad-l" aria-label="The FAVO barista team">
      <div style={S.inner}>
        <p style={S.eyebrow}>The team</p>
        <h2 style={S.heading}>Made by hand. Served with heart.</h2>

        <div style={S.grid} className="team-strip-grid">
          {BARISTAS.map((b) => (
            <div key={b.src} style={S.cell}>
              <Image
                src={b.src}
                alt={b.alt}
                fill
                sizes="(max-width: 640px) 90vw, 360px"
                style={{ objectFit: "cover", objectPosition: b.position }}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
