/** Last four digits of a phone number, or null if absent / fewer than four digits. */
export function phoneLast4(phone: string | null): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}
