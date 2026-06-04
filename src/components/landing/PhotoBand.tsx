// Full-bleed photo band — owner: Nikao (task N3)
// Sits between About and Visit. The big visual moment of the page.

import Image from "next/image";

const S = {
  section: {
    position: "relative" as const,
    width: "100%",
    height: "clamp(300px, 46vw, 520px)",
    overflow: "hidden",
    backgroundColor: "var(--color-coffee-bean)",
  } satisfies React.CSSProperties,
  overlay: {
    position: "absolute" as const,
    inset: 0,
    background:
      "linear-gradient(180deg, rgba(28,5,1,0) 35%, rgba(28,5,1,0.72) 100%)",
  } satisfies React.CSSProperties,
  caption: {
    position: "absolute" as const,
    left: 0,
    bottom: 0,
    padding: "0 40px 40px",
    maxWidth: 1200,
    margin: "0 auto",
    right: 0,
  } satisfies React.CSSProperties,
  kicker: {
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
    fontWeight: 900,
    fontSize: "clamp(1.5rem, 3vw, 2.75rem)",
    lineHeight: 1.0,
    letterSpacing: "0.04em",
    textTransform: "uppercase" as const,
    color: "var(--color-porcelain)",
    margin: 0,
    textShadow: "0 2px 16px rgba(28,5,1,0.4)",
  } satisfies React.CSSProperties,
} as const;

export default function PhotoBand() {
  return (
    <section style={S.section} aria-label="FAVO baristas serving the community">
      <Image
        src="/images/community-cup.jpg"
        alt="A member of the HOFMI community smiling with a FAVO coffee"
        fill
        priority
        sizes="100vw"
        style={{ objectFit: "cover", objectPosition: "center 32%" }}
      />
      <div style={S.overlay} />
      <div style={S.caption}>
        <p style={S.kicker}>Made by hand. Served with heart.</p>
      </div>
    </section>
  );
}
