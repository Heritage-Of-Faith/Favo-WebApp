// Refund receipt template — owner: Nikao (task N10)
// Pure render component: no hooks, no interactivity, no client-side code.
// Compact receipt layout for refund documentation and printing.
// Use CSS vars — not Tailwind utility classes (Tailwind v4 gotcha).

import { formatZar, formatDate } from "@/lib/format";
import { formatRefundLine } from "@/lib/report/format";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ReceiptProps {
  /** Order ID for reference */
  orderId: string;
  /** Line items on the order */
  items: Array<{ name: string; qty: number; unit_price_zar: number }>;
  /** Order total in integer cents */
  total_zar: number;
  /** Refund amount in integer cents */
  refund_zar: number;
  /** Reason for the refund */
  reason: string;
  /** Name of staff who requested the refund */
  requested_by: string;
  /** Name of staff who approved the refund */
  approved_by: string;
  /** ISO timestamp when refund was processed */
  at: string;
}

// ── Print styles ─────────────────────────────────────────────────────────────

const RECEIPT_PRINT_STYLES = `
@media print {
  @page {
    size: A4;
    margin: 20mm;
  }
  .receipt-root {
    font-size: 10pt !important;
    color: #000 !important;
    background: #fff !important;
  }
}
`;

// ── Component ─────────────────────────────────────────────────────────────────

export default function Receipt({
  orderId,
  items,
  total_zar,
  refund_zar,
  reason,
  requested_by,
  approved_by,
  at,
}: ReceiptProps) {
  const formattedAt = formatDate(at);
  const netTotal = total_zar - refund_zar;

  return (
    <>

      <style dangerouslySetInnerHTML={{ __html: RECEIPT_PRINT_STYLES }} />

      <article
        className="receipt-root"
        role="document"
        aria-label={`Refund Receipt — Order ${orderId}`}
        style={{
          fontFamily: "var(--font-sans)",
          color: "var(--color-coffee-bean)",
          background: "var(--color-paper)",
          maxWidth: "320px",
          margin: "0 auto",
          padding: "24px",
          boxSizing: "border-box",
          border: "1px solid var(--color-border-subtle)",
        }}
      >
        {/* ── Brand header ── */}
        <header
          style={{
            textAlign: "center",
            borderBottom: "2px solid var(--color-coffee-bean)",
            paddingBottom: "12px",
            marginBottom: "16px",
          }}
        >
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 900,
              fontSize: "1.5rem",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--color-coffee-bean)",
              margin: "0 0 4px",
              lineHeight: 1,
            }}
          >
            FAVO Café
          </h1>
          <p
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-caption)",
              color: "var(--color-text-muted)",
              margin: "0 0 8px",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            Heritage of Faith Ministries, Pretoria
          </p>
          <p
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: "var(--text-sub)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--color-crimson-carrot)",
              margin: 0,
            }}
          >
            Refund Receipt
          </p>
        </header>

        {/* ── Order metadata ── */}
        <section aria-label="Order details">
          <MetaRow label="Order ID" value={orderId} mono />
          <MetaRow label="Date" value={formattedAt} />
        </section>

        <Divider />

        {/* ── Line items ── */}
        <section aria-labelledby="items-heading">
          <h2
            id="items-heading"
            style={{
              fontFamily: "var(--font-sans)",
              fontWeight: 600,
              fontSize: "var(--text-caption)",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--color-text-muted)",
              margin: "0 0 8px",
            }}
          >
            Items
          </h2>

          {items.map((item, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: "6px",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: "var(--text-small)",
                  color: "var(--color-coffee-bean)",
                  flex: 1,
                  marginRight: "8px",
                }}
              >
                {item.qty > 1 && (
                  <span style={{ color: "var(--color-text-muted)", marginRight: "4px" }}>
                    {item.qty}×
                  </span>
                )}
                {item.name}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: "var(--text-small)",
                  color: "var(--color-coffee-bean)",
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                }}
              >
                {formatZar(item.unit_price_zar * item.qty)}
              </span>
            </div>
          ))}
        </section>

        <Divider />

        {/* ── Totals ── */}
        <section aria-label="Totals">
          <TotalRow label="Order Total" value={formatZar(total_zar)} />
          <TotalRow
            label="Refund"
            value={formatRefundLine(refund_zar)}
            highlight="negative"
          />
          <div style={{ borderTop: "2px solid var(--color-coffee-bean)", marginTop: "6px", paddingTop: "6px" }}>
            <TotalRow
              label="Net Total"
              value={formatZar(netTotal)}
              bold
            />
          </div>
        </section>

        <Divider />

        {/* ── Refund details ── */}
        <section aria-labelledby="refund-heading">
          <h2
            id="refund-heading"
            style={{
              fontFamily: "var(--font-sans)",
              fontWeight: 600,
              fontSize: "var(--text-caption)",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--color-text-muted)",
              margin: "0 0 8px",
            }}
          >
            Refund Details
          </h2>

          <MetaRow label="Reason" value={reason} />
          <MetaRow label="Requested by" value={requested_by} />
          <MetaRow label="Approved by" value={approved_by} />
        </section>

        {/* ── Footer ── */}
        <footer
          style={{
            borderTop: "1px solid var(--color-border-subtle)",
            marginTop: "16px",
            paddingTop: "12px",
            textAlign: "center",
          }}
        >
          <p
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-caption)",
              color: "var(--color-text-faint)",
              margin: 0,
            }}
          >
            Keep this receipt for your records
          </p>
        </footer>
      </article>
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Divider() {
  return (
    <hr
      style={{
        border: 0,
        borderTop: "1px dashed var(--color-border-subtle)",
        margin: "12px 0",
      }}
    />
  );
}

interface MetaRowProps {
  label: string;
  value: string;
  mono?: boolean;
}

function MetaRow({ label, value, mono = false }: MetaRowProps) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        marginBottom: "4px",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "var(--text-caption)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--color-text-muted)",
          marginRight: "8px",
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: mono ? "monospace" : "var(--font-sans)",
          fontSize: "var(--text-small)",
          color: "var(--color-coffee-bean)",
          textAlign: "right",
          wordBreak: "break-all",
        }}
      >
        {value}
      </span>
    </div>
  );
}

interface TotalRowProps {
  label: string;
  value: string;
  bold?: boolean;
  highlight?: "positive" | "negative";
}

function TotalRow({ label, value, bold = false, highlight }: TotalRowProps) {
  const valueColor =
    highlight === "positive"
      ? "var(--color-dark-teal)"
      : highlight === "negative"
        ? "var(--color-crimson-carrot)"
        : "var(--color-coffee-bean)";

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        marginBottom: "4px",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "var(--text-small)",
          fontWeight: bold ? 700 : 400,
          color: "var(--color-coffee-bean)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "var(--text-small)",
          fontWeight: bold ? 700 : 400,
          color: valueColor,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}
