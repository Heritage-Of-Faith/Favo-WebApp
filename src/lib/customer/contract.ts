// Customer-data contract — owner: Nikao (Phase 3 integration seam)
//
// This file declares the EXACT shapes + signatures that Gian's Phase 3 backend
// (G18 wallet/packs, G19 orders, customer summary) will implement as real Server
// Actions. The customer PWA pages (N13 dashboard, N17 wallet/packs) build against
// THIS contract — never against the mock directly — so that when the real actions
// land, the only change is the re-export in `./data.ts`.
//
// Conventions match the rest of the codebase:
//   - money is integer cents in fields suffixed `Zar` (never numeric / floats)
//   - timestamps are ISO strings; wall-clock formatting happens in the UI (SAST)
//   - every action returns ActionResult<T> and NEVER throws for auth/validation
//   - the customer is resolved server-side from getCustomerSession() — these
//     actions take no customerId argument (the session is the source of truth)

import type { ActionResult, Order } from "@/lib/types";

// ─── Loyalty + summary ──────────────────────────────────────────────────────

/** Glanceable header data for the customer dashboard (N13). */
export type CustomerSummary = {
  customerId: string;
  name: string;
  /** Loyalty points balance (integer points, not money). */
  loyaltyPoints: number;
  /** Number of coffee packs that are still active (not expired, qty remaining > 0). */
  activePackCount: number;
  /** Whether a push subscription is currently saved for this customer in the DB. */
  hasPushSubscription: boolean;
};

// ─── Orders ───────────────────────────────────────────────────────────────────

/** A customer-visible slice of an order (read-only history). */
export type CustomerOrder = Pick<
  Order,
  "id" | "state" | "placedAt" | "completedAt" | "totalZar" | "items"
>;

// ─── Wallet ─────────────────────────────────────────────────────────────────

export type WalletTransactionKind = "topup" | "spend" | "refund" | "adjustment";

export type WalletTransaction = {
  id: string;
  /** Signed integer cents: positive = credit (topup/refund), negative = spend. */
  deltaZar: number;
  kind: WalletTransactionKind;
  description: string | null;
  /** ISO timestamp. */
  at: string;
};

export type WalletView = {
  /** Current balance in integer cents — equals the sum of all transaction deltas. */
  balanceZar: number;
  /** Most-recent-first transaction history. */
  transactions: WalletTransaction[];
};

// ─── Coffee packs ─────────────────────────────────────────────────────────────

export type CoffeePack = {
  id: string;
  /** Menu item the pack is for (e.g. "Cappuccino"). */
  itemName: string;
  qtyTotal: number;
  qtyRemaining: number;
  /** ISO timestamp of purchase. */
  purchasedAt: string;
  /** ISO timestamp — packs expire 90 days after purchase (L16). */
  expiresAt: string;
};

export type PacksView = {
  active: CoffeePack[];
  expired: CoffeePack[];
};

// ─── Profile ──────────────────────────────────────────────────────────────────

/** Fields a customer can set on first-login setup (N12). Phone is what POS searches on. */
export type CustomerProfileInput = {
  name?: string;
  phone?: string;
};

// ─── The contract ───────────────────────────────────────────────────────────

/**
 * The customer-facing read/profile API. The customer is always resolved from the
 * session server-side. All methods are read-only EXCEPT updateCustomerProfile
 * (which only writes the caller's own name/phone — never money, per L05/L16).
 */
export interface CustomerDataApi {
  getCustomerSummary(): Promise<ActionResult<CustomerSummary>>;
  listCustomerOrders(limit?: number): Promise<ActionResult<CustomerOrder[]>>;
  getWallet(): Promise<ActionResult<WalletView>>;
  getPacks(): Promise<ActionResult<PacksView>>;
  updateCustomerProfile(input: CustomerProfileInput): Promise<ActionResult<{ id: string }>>;
}
