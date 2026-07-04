// Staff discount eligibility — task G5
// Rules L03 + L14: staff free coffee is 1 per staff per weekday, 100% off,
// on ANY menu item where category='coffee' (hot chocolate, teas and other
// non-coffee items do NOT qualify). Weekday is evaluated in Africa/Johannesburg
// (rule L07 tz). The once-per-day limit is enforced by the DB
// UNIQUE(staff_id, day) constraint; this module covers the weekday + coffee
// category eligibility gate.

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

export type DiscountEligibility =
  | { eligible: true }
  | { eligible: false; code: "NOT_COFFEE" | "NOT_WEEKDAY"; message: string };

/**
 * Whether the staff free-coffee discount may be applied to this order now.
 * `hasCoffeeItem` must be true iff the order contains at least one line whose
 * menu item has category='coffee'. Does NOT check the once-per-day limit
 * (DB UNIQUE handles that on insert).
 */
export function checkStaffDiscountEligibility(
  hasCoffeeItem: boolean,
  now: Date
): DiscountEligibility {
  if (!hasCoffeeItem) {
    return {
      eligible: false,
      code: "NOT_COFFEE",
      message: "Staff discount applies to coffee items only (rule L03/L14).",
    };
  }
  if (!isWeekdayInSAST(now)) {
    return {
      eligible: false,
      code: "NOT_WEEKDAY",
      message: "Staff discount applies on weekdays only (rule L03).",
    };
  }
  return { eligible: true };
}
