// AT-208 · REQ-139 — margin broken out by shot count. PRD §6.2.3 L762, §7.1
// L1940, §7.3 L1961. REQ-106 / REQ-109 / REQ-110 apply (§7.0.2, L39).
//
// Built on the ONE figure path, not beside it: each order contributes its
// frozen order_cogs integer (rounded once, at the sale) and its
// orders.total_zar, rolled up by rollupOrderCogs and passed through
// periodFigures. Nothing here rounds money and nothing is apportioned.
//
// Grouped by mode first (§7.1: by mode, never blended), then by shot count.
// An order is attributed WHOLE to one bucket, by the shot counts of its coffee
// lines (lines whose recipe draws beans):
//   one distinct count n → n   ·   two or more → "mixed"   ·   none → "no_coffee"
// Splitting a mixed order's order_cogs across lines would need a per-line cost
// that is never rounded on its own — a second rounding point (§7.0.2). So it
// stays whole, and the buckets always sum to the period's cogs_zar.
//
// Refusal (§7.0.2 "if ANY ingredient consumed in the period … every margin
// percentage render[s] as UNAVAILABLE"): one absent input anywhere in the
// period makes every bucket UNAVAILABLE, with the period's items named.
// Provisional is per bucket: a figure built only from invoice-backed lots is
// final; one touching an estimate is provisional, never green.

import {
  periodFigures,
  rollupOrderCogs,
  type CostRollup,
  type OrderCogsRow,
  type PeriodFigures,
} from "@/lib/cost-state";

export type ShotBucket = number | "mixed" | "no_coffee";

/**
 * The order's mode (§7.1: "reports by mode rather than as one blended
 * figure"). Orders carry no session link, so — as cup-lid.ts does for L24 —
 * the mode is the revenue day's opening_sessions mode: one mode across the
 * day's sessions → that mode; sessions of different modes → "mixed_day"; no
 * session → "no_session". A weekday free cup (R0, real COGS) therefore never
 * lands in a Sunday or event bucket.
 */
export type DayMode = "weekday" | "sunday" | "event" | "mixed_day" | "no_session";

const MODE_ORDER: readonly DayMode[] = ["sunday", "event", "weekday", "mixed_day", "no_session"];

export function dayMode(value: string | null | undefined): DayMode {
  return (MODE_ORDER as readonly string[]).includes(value ?? "") ? (value as DayMode) : "no_session";
}

export function dayModeLabel(m: DayMode): string {
  switch (m) {
    case "sunday":
      return "Sunday";
    case "event":
      return "Event";
    case "weekday":
      return "Weekday";
    case "mixed_day":
      return "Days with mixed sessions";
    case "no_session":
      return "No opening session";
  }
}

/** One order in the period, as the margin-by-shot read sees it. */
export type ShotOrder = {
  mode: DayMode;
  /** orders.total_zar — order_net_charged. */
  netChargedZar: number;
  /** order_items.shots of the order's coffee lines (duplicates allowed). */
  coffeeShots: readonly number[];
  cogs: OrderCogsRow;
};

export type ShotMargin = PeriodFigures & {
  mode: DayMode;
  bucket: ShotBucket;
  orderCount: number;
  absentItemIds: string[];
  ordersWithoutCost: number;
};

export function shotBucket(coffeeShots: readonly number[]): ShotBucket {
  const distinct = [...new Set(coffeeShots)];
  if (distinct.length === 0) return "no_coffee";
  if (distinct.length > 1) return "mixed";
  return distinct[0];
}

function rank(b: ShotBucket): number {
  if (b === "mixed") return 1000;
  if (b === "no_coffee") return 1001;
  return b;
}

/**
 * Margin per (mode, shot bucket) over a period, modes in the order Sunday,
 * event, weekday, mixed day, no session; buckets with no order are omitted.
 */
export function marginByShot(orders: readonly ShotOrder[]): ShotMargin[] {
  const period = rollupOrderCogs(orders.map((o) => o.cogs));

  const groups = new Map<string, { mode: DayMode; bucket: ShotBucket; list: ShotOrder[] }>();
  for (const o of orders) {
    const bucket = shotBucket(o.coffeeShots);
    const key = `${o.mode}|${bucket}`;
    const g = groups.get(key) ?? { mode: o.mode, bucket, list: [] };
    g.list.push(o);
    groups.set(key, g);
  }

  return [...groups.values()]
    .sort((a, b) => MODE_ORDER.indexOf(a.mode) - MODE_ORDER.indexOf(b.mode) || rank(a.bucket) - rank(b.bucket))
    .map(({ mode, bucket, list }) => {
      const own = rollupOrderCogs(list.map((o) => o.cogs));
      const cost: CostRollup = period.state === "unavailable" ? period : own;
      const revenueZar = list.reduce((s, o) => s + o.netChargedZar, 0);
      return {
        mode,
        bucket,
        orderCount: list.length,
        absentItemIds: cost.absentItemIds,
        ordersWithoutCost: cost.ordersWithoutCost,
        // Margin by shot is a gross margin: expenses are not attributable to a shot count.
        ...periodFigures({ revenueZar, cogsZar: cost.cogsZar, expensesZar: 0, costState: cost.state }),
      };
    });
}

/** "1 shot", "2 shots", "Mixed shots", "No coffee". */
export function shotBucketLabel(b: ShotBucket): string {
  if (b === "mixed") return "Mixed shots";
  if (b === "no_coffee") return "No coffee";
  return `${b} shot${b === 1 ? "" : "s"}`;
}
