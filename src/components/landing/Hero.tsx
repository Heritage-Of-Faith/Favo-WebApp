// Landing hero section — owner: Nikao (task N3)
// Must render without JavaScript. Lighthouse mobile >= 90.

export default function Hero() {
  return (
    <section className="bg-dark-teal px-m py-xxl">
      <div className="mx-auto max-w-[1200px] py-xxl">
        {/* FAVO wordmark */}
        <p
          className="favo-label mb-xl opacity-70"
          style={{ color: "var(--color-porcelain)", letterSpacing: "var(--tracking-cta)" }}
        >
          FAVO
        </p>

        {/* Hero headline */}
        <h1 className="favo-hero text-porcelain mb-l">
          Single-origin.<br />No shortcuts.
        </h1>

        {/* Sub-line */}
        <p
          className="favo-body text-porcelain mb-xl opacity-85"
          style={{ maxWidth: "40ch" }}
        >
          Every cup names the farm, the harvest, and the roast date.
          We pull espresso at 93°C and brew filter to order — nothing sits on a burner.
        </p>

        {/* CTA */}
        <a
          href="/customer/login"
          className="favo-cta inline-block bg-crimson-carrot text-porcelain no-underline"
          style={{
            padding: "0 var(--spacing-xl)",
            borderRadius: "var(--radius-btn)",
            minHeight: "44px",
            lineHeight: "44px",
          }}
        >
          JOIN THE LOYALTY PROGRAMME →
        </a>
      </div>
    </section>
  );
}
