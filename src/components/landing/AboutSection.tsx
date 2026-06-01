// About section — owner: Nikao (task N3)
// Must render without JavaScript.

export default function AboutSection() {
  return (
    <section
      className="bg-porcelain px-m py-xxl"
      style={{ borderBottom: "1px solid var(--color-border-subtle)" }}
    >
      <div className="mx-auto max-w-[720px]">
        {/* Eyebrow */}
        <p className="favo-label mb-m">OUR COFFEE</p>

        {/* Heading */}
        <h2 className="favo-h2 text-coffee-bean mb-xl">
          SPECIFIC. TRANSPARENT. DIRECT.
        </h2>

        {/* Body */}
        <p className="favo-body mb-l">
          We source two to three single-origin lots per season — right now a
          washed Yirgacheffe from Dumerso, harvested November 2024, and a
          natural Burundi from Bukeye co-op. You will always find the farm name,
          altitude, and process on the menu board.
        </p>
        <p className="favo-body">
          Espresso is pulled on a La Marzocco Linea Classic at 9 bar, 28-second
          extraction. Filter is brewed to order on Kalita Wave. We do not keep
          batch brew. If you are in a hurry, order the espresso — it is ready in
          under a minute.
        </p>
      </div>
    </section>
  );
}
