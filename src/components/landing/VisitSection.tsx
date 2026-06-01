// Visit / find-us section — owner: Nikao (task N3)
// Must render without JavaScript.
// TODO: replace with actual address and static map image before launch

export default function VisitSection() {
  return (
    <section className="bg-coffee-bean px-m py-xxl">
      <div className="mx-auto max-w-[720px]">
        {/* Eyebrow */}
        <p className="favo-label mb-m" style={{ color: "var(--color-porcelain)" }}>
          FIND US
        </p>

        {/* Address block */}
        <address className="not-italic mb-xl">
          <p
            className="favo-h2 mb-s"
            style={{ color: "var(--color-porcelain)" }}
          >
            12 Bean Street
          </p>
          <p
            className="favo-body opacity-80"
            style={{ color: "var(--color-porcelain)" }}
          >
            Cape Town, Western Cape
          </p>
        </address>

        {/* Static map image — no external JS, no iframe */}
        <div
          className="overflow-hidden max-w-[600px]"
          style={{
            border: "1px solid var(--color-border-subtle)",
            borderRadius: "var(--radius-card)",
          }}
        >
          <img
            src="/brand/map-placeholder.jpg"
            alt="Map showing FAVO Café at 12 Bean Street, Cape Town"
            width={600}
            height={300}
            className="block w-full h-auto object-cover"
          />
        </div>
      </div>
    </section>
  );
}
