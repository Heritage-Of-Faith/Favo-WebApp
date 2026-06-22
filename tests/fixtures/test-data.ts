import type { Customer, Staff, MenuItem, Order } from "@/lib/types";

export const testCustomer: Customer = {
  id: "cust_louis_001",
  name: "Louis",
  phone: "0821234567",
  email: "louis@example.com",
  loyaltyPoints: 50,
  walletZar: 0,
  activePackCount: 0,
};

export const testStaff: Staff = {
  id: "staff_barista_001",
  name: "Test Barista",
  role: "barista",
  active: true,
};

export const testMenuItem: MenuItem = {
  id: "menu_cappuccino_001",
  name: "Cappuccino",
  category: "coffee",
  currentPriceZar: 4500, // R45.00
  active: true,
  customisations: [
    { id: "mod_extra_shot", name: "Extra Shot", priceDeltaZar: 1000 },
  ],
};

export const testOrder: Order = {
  id: "order_001",
  customerId: testCustomer.id,
  customerName: testCustomer.name,
  staffId: testStaff.id,
  state: "ordered",
  placedAt: "2026-05-29T08:00:00.000Z",
  completedAt: null,
  totalZar: 4500,
  isStaffDiscount: false,
  paymentStatus: null,
  items: [
    {
      id: "item_001",
      menuItemId: testMenuItem.id,
      menuItemName: testMenuItem.name,
      quantity: 1,
      unitPriceZar: 4500,
      modifications: [],
    },
  ],
};
