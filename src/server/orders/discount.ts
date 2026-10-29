// L03 free weekday cup — the two date/category primitives (task G5).
// Weekday is evaluated in Africa/Johannesburg (rule L07 tz); only
// category='coffee' qualifies (T06). The rest of the decision lives in
// src/server/orders/free-coffee.ts; the once-per-day limit is the DB's
// UNIQUE(customer_id, day) on staff_entitlement_log.

const SAST = "Africa/Johannesburg";

/** Weekday (Mon–Fri) in Africa/Johannesburg wall-clock. */
export function isWeekdayInSAST(date: Date): boolean {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: SAST,
    weekday: "short",
  }).format(date);
  return ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday);
}

/**
 * Whether a menu item's category qualifies for the staff freebie.
 * Rule L03/L14: only items with category='coffee' qualify.
 */
export function isCoffeeCategory(category: string | null | undefined): boolean {
  return category === "coffee";
}
