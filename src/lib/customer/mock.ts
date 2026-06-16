// TEMPORARY mock implementation of the customer-data contract — owner: Nikao.
//
// ⚠️  This exists ONLY because Gian's Phase 3 backend (G18 wallet/packs, G19
//     orders, customer summary) is not on `main` yet. The customer PWA imports
//     everything through `./data.ts`; when the real Server Actions land, swap the
//     re-exports in data.ts to `@/server/actions/...` and DELETE this file.
//
// Data is grounded on the "Louis" seed customer and the N13 acceptance spec
// ("sees last 3 orders and 45 loyalty points"). Money is integer cents.

import type { ActionResult } from "@/lib/types";
import type {
  CustomerDataApi,
  CustomerOrder,
  CustomerProfileInput,
  CustomerSummary,
  PacksView,
  WalletTransaction,
  WalletView,
} from "./contract";

const ok = <T>(data: T): ActionResult<T> => ({ ok: true, data });

// Relative ISO helpers so pack expiry / order recency demo correctly against the
// real clock (safe at app runtime — this never runs inside a workflow script).
const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();
const days = (n: number) => n * 24 * 60 * 60 * 1000;

const MOCK_CUSTOMER = { id: "cust_louis", name: "Louis", phone: "082 555 0142" };

const MOCK_ORDERS: CustomerOrder[] = [
  {
    id: "ord_1003",
    state: "collected",
    placedAt: iso(-days(1)),
    completedAt: iso(-days(1) + 1000 * 60 * 6),
    totalZar: 6800,
    items: [
      { id: "oi_1", menuItemId: "mi_capp", menuItemName: "Cappuccino", quantity: 1, unitPriceZar: 3800, modifications: [] },
      { id: "oi_2", menuItemId: "mi_muffin", menuItemName: "Blueberry Muffin", quantity: 1, unitPriceZar: 3000, modifications: [] },
    ],
  },
  {
    id: "ord_1002",
    state: "collected",
    placedAt: iso(-days(3)),
    completedAt: iso(-days(3) + 1000 * 60 * 5),
    totalZar: 3000,
    items: [
      { id: "oi_3", menuItemId: "mi_amer", menuItemName: "Americano", quantity: 1, unitPriceZar: 3000, modifications: [] },
    ],
  },
  {
    id: "ord_1001",
    state: "collected",
    placedAt: iso(-days(6)),
    completedAt: iso(-days(6) + 1000 * 60 * 8),
    totalZar: 7600,
    items: [
      { id: "oi_4", menuItemId: "mi_capp", menuItemName: "Cappuccino", quantity: 2, unitPriceZar: 3800, modifications: [] },
    ],
  },
];

const MOCK_WALLET_TX: WalletTransaction[] = [
  { id: "wtx_4", deltaZar: -3000, kind: "spend", description: "Americano", at: iso(-days(3)) },
  { id: "wtx_3", deltaZar: -6800, kind: "spend", description: "Cappuccino + Muffin", at: iso(-days(1)) },
  { id: "wtx_2", deltaZar: -7600, kind: "spend", description: "2× Cappuccino", at: iso(-days(6)) },
  { id: "wtx_1", deltaZar: 20000, kind: "topup", description: "Counter top-up", at: iso(-days(7)) },
];

const MOCK_WALLET: WalletView = {
  // balance == sum of deltas (20000 - 3000 - 6800 - 7600 = 2600)
  balanceZar: MOCK_WALLET_TX.reduce((s, t) => s + t.deltaZar, 0),
  transactions: MOCK_WALLET_TX,
};

const MOCK_PACKS: PacksView = {
  active: [
    // expiring soon → should render red (< 7 days)
    { id: "pack_2", itemName: "Cappuccino", qtyTotal: 10, qtyRemaining: 3, purchasedAt: iso(-days(85)), expiresAt: iso(days(5)) },
    // healthy
    { id: "pack_3", itemName: "Americano", qtyTotal: 10, qtyRemaining: 8, purchasedAt: iso(-days(50)), expiresAt: iso(days(40)) },
  ],
  expired: [
    { id: "pack_1", itemName: "Cortado", qtyTotal: 10, qtyRemaining: 0, purchasedAt: iso(-days(120)), expiresAt: iso(-days(30)) },
  ],
};

export async function getCustomerSummary(): Promise<ActionResult<CustomerSummary>> {
  return ok<CustomerSummary>({
    customerId: MOCK_CUSTOMER.id,
    name: MOCK_CUSTOMER.name,
    loyaltyPoints: 45, // N13 acceptance: "45 loyalty points"
    walletBalanceZar: MOCK_WALLET.balanceZar,
    activePackCount: MOCK_PACKS.active.length,
  });
}

export async function listCustomerOrders(limit = 10): Promise<ActionResult<CustomerOrder[]>> {
  return ok(MOCK_ORDERS.slice(0, limit));
}

export async function getWallet(): Promise<ActionResult<WalletView>> {
  return ok(MOCK_WALLET);
}

export async function getPacks(): Promise<ActionResult<PacksView>> {
  return ok(MOCK_PACKS);
}

export async function updateCustomerProfile(
  input: CustomerProfileInput,
): Promise<ActionResult<{ id: string }>> {
  // Mock: pretend the write succeeded. Real impl writes name/phone for the
  // session customer (phone is what the POS barista searches on — M2).
  void input;
  return ok({ id: MOCK_CUSTOMER.id });
}

// Type-level assertion that the mock satisfies the contract.
const _impl: CustomerDataApi = {
  getCustomerSummary,
  listCustomerOrders,
  getWallet,
  getPacks,
  updateCustomerProfile,
};
void _impl;
