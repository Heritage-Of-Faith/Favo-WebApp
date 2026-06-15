// Monthly P&L report template — owner: Nikao (task N10)
// Pure render component: no hooks, no interactivity, no client-side code.
// Designed for A4 print via @media print. Use CSS vars — not Tailwind utility classes
// (Tailwind v4 custom @theme tokens do not generate utility classes).

import { formatZar, formatDate } from "@/lib/format";
import { formatGrossMargin, formatNetMargin } from "@/lib/report/format";

// ── Types ────────────────────────────────────────────────────────────────────

export interface MonthlyReportTemplateProps {
  /** Display period, e.g. "May 2026" */
  period: string;
  /** Total revenue in integer cents */
  revenue_zar: number;
  /** Cost of goods sold in integer cents */
  cogs_zar: number;
  /** Operating expenses in integer cents */
  expenses_zar: number;
  /** Net profit/loss in integer cents */
  net_zar: number;
  /** Approver sign-off rows */
  approvers: Array<{ name: string; role: string; at: string }>;
}

// ── Print styles ─────────────────────────────────────────────────────────────
// Injected via a <style> tag so they travel with the component during SSR.
// Media queries cannot live in inline styles, hence this approach.

const PRINT_STYLES = `
@media print {
  @page {
    size: A4;
    margin: 20mm;
  }
  .report-root {
    font-size: 11pt !important;
    color: #000 !important;
    background: #fff !important;
  }
}
`;

// ── Sub-components ────────────────────────────────────────────────────────────

interface FinancialRowProps {
  label: string;
  amount: number;
  margin: string | null;
  bold?: boolean;
  indent?: boolean;
  separator?: boolean;
  highlight?: "positive" | "negative";
}

function FinancialRow({
  label,
  amount,
  margin,
  bold = false,
  indent = false,
  separator = false,
  highlight,
}: FinancialRowProps) {
  const amountColor =
    highlight === "positive"
      ? "var(--color-dark-teal)"
      : highlight === "negative"
        ? "var(--color-crimson-carrot)"
        : "var(--color-coffee-bean)";

  return (
    <tr
      style={{
        borderTop: separator ? "1px solid var(--color-border-subtle)" : undefined,
        borderBottom: separator ? "2px solid var(--color-coffee-bean)" : undefined,
      }}
    >
      <td
        style={{
          padding: "10px 0",
          paddingLeft: indent ? "20px" : undefined,
          fontWeight: bold ? 700 : 400,
          fontFamily: "var(--font-sans)",
          color: "var(--color-coffee-bean)",
          fontSize: "var(--text-base)",
        }}
      >
        {label}
      </td>
      <td
        style={{
          padding: "10px 0",
          textAlign: "right",
          fontWeight: bold ? 700 : 400,
          fontFamily: "var(--font-sans)",
          color: amountColor,
          fontSize: "var(--text-base)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {formatZar(amount)}
      </td>
      <td
        style={{
          padding: "10px 0 10px 16px",
          textAlign: "right",
          fontFamily: "var(--font-sans)",
          fontSize: "var(--text-small)",
          color: "var(--color-text-muted)",
          fontVariantNumeric: "tabular-nums",
          width: "80px",
        }}
      >
        {margin ?? ""}
      </td>
    </tr>
  );
}

interface ApproverBlockProps {
  name: string;
  role: string;
  at: string;
}

function ApproverBlock({ name, role, at }: ApproverBlockProps) {
  const formattedAt = formatDate(at);
  return (
    <div>
      <div
        aria-hidden="true"
        style={{
          borderBottom: "1px solid var(--color-coffee-bean)",
          height: "48px",
          marginBottom: "8px",
        }}
      />
      <p
        style={{
          fontFamily: "var(--font-sans)",
          fontWeight: 700,
          fontSize: "var(--text-base)",
          color: "var(--color-coffee-bean)",
          margin: "0 0 2px",
        }}
      >
        {name}
      </p>
      <p
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "var(--text-small)",
          color: "var(--color-text-muted)",
          margin: "0 0 2px",
        }}
      >
        {role}
      </p>
      <p
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "var(--text-caption)",
          color: "var(--color-text-faint)",
          margin: 0,
        }}
      >
        {formattedAt}
      </p>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MonthlyReportTemplate({
  period,
  revenue_zar,
  cogs_zar,
  expenses_zar,
  net_zar,
  approvers,
}: MonthlyReportTemplateProps) {
  const grossProfit = revenue_zar - cogs_zar;
  const isNetPositive = net_zar >= 0;

  return (
    <>

      <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />

      <article
        className="report-root"
        role="document"
        aria-label={`Monthly P&L Report — ${period}`}
        style={{
          fontFamily: "var(--font-sans)",
          color: "var(--color-coffee-bean)",
          background: "var(--color-paper)",
          maxWidth: "210mm",
          margin: "0 auto",
          padding: "20mm",
          boxSizing: "border-box",
          minHeight: "297mm",
        }}
      >
        {/* ── Brand header ── */}
        <header
          style={{
            borderBottom: "3px solid var(--color-coffee-bean)",
            paddingBottom: "12px",
            marginBottom: "24px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-end",
            }}
          >
            <div>
              <h1
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 900,
                  fontSize: "2rem",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--color-coffee-bean)",
                  margin: 0,
                  lineHeight: 1,
                }}
              >
                FAVO Café
              </h1>
              <p
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: "var(--text-small)",
                  color: "var(--color-text-muted)",
                  margin: "4px 0 0",
                }}
              >
                Heritage of Faith Ministries, Pretoria
              </p>
            </div>
            <div style={{ textAlign: "right" }}>
              <p
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: "var(--text-small)",
                  color: "var(--color-text-faint)",
                  margin: 0,
                }}
              >
                Monthly P&amp;L Report
              </p>
              <p
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 700,
                  fontSize: "var(--text-h3)",
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: "var(--color-coffee-bean)",
                  margin: "2px 0 0",
                }}
              >
                {period}
              </p>
            </div>
          </div>
        </header>

        {/* ── Financial summary table ── */}
        <section aria-labelledby="financials-heading">
          <h2
            id="financials-heading"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: "var(--text-sub)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--color-coffee-bean)",
              margin: "0 0 12px",
              borderBottom: "1px solid var(--color-border-subtle)",
              paddingBottom: "6px",
            }}
          >
            Financial Summary
          </h2>

          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-base)",
            }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: "2px solid var(--color-coffee-bean)",
                }}
              >
                <th
                  style={{
                    textAlign: "left",
                    padding: "8px 0",
                    fontWeight: 600,
                    color: "var(--color-text-muted)",
                    fontSize: "var(--text-small)",
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                  }}
                >
                  Line Item
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: "8px 0",
                    fontWeight: 600,
                    color: "var(--color-text-muted)",
                    fontSize: "var(--text-small)",
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                  }}
                >
                  Amount
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: "8px 0 8px 16px",
                    fontWeight: 600,
                    color: "var(--color-text-muted)",
                    fontSize: "var(--text-small)",
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    width: "80px",
                  }}
                >
                  Margin
                </th>
              </tr>
            </thead>
            <tbody>
              <FinancialRow label="Revenue" amount={revenue_zar} margin={null} bold />
              <FinancialRow label="Cost of Goods Sold (COGS)" amount={cogs_zar} margin={null} indent />
              <FinancialRow
                label="Gross Profit"
                amount={grossProfit}
                margin={formatGrossMargin(revenue_zar, cogs_zar)}
                separator
              />
              <FinancialRow label="Operating Expenses" amount={expenses_zar} margin={null} indent />
              <FinancialRow
                label="Net Profit / (Loss)"
                amount={net_zar}
                margin={formatNetMargin(revenue_zar, net_zar)}
                bold
                separator
                highlight={isNetPositive ? "positive" : "negative"}
              />
            </tbody>
          </table>
        </section>

        {/* ── Spacer ── */}
        <div style={{ marginTop: "40px" }} />

        {/* ── Signatures block ── */}
        <section aria-labelledby="signatures-heading">
          <h2
            id="signatures-heading"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: "var(--text-sub)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--color-coffee-bean)",
              margin: "0 0 16px",
              borderBottom: "1px solid var(--color-border-subtle)",
              paddingBottom: "6px",
            }}
          >
            Approvals
          </h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${Math.min(approvers.length, 3)}, 1fr)`,
              gap: "24px",
            }}
          >
            {approvers.map((approver, i) => (
              <ApproverBlock key={i} {...approver} />
            ))}
          </div>
        </section>

        {/* ── Footer ── */}
        <footer
          style={{
            paddingTop: "24px",
            borderTop: "1px solid var(--color-border-subtle)",
            marginTop: "60px",
          }}
        >
          <p
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-caption)",
              color: "var(--color-text-faint)",
              margin: 0,
              textAlign: "center",
            }}
          >
            FAVO Café · Heritage of Faith Ministries, Pretoria · Confidential — for internal use only
          </p>
        </footer>
      </article>
    </>
  );
}
