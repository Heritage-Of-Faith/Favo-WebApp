export const WASTE_MAX_QTY = 500;

/** Longest waste reason accepted, server-side and in the dialog (QA R5-SEC-2). */
export const WASTE_REASON_MAX = 500;

/** waste_category enum values (db/enums.ts wasteCategory). */
export const WASTE_CATEGORIES = ["expired", "damaged", "spilled", "overproduction", "other"] as const;

/** Shown when an item has no lot that can take waste and none is open. */
export const NO_STOCK_TO_WASTE = "No stock to waste for this item.";

/**
 * Lot states logWaste accepts (PRD §10 logWaste: INVALID_LOT_STATE otherwise).
 * An open container is deliberately not one of them: its cost is booked at
 * open, and the PRD's way to retire it is closeContainer, which writes the
 * leftover off COGS-neutrally (§10 closeContainer) — a waste row on top would
 * count it twice. The picker offers only these states (QA R4 barista P2-1).
 */
export const WASTEABLE_LOT_STATES = ["active", "depleted"] as const;

export function isWasteableLotState(state: string): boolean {
  return (WASTEABLE_LOT_STATES as readonly string[]).includes(state);
}

/** Plain refusal for a lot waste cannot be logged against. */
export function lotStateRefusalMessage(state: string): string {
  if (state === "open") {
    return "This bag or carton is open. To bin what is left, tap Close on its stock tile.";
  }
  const article = /^[aeiou]/i.test(state) ? "an" : "a";
  return `Cannot log waste against ${article} ${state} lot.`;
}

/** Message for an unacceptable waste quantity, or null when it is fine (whole number 1..500). */
export function wasteQuantityError(raw: string): string | null {
  const s = raw.trim();
  if (!/^\d+$/.test(s) || Number(s) < 1) return "Quantity must be a whole number of 1 or more.";
  if (Number(s) > WASTE_MAX_QTY) return `Quantity is too large. The most you can log at once is ${WASTE_MAX_QTY}.`;
  return null;
}
