// Customer-data contract — owner: Nikao (Phase 3 integration seam)
//
// This file declares the EXACT shapes + signatures that Gian's Phase 3 backend
// (G18 packs, G19 orders, customer summary) will implement as real Server
// Actions. The customer PWA pages (N13 dashboard, N17 packs) build against
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

// ─── Summary ──────────────────────────────────────────────────────────────────

/** Glanceable header data for the customer dashboard (N13). */
export type CustomerSummary = {
  customerId: string;
  name: string;
  /** Whether a push subscription is currently saved for this customer in the DB. */
  hasPushSubscription: boolean;
};

// ─── Orders ───────────────────────────────────────────────────────────────────

/**
 * REQ-049 / L23: a customer's own history shows only orders that are Done —
 * `ready`, `collected` or `cancelled`. An order still `ordered` or
 * `in_progress` is never returned to a customer-scoped read (PRD §17.4).
 */
export const CUSTOMER_VISIBLE_ORDER_STATES = ["ready", "collected", "cancelled"] as const;
export type CustomerVisibleOrderState = (typeof CUSTOMER_VISIBLE_ORDER_STATES)[number];

/** A customer-visible slice of an order (read-only history). */
export type CustomerOrder = Pick<
  Order,
  "id" | "placedAt" | "completedAt" | "totalZar" | "items"
> & { state: CustomerVisibleOrderState };

// ─── Profile ──────────────────────────────────────────────────────────────────

/** Fields a customer can set on first-login setup (N12). Phone is what POS searches on. */
export type CustomerProfileInput = {
  name?: string;
  phone?: string;
  /** AT-211: same schema as registration (src/lib/customer/identity.ts). Blank or null clears it. */
  surname?: string | null;
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
  updateCustomerProfile(input: CustomerProfileInput): Promise<ActionResult<{ id: string }>>;
}
