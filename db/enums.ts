import { pgEnum } from "drizzle-orm/pg-core";

export const orderState = pgEnum("order_state", [
  "ordered",
  "in_progress",
  "ready",
  "collected",
  "cancelled",
]);

export const staffRole = pgEnum("staff_role", [
  "barista",
  "roaster",
  "manager",
  "admin",
  "finance",
  "owner",
]);

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
]);

export const lotState = pgEnum("lot_state", [
  "active",
  "depleted",
  "expired",
  "quarantined",
]);

export const stockMovementKind = pgEnum("stock_movement_kind", [
  "deduction",
  "restock",
  "waste",
  "adjustment",
  "stock_take",
]);

export const stockTakeKind = pgEnum("stock_take_kind", ["full", "spot"]);

export const paymentStatus = pgEnum("payment_status", [
  "pending",
  "successful",
  "failed",
  "refunded",
  "deferred",
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

export const loyaltyKind = pgEnum("loyalty_kind", [
  "earn",
  "redeem",
  "adjustment",
  "expiry",
]);

export const chargeKind = pgEnum("charge_kind", [
  "wallet_topup",
  "coffee_pack",
]);

export const walletTxnKind = pgEnum("wallet_txn_kind", [
  "topup",
  "spend",
  "refund",
  "adjustment",
]);

export const syncConflictKind = pgEnum("sync_conflict_kind", [
  "payment_mismatch",
  "state_collision",
  "duplicate_order",
]);

export const syncConflictStatus = pgEnum("sync_conflict_status", [
  "open",
  "resolved",
  "dismissed",
]);
