// AT-189 · AT-190 · AT-191 · AT-192 — REQ-106, REQ-109, REQ-110, REQ-129, REQ-131.
// PRD §7.0.2 (cogs_zar = Σ order_cogs, the refusal rule L1790–1795),
// §7.0.1b (cost_source → provisional, never green), §7.5 / REQ-129 (three
// states, three renderings), §17.6.1 (--status-warn ≠ --status-unavailable).
//
// Pure and client-safe: the server sums with it, the screens and exports
// render with it. Every period figure is a SUM of per-order integers already
// rounded once at order_cogs — nothing here rounds (REQ-106).
//
// The states, never conflated (CLAUDE.md §5):
//   empty       — no order in the period that carried a cost: a genuine zero.
//   unavailable — some order's cost input is absent: no number, the item named.
//   provisional — every cost is present, but some lot is (or may be) an estimate.
//   final       — every contributing lot is invoice-backed.

export type CostState = "empty" | "unavailable" | "provisional" | "final";

/** One order's frozen order_cogs row, as a period read sees it. */
export type OrderCogsRow = {
  /** NULL when the order has no order_cogs row, or the row refused. */
  cogsZar: number | null;
  absentItemIds: readonly string[];
  /**
   * order_cogs.estimated. NULL (unknown — e.g. written before cost_source
   * existed) is NOT treated as invoice-backed: green needs proof (§7.0.1b
   * "turns green only when every contributing lot is invoice-backed").
   */
  estimated: boolean | null;
  /** True when the order has no order_cogs row at all. */
  missing?: boolean;
};

export type CostRollup = {
  state: CostState;
  /** Σ order_cogs, integer cents. NULL whenever state is "unavailable". */
  cogsZar: number | null;
  /** Inventory item ids named by the refusal, sorted, each once. */
  absentItemIds: string[];
  /** Orders in the period with no order_cogs row (also a refusal). */
  ordersWithoutCost: number;
  orderCount: number;
};

/** Σ order_cogs over a period, with the refusal rule and the provisional flag. */
export function rollupOrderCogs(rows: readonly OrderCogsRow[]): CostRollup {
  let total = 0;
  let refused = false;
  let provisional = false;
  let costed = false;
  let ordersWithoutCost = 0;
  const absent = new Set<string>();

  for (const r of rows) {
    if (r.missing) {
      ordersWithoutCost += 1;
      refused = true;
      continue;
    }
    if (r.cogsZar === null) {
      refused = true;
      for (const id of r.absentItemIds) absent.add(id);
      continue;
    }
    // An order that costed nothing (cogs 0 — e.g. it consumed no costed unit)
    // is no evidence either way: it can neither make a period "final" (green)
    // nor provisional. A period made only of such orders reads "empty".
    if (r.cogsZar === 0) continue;
    total += r.cogsZar;
    costed = true;
    if (r.estimated !== false) provisional = true;
  }

  const absentItemIds = [...absent].sort();
  if (refused) {
    return { state: "unavailable", cogsZar: null, absentItemIds, ordersWithoutCost, orderCount: rows.length };
  }
  const state: CostState = !costed ? "empty" : provisional ? "provisional" : "final";
  return { state, cogsZar: total, absentItemIds: [], ordersWithoutCost: 0, orderCount: rows.length };
}

/**
 * Combines the states of sub-periods (e.g. the days of a trend window).
 * Any unavailable → unavailable; else any provisional → provisional; else any
 * final → final; else empty.
 */
export function combineCostStates(states: readonly CostState[]): CostState {
  if (states.includes("unavailable")) return "unavailable";
  if (states.includes("provisional")) return "provisional";
  if (states.includes("final")) return "final";
  return "empty";
}

export type NetTone = "neutral" | "positive" | "negative" | "warn" | "unavailable";

/**
 * The profit/loss flag's tone. Green ("positive") ONLY on a final state —
 * a provisional figure is "warn" whatever its sign (§7.0.1b: "never green —
 * --status-warn, never --status-success"), and unavailable has its own tone.
 */
export function netTone(state: CostState, netZar: number | null): NetTone {
  if (state === "unavailable" || netZar === null) return "unavailable";
  if (state === "provisional") return "warn";
  if (state === "empty") return "neutral";
  return netZar >= 0 ? "positive" : "negative";
}

/** The net/profit word per tone. An empty (R0) period reads "No sales", never "loss". */
export function netLabel(tone: NetTone): string {
  switch (tone) {
    case "unavailable":
      return UNAVAILABLE;
    case "warn":
      return PROVISIONAL;
    case "negative":
      return "loss";
    case "positive":
      return "profit";
    case "neutral":
      return "No sales";
  }
}

export type PeriodFigures = {
  revenueZar: number;
  /** NULL = UNAVAILABLE. */
  cogsZar: number | null;
  /** revenue − cogs. NULL when cogs is. */
  grossMarginZar: number | null;
  expensesZar: number;
  /** revenue − cogs − expenses. NULL when cogs is. */
  netZar: number | null;
  /** cogs as % of revenue, 2 dp. NULL when cogs is NULL or revenue is 0. */
  cogsPctOfRevenue: number | null;
  /** gross margin as % of revenue, 2 dp. NULL when cogs is NULL or revenue is 0. */
  grossMarginPct: number | null;
  costState: CostState;
  tone: NetTone;
  label: string;
};

/** A display percentage of two integer-cent figures, to 2 dp (not a money amount). */
function pctOf(part: number | null, whole: number): number | null {
  if (part === null || whole === 0) return null;
  return Math.round((part / whole) * 10000) / 100;
}

/**
 * THE one place a period's derived figures are computed — dashboard tiles and
 * donut, the CSV/PDF export, the weekly and the monthly report all call this,
 * so the same orders give the same numbers everywhere. Every input and output
 * is integer cents; nothing here rounds money (REQ-106).
 */
export function periodFigures(input: {
  revenueZar: number;
  cogsZar: number | null;
  expensesZar: number;
  costState: CostState;
}): PeriodFigures {
  const { revenueZar, cogsZar, expensesZar, costState } = input;
  const grossMarginZar = cogsZar === null ? null : revenueZar - cogsZar;
  const netZar = grossMarginZar === null ? null : grossMarginZar - expensesZar;
  // An empty period (no costed order) is neutral whatever its expenses — never
  // "loss", never green (N3).
  const tone = netTone(costState, netZar);
  return {
    revenueZar,
    cogsZar,
    grossMarginZar,
    expensesZar,
    netZar,
    cogsPctOfRevenue: pctOf(cogsZar, revenueZar),
    grossMarginPct: pctOf(grossMarginZar, revenueZar),
    costState,
    tone,
    label: tone === "neutral" && revenueZar > 0 ? "no cost recorded" : netLabel(tone),
  };
}

/** CSS colour per tone — §17.6.1: warn and unavailable are their own tokens. */
export const NET_TONE_COLOR: Record<NetTone, string> = {
  neutral: "var(--color-text-strong)",
  positive: "var(--color-success)",
  negative: "var(--color-error)",
  warn: "var(--status-warn)",
  unavailable: "var(--status-unavailable)",
};

/** The literal render word for an absent input (§7.0.2, REQ-109, REQ-129). */
export const UNAVAILABLE = "UNAVAILABLE";

/** The label for an estimated figure (§7.0.1b, REQ-110, REQ-131). */
export const PROVISIONAL = "provisional";

/**
 * "UNAVAILABLE — Oat milk, Macadamia milk" — the named refusal. `names` maps
 * inventory item id → display name; an unknown id is shown as the id.
 */
export function unavailableText(
  absentItemIds: readonly string[],
  ordersWithoutCost: number,
  names?: ReadonlyMap<string, string>
): string {
  const parts = absentItemIds.map((id) => names?.get(id) ?? id);
  if (ordersWithoutCost > 0) {
    parts.push(`${ordersWithoutCost} order${ordersWithoutCost === 1 ? "" : "s"} with no recorded cost`);
  }
  return parts.length > 0 ? `${UNAVAILABLE} — ${parts.join(", ")}` : UNAVAILABLE;
}

/** The export's status column: one word per state, plus the names on a refusal. */
export function costStatusLabel(rollup: Pick<CostRollup, "state" | "absentItemIds" | "ordersWithoutCost">, names?: ReadonlyMap<string, string>): string {
  switch (rollup.state) {
    case "unavailable":
      return unavailableText(rollup.absentItemIds, rollup.ordersWithoutCost, names);
    case "provisional":
      return `${PROVISIONAL} (estimated costs)`;
    case "final":
      return "final";
    case "empty":
      return "no orders";
  }
}
