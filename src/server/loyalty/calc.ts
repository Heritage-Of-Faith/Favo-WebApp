// Loyalty calculation — task G5 (rule L06)
// Earn: 5 points per R10 spent. Redeem: minimum 100 points, 100 pts = R20,
// full redemption only. Pure functions — the server is the source of truth;
// the customer PWA mirrors these for display.

import { formatZar } from "@/lib/format";

export const POINTS_PER_R10 = 5; // 5 points per 1000 cents
export const CENTS_PER_EARN_UNIT = 1000; // R10
export const MIN_REDEEM_POINTS = 100;
export const REDEEM_POINTS_UNIT = 100; // 100 pts ...
export const REDEEM_VALUE_ZAR = 2000; // ... = R20.00

/**
 * Points earned on a paid order total (integer cents).
 * Only whole R10 increments earn — R19.99 earns the same as R10.
 */
export function earnPoints(totalZar: number): number {
  if (totalZar <= 0) return 0;
  return Math.floor(totalZar / CENTS_PER_EARN_UNIT) * POINTS_PER_R10;
}

/** A customer may redeem only with at least the minimum balance. */
export function canRedeem(points: number): boolean {
  return points >= MIN_REDEEM_POINTS;
}

/** ZAR value (cents) of a points balance, in whole 100-point units. */
export function pointsValueZar(points: number): number {
  if (points < REDEEM_POINTS_UNIT) return 0;
  return Math.floor(points / REDEEM_POINTS_UNIT) * REDEEM_VALUE_ZAR;
}

/**
 * AT-139 — the one loyalty-balance display string, money-first:
 * `"R20,00 (100 pts)"`. Every surface (POS, customer PWA, admin) renders
 * balances through this so the wording can't drift. The rand value is the
 * redeemable value (whole 100-pt units), not a linear cents-per-point figure.
 */
export function formatLoyaltyBalance(points: number): string {
  return `${formatZar(pointsValueZar(points))} (${points} pts)`;
}
