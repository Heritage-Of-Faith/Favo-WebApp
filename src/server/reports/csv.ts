// One CSV cell encoder for every report writer (RFC 4180 + SEC-8).
//
// SEC-8 formula guard: Excel / Sheets run a cell that starts with = + - @
// (or tab / CR) as a formula, so a customer named "=HYPERLINK(...)" would
// become live in an export. Such TEXT cells get a leading single quote.
// Numbers, plain signed numbers ("-12.5", "+12,5") and plain rand amounts as
// formatZar writes them ("-R 12,50", "-R 1 234 567,89") are left alone so
// negative figures stay readable. \s covers the no-break and narrow no-break
// spaces Intl puts in amounts.

const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[-+]?\d+([.,]\d+)?$/;
const PLAIN_RAND = /^[-+]?R\s?\d{1,3}(\s?\d{3})*([.,]\d{1,2})?$/;

export function csvCell(value: string | number | null | undefined): string {
  let s = value == null ? "" : String(value);
  if (typeof value === "string" && FORMULA_START.test(s) && !PLAIN_NUMBER.test(s) && !PLAIN_RAND.test(s)) {
    s = `'${s}`;
  }
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
