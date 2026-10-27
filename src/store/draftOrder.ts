// Draft order Zustand store — owner: Mine (M2)
// Holds in-flight POS order state across the multi-step flow:
// customer search → order builder → payment.
// Reset after payment completes or on explicit clear.

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Customer, MenuCustomisation } from "@/lib/types";

export type DraftCustomer = Pick<Customer, "id" | "name">;

export type DraftItem = {
  menuItemId: string;
  menuItemName: string;
  unitPriceZar: number;
  quantity: number;
  modifications: MenuCustomisation[];
};

/**
 * Stable per-line identity key: menuItemId + sorted modifier IDs.
 * Allows the same menu item to appear multiple times with different modifier sets.
 */
export function lineKey(item: Pick<DraftItem, "menuItemId" | "modifications">): string {
  const modPart = item.modifications
    .map((m) => m.id)
    .sort()
    .join(",");
  return `${item.menuItemId}:${modPart}`;
}

export type DraftOrderState = {
  // Current step in the new-order flow
  step: "customer" | "build" | "pay" | "done";

  // Optional — guest orders have no customer. Only id + name: the POS search
  // never receives email or the full phone (REQ-142 / AT-185).
  customer: DraftCustomer | null;

  // Line items
  items: DraftItem[];

  // Derived — kept in sync by actions
  totalZar: number;

  // Set after createOrder succeeds
  orderId: string | null;
  yocoClientSecret: string | null;
};

export type DraftOrderActions = {
  setStep: (step: DraftOrderState["step"]) => void;
  setCustomer: (customer: DraftCustomer | null) => void;
  addItem: (item: Omit<DraftItem, "quantity"> & { quantity?: number }) => void;
  /** Remove the exact line identified by its lineKey (menuItemId + mods). */
  removeItem: (key: string) => void;
  /** Update quantity for the exact line identified by its lineKey. Removes line if quantity ≤ 0. */
  updateQuantity: (key: string, quantity: number) => void;
  setOrderCreated: (orderId: string, yocoClientSecret: string) => void;
  reset: () => void;
};

const INITIAL: DraftOrderState = {
  step: "customer",
  customer: null,
  items: [],
  totalZar: 0,
  orderId: null,
  yocoClientSecret: null,
};

function calcTotal(items: DraftItem[]): number {
  return items.reduce((sum, item) => {
    const modsTotal = item.modifications.reduce((s, m) => s + m.priceDeltaZar, 0);
    return sum + (item.unitPriceZar + modsTotal) * item.quantity;
  }, 0);
}

/** Most cups on one line — a mistap guard, not a stock rule. */
export const MAX_LINE_QTY = 99;
const clampQty = (q: number) => Math.min(q, MAX_LINE_QTY);

/** sessionStorage can be missing or throw (private mode, quota): never break the till. */
const safeSessionStorage = {
  getItem: (name: string) => { try { return sessionStorage.getItem(name); } catch { return null; } },
  setItem: (name: string, value: string) => { try { sessionStorage.setItem(name, value); } catch { /* ignore */ } },
  removeItem: (name: string) => { try { sessionStorage.removeItem(name); } catch { /* ignore */ } },
};

export const useDraftOrder = create<DraftOrderState & DraftOrderActions>()(persist((set) => ({
  ...INITIAL,

  setStep: (step) => set({ step }),

  setCustomer: (customer) => set({ customer }),

  addItem: (item) =>
    set((state) => {
      const qty = item.quantity ?? 1;
      const key = lineKey(item);
      // Same menu item + exact same mods → increment quantity on existing line.
      const existingIdx = state.items.findIndex((i) => lineKey(i) === key);
      let updated: DraftItem[];
      if (existingIdx >= 0) {
        updated = state.items.map((i, idx) =>
          idx === existingIdx ? { ...i, quantity: clampQty(i.quantity + qty) } : i
        );
      } else {
        updated = [...state.items, { ...item, quantity: clampQty(qty) }];
      }
      return { items: updated, totalZar: calcTotal(updated) };
    }),

  removeItem: (key) =>
    set((state) => {
      const updated = state.items.filter((i) => lineKey(i) !== key);
      return { items: updated, totalZar: calcTotal(updated) };
    }),

  updateQuantity: (key, quantity) =>
    set((state) => {
      const updated =
        quantity <= 0
          ? state.items.filter((i) => lineKey(i) !== key)
          : state.items.map((i) => (lineKey(i) === key ? { ...i, quantity: clampQty(quantity) } : i));
      return { items: updated, totalZar: calcTotal(updated) };
    }),

  setOrderCreated: (orderId, yocoClientSecret) =>
    set({ orderId, yocoClientSecret, step: "pay" }),

  reset: () => set(INITIAL),
}), {
  // Survives History navigation and reload within the tab; gone when the tab closes.
  // Hydrated explicitly from POSWorkspace (skipHydration) so SSR and first paint match.
  name: "favo-pos-draft",
  storage: createJSONStorage(() => safeSessionStorage),
  skipHydration: true,
  partialize: (s) => ({ customer: s.customer, items: s.items, totalZar: s.totalZar }),
}));
