import { create } from "zustand";
import type { Customer, MenuItem, MenuCustomisation } from "@/lib/types";

type DraftItem = {
  menuItem: MenuItem;
  quantity: number;
  modifications: MenuCustomisation[];
};

type OrderDraftStore = {
  customer: Customer | null;
  items: DraftItem[];
  setCustomer: (customer: Customer | null) => void;
  addItem: (item: DraftItem) => void;
  removeItem: (menuItemId: string) => void;
  clearDraft: () => void;
  totalZar: () => number;
};

export const useOrderDraft = create<OrderDraftStore>((set, get) => ({
  customer: null,
  items: [],

  setCustomer: (customer) => set({ customer }),

  addItem: (item) =>
    set((state) => {
      const existing = state.items.findIndex(
        (i) => i.menuItem.id === item.menuItem.id
      );
      if (existing >= 0) {
        const items = [...state.items];
        items[existing] = {
          ...items[existing],
          quantity: items[existing].quantity + item.quantity,
        };
        return { items };
      }
      return { items: [...state.items, item] };
    }),

  removeItem: (menuItemId) =>
    set((state) => ({
      items: state.items.filter((i) => i.menuItem.id !== menuItemId),
    })),

  clearDraft: () => set({ customer: null, items: [] }),

  totalZar: () => {
    const { items } = get();
    return items.reduce((total, item) => {
      const modTotal = item.modifications.reduce(
        (acc, mod) => acc + mod.priceDeltaZar,
        0
      );
      return total + (item.menuItem.currentPriceZar + modTotal) * item.quantity;
    }, 0);
  },
}));
