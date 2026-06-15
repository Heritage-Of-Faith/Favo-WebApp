// Print-specific formatters — owner: Nikao (task N10)
// Pure functions, no interactive dependencies, safe for server and print contexts.
// All money formatting defers to formatZar() from src/lib/format.ts.

import { formatZar, formatDate } from "@/lib/format";

/**
 * Formats a cent value for use in financial summary tables.
 * Re-exported alias of formatZar for print-context clarity.
 */
export { formatZar as formatLineZar };

/**
 * Formats a date for print contexts (same as formatDate, re-exported for clarity).
 */
export { formatDate as formatPrintDate };

/**
 * Formats the gross profit margin as a percentage string.
 * @param revenue_zar - total revenue in cents
 * @param cogs_zar    - cost of goods sold in cents
 * @returns e.g. "62.1%"
 */
export function formatGrossMargin(revenue_zar: number, cogs_zar: number): string {
  if (revenue_zar === 0) return "0.0%";
  const margin = ((revenue_zar - cogs_zar) / revenue_zar) * 100;
  return `${margin.toFixed(1)}%`;
}

/**
 * Formats the net margin as a percentage string.
 * @param revenue_zar - total revenue in cents
 * @param net_zar     - net profit/loss in cents
 * @returns e.g. "18.4%"
 */
export function formatNetMargin(revenue_zar: number, net_zar: number): string {
  if (revenue_zar === 0) return "0.0%";
  const margin = (net_zar / revenue_zar) * 100;
  return `${margin.toFixed(1)}%`;
}

/**
 * Formats a refund amount for receipt display.
 * The refund is always shown with a single minus-sign prefix, regardless of
 * whether the caller passes the amount as positive or negative cents.
 * @param refund_zar - refund amount in cents (sign-insensitive)
 * @returns e.g. "−R12,50"
 */
export function formatRefundLine(refund_zar: number): string {
  return `−${formatZar(Math.abs(refund_zar))}`;
}
