import { pgEnum } from "drizzle-orm/pg-core";

export const orderState = pgEnum("order_state", [
  "ordered",
  "in_progress",
  "ready",
  "collected",
  "cancelled",
]);

export const staffRole = pgEnum("staff_role", ["barista", "admin"]);

export const menuCategory = pgEnum("menu_category", [
  "coffee",
  "tea",
  "cold_brew",
  "food",
  "merchandise",
  "other",
]);

export const inventoryKind = pgEnum("inventory_kind", [
  "bean",
  "milk",
  "syrup",
  "packaging",
  "equipment",
  "other",
]);

export const inventoryUnit = pgEnum("inventory_unit", [
  "g",
  "kg",
  "ml",
  "l",
  "unit",
  "bag",
  // Container model: milk & beans are tracked in cups produced, not g/ml.
  "cup",
]);

export const lotState = pgEnum("lot_state", [
  "active",
  "depleted",
  "expired",
  "quarantined",
  // Container model (milk & beans): a physical bottle/bag moves
  // active (sealed/on-shelf) → open (in use) → closed (finished).
  "open",
  "closed",
]);

export const stockMovementKind = pgEnum("stock_movement_kind", [
  "deduction",
  "restock",
  "waste",
  "adjustment",
  "stock_take",
]);

export const stockTakeKind = pgEnum("stock_take_kind", ["full", "spot"]);

// AT-201 / PRD §10.3.3: exactly these four. `failed` became `declined`;
// `refunded` went with L02; `deferred` is an order payment_mode, not a payment
// status; no void value is ever added — there is no void (§6.8.4).
export const paymentStatus = pgEnum("payment_status", [
  "pending",
  "successful",
  "declined",
  "unresolved",
]);

export const refundStatus = pgEnum("refund_status", [
  "pending",
  "approved",
  "rejected",
]);

export const wasteCategory = pgEnum("waste_category", [
  "expired",
  "damaged",
  "spilled",
  "overproduction",
  "other",
]);

export const purchaseKind = pgEnum("purchase_kind", [
  "planned",
  "emergency",
]);

export const expenseCategory = pgEnum("expense_category", [
  "rent",
  "utilities",
  "staff",
  "maintenance",
  "marketing",
  "other",
]);


// AT-181 / PRD §10.3: free-coffee eligibility (L03) and audience targeting.
// The value is `office_staff`, not `staff` — the bare word collides with the
// `staff` table.
export const customerStatus = pgEnum("customer_status", [
  "office_staff",
  "church_member",
]);

// AT-181 / PRD §10.3: the day's mode on an opening session.
export const sessionMode = pgEnum("session_mode", [
  "weekday",
  "sunday",
  "event",
]);

// AT-181 / PRD §10.3: why an order line was comped — "the definition of
// record". NULL when the line carries no comp.
export const compReason = pgEnum("comp_reason", [
  "wrong_drink",
  "wrong_charge",
  "spillage",
  "staff_error",
  "goodwill",
  "donation",
]);

// L28 / REQ-046 / PRD §10.3: who to tell when an order is ready, bound at
// ring-up. `customer` = orders.customer_id; `none` is an explicit tap.
export const notificationTarget = pgEnum("notification_target", [
  "customer",
  "none",
]);
