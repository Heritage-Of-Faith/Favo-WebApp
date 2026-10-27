export const WASTE_MAX_QTY = 500;

/** Message for an unacceptable waste quantity, or null when it is fine (whole number 1..500). */
export function wasteQuantityError(raw: string): string | null {
  const s = raw.trim();
  if (!/^\d+$/.test(s) || Number(s) < 1) return "Quantity must be a whole number of 1 or more.";
  if (Number(s) > WASTE_MAX_QTY) return `Quantity is too large. The most you can log at once is ${WASTE_MAX_QTY}.`;
  return null;
}
