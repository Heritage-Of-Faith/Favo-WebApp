// Staff discount eligibility — task G5
// Rules L03 + L14: staff free coffee is 1 per staff per weekday, 100% off,
// Cappuccinos only. Weekday is evaluated in Africa/Johannesburg (rule L07 tz).
// The once-per-day limit is enforced by the DB UNIQUE(staff_id, day) constraint;
// this module covers the weekday + cappuccino eligibility gate.

const SAST = "Africa/Johannesburg";

/** Weekday (Mon–Fri) in Africa/Johannesburg wall-clock. */
export function isWeekdayInSAST(date: Date): boolean {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: SAST,
    weekday: "short",
  }).format(date);
  return ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday);
}

/** A menu item qualifies for the staff freebie only if it is a Cappuccino. */
export function isCappuccino(menuItemName: string): boolean {
  return menuItemName.trim().toLowerCase() === "cappuccino";
}

export type DiscountEligibility =
  | { eligible: true }
  | { eligible: false; code: "NOT_CAPPUCCINO" | "NOT_WEEKDAY"; message: string };

/**
 * Whether the staff free-coffee discount may be applied to this item now.
 * Does NOT check the once-per-day limit (DB UNIQUE handles that on insert).
 */
export function checkStaffDiscountEligibility(
  menuItemName: string,
  now: Date
): DiscountEligibility {
  if (!isCappuccino(menuItemName)) {
    return {
      eligible: false,
      code: "NOT_CAPPUCCINO",
      message: "Staff discount applies to Cappuccinos only (rule L03).",
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
