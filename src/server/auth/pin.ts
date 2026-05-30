// PIN helpers — task G4
// Staff authenticate with a numeric PIN. PINs are stored only as bcrypt hashes.
// NEVER log or echo a raw PIN.

import bcrypt from "bcryptjs";

export const BCRYPT_ROUNDS = 10;
const PIN_PATTERN = /^\d{4,6}$/;

/** True if the PIN is 4–6 digits (the only shape the POS pad can produce). */
export function isValidPinFormat(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

/** Hash a PIN for storage. Used by the seed and by staff-management actions. */
export function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, BCRYPT_ROUNDS);
}

/** Compare a candidate PIN against a stored bcrypt hash. */
export function verifyPin(pin: string, pinHash: string): Promise<boolean> {
  return bcrypt.compare(pin, pinHash);
}
