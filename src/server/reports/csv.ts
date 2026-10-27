// One CSV cell encoder for every report writer (RFC 4180 + SEC-8).
//
// SEC-8 formula guard: Excel / Sheets run a cell that starts with = + - @
// (or tab / CR) as a formula, so a customer named "=HYPERLINK(...)" would
// become live in an export. Such TEXT cells get a leading single quote.
// Numbers, and strings that are just a number (e.g. "-12.5"), are left alone
// so negative figures stay numeric.

const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export function csvCell(value: string | number | null | undefined): string {
  let s = value == null ? "" : String(value);
  if (typeof value === "string" && FORMULA_START.test(s) && !PLAIN_NUMBER.test(s)) {
    s = `'${s}`;
  }
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
