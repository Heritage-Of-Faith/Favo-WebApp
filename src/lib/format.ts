// Formatting utilities — owner: Nikao (task N1)
// Rule: money is always integer cents in _zar columns. Never numeric.
// Rule: wall-clock is always Africa/Johannesburg.

const ZAR_LOCALE = "en-ZA";
const FAVO_TZ = "Africa/Johannesburg";

/**
 * Formats integer cents as a ZAR currency string.
 * @example formatZar(1250) → "R12,50"
 * @example formatZar(0) → "R0,00"
 */
export function formatZar(cents: number): string {
  const rands = cents / 100;
  return new Intl.NumberFormat(ZAR_LOCALE, {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
    .format(rands)
    .replace("ZAR", "R")
    .trim();
}

/**
 * Formats a date/timestamp in the Africa/Johannesburg timezone.
 * @example formatDate(new Date(), "Africa/Johannesburg") → "29 May 2026, 08:30"
 */
export function formatDate(
  date: Date | string,
  tz: string = FAVO_TZ
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(ZAR_LOCALE, {
    timeZone: tz,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/**
 * Returns the current revenue day as YYYY-MM-DD in Africa/Johannesburg.
 * Midnight SAST is the day boundary (business rule L07).
 */
export function revenueDay(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FAVO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Returns the UTC Date for 00:00:00 SAST on the given YYYY-MM-DD string.
 * Africa/Johannesburg is UTC+2 year-round (no DST).
 * Use this for inclusive date-range lower bounds in DB queries.
 */
export function startOfDaySast(dateStr: string): Date {
  // Midnight SAST = 22:00 UTC the previous calendar day.
  return new Date(`${dateStr}T00:00:00.000+02:00`);
}

/**
 * Returns the UTC Date for 23:59:59.999 SAST on the given YYYY-MM-DD string.
 * Africa/Johannesburg is UTC+2 year-round (no DST).
 * Use this for inclusive date-range upper bounds in DB queries.
 */
export function endOfDaySast(dateStr: string): Date {
  return new Date(`${dateStr}T23:59:59.999+02:00`);
}
