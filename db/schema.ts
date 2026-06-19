import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  serial,
  unique,
  uniqueIndex,
  index,
  check,
  numeric,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  orderState,
  staffRole,
  menuCategory,
  inventoryKind,
  inventoryUnit,
  lotState,
  stockMovementKind,
  stockTakeKind,
  paymentStatus,
  refundStatus,
  wasteCategory,
  purchaseKind,
  expenseCategory,
  loyaltyKind,
  chargeKind,
  walletTxnKind,
  syncConflictKind,
  syncConflictStatus,
} from "./enums";

const TENANT = "hofmi";
const now = () => timestamp("at", { withTimezone: true }).defaultNow().notNull();
const tenantId = () => text("tenant_id").default(TENANT).notNull();

// ─── Staff ────────────────────────────────────────────────────────────────────

export const staff = pgTable("staff", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  name: text("name").notNull(),
  role: staffRole("role").notNull(),
  pinHash: text("pin_hash").notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  // Web Push subscription stored by M10 (POS opt-in). Used by G14 cron to
  // send low-stock alerts to barista devices.
  pushSubscription: jsonb("push_subscription"),
});

// ─── Customers ────────────────────────────────────────────────────────────────

export const customers = pgTable(
  "customers",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: tenantId(),
    authId: uuid("auth_id").unique(),
    email: text("email").unique(),
    name: text("name").notNull(),
    phone: text("phone"),
    pushSubscription: jsonb("push_subscription"),
    loyaltyPoints: integer("loyalty_points").default(0).notNull(),
    walletZar: integer("wallet_zar").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  () => [
    // AT-114: wallet balance can never go negative (L16).
    check("customers_wallet_zar_non_negative", sql`wallet_zar >= 0`),
  ]
);

// ─── Menu ─────────────────────────────────────────────────────────────────────

export const menuItems = pgTable("menu_items", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  name: text("name").notNull(),
  category: menuCategory("category").notNull(),
  active: boolean("active").default(true).notNull(),
  currentPriceZar: integer("current_price_zar").notNull(),
  recipeId: text("recipe_id"),
});

export const menuCustomisations = pgTable("menu_customisations", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  menuItemId: text("menu_item_id").notNull().references(() => menuItems.id),
  name: text("name").notNull(),
  priceDeltaZar: integer("price_delta_zar").default(0).notNull(),
});

export const priceHistory = pgTable("price_history", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  menuItemId: text("menu_item_id").notNull().references(() => menuItems.id),
  priceZar: integer("price_zar").notNull(),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).defaultNow().notNull(),
  effectiveUntil: timestamp("effective_until", { withTimezone: true }),
});

// ─── Recipes ──────────────────────────────────────────────────────────────────

export const recipes = pgTable("recipes", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  menuItemId: text("menu_item_id").notNull().references(() => menuItems.id),
  version: integer("version").default(1).notNull(),
});

export const recipeIngredients = pgTable("recipe_ingredients", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  recipeId: text("recipe_id").notNull().references(() => recipes.id),
  inventoryItemId: text("inventory_item_id").notNull(),
  quantity: integer("quantity").notNull(),
  unit: inventoryUnit("unit").notNull(),
  tolerancePct: integer("tolerance_pct").default(0).notNull(),
});

// ─── Inventory ────────────────────────────────────────────────────────────────

export const inventoryItems = pgTable("inventory_items", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  name: text("name").notNull(),
  kind: inventoryKind("kind").notNull(),
  unit: inventoryUnit("unit").notNull(),
  lowStockThreshold: integer("low_stock_threshold").default(0).notNull(),
  origin: text("origin"),
});

export const inventoryLots = pgTable("inventory_lots", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  inventoryItemId: text("inventory_item_id").notNull().references(() => inventoryItems.id),
  sourceName: text("source_name"),
  batchNumber: text("batch_number"),
  roastDate: timestamp("roast_date", { withTimezone: true }),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  state: lotState("state").default("active").notNull(),
  origin: text("origin"),
  // Exception to the integer-cents rule: per-unit production cost is a RATE,
  // not a money amount. When unit=g or unit=ml the cost per gram/ml is
  // sub-cent (e.g. R450/kg → 0.45 ¢/g). Using integer would force it to 0
  // and break COGS entirely. numeric(10,4) gives 4-decimal cent precision.
  // G13 COGS sums (delta × unit_cost_zar) → cast to integer cents at
  // the order level. Admin recosts via A8 after launch (R10 mitigation).
  unitCostZar: numeric("unit_cost_zar", { precision: 10, scale: 4 }),
  // Quantity received when this lot was booked in (in the item's unit).
  quantityReceived: numeric("quantity_received", { precision: 10, scale: 2 }),
});

export const stockMovements = pgTable("stock_movements", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  inventoryLotId: text("inventory_lot_id").notNull().references(() => inventoryLots.id),
  delta: integer("delta").notNull(),
  kind: stockMovementKind("kind").notNull(),
  relatedOrderId: text("related_order_id"),
  at: now(),
  byStaffId: text("by_staff_id").references(() => staff.id),
});

export const stockTakes = pgTable("stock_takes", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  kind: stockTakeKind("kind").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  byStaffId: text("by_staff_id").notNull().references(() => staff.id),
  variancePct: integer("variance_pct"),
});

export const stockTakeLines = pgTable("stock_take_lines", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  stockTakeId: text("stock_take_id").notNull().references(() => stockTakes.id),
  inventoryLotId: text("inventory_lot_id").notNull().references(() => inventoryLots.id),
  /** Running-stock at take-creation time (SUM of movements up to startedAt). */
  expected: integer("expected").notNull(),
  /** Null until the admin physically counts this lot (walk-lots flow in A9). */
  counted: integer("counted"),
  /** Null until counted. Raw delta: counted − expected (integer units). */
  variance: integer("variance"),
});

export const stockAlertRecipients = pgTable("stock_alert_recipients", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  inventoryItemId: text("inventory_item_id").references(() => inventoryItems.id),
  staffId: text("staff_id").notNull().references(() => staff.id),
});

// ─── Orders ───────────────────────────────────────────────────────────────────

export const orders = pgTable("orders", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  customerId: text("customer_id").references(() => customers.id),
  staffId: text("staff_id").notNull().references(() => staff.id),
  state: orderState("state").default("ordered").notNull(),
  placedAt: timestamp("placed_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  totalZar: integer("total_zar").notNull(),
  yocoPaymentId: text("yoco_payment_id"),
  isStaffDiscount: boolean("is_staff_discount").default(false).notNull(),
  // Tracks how offline orders were tendered. null = normal Yoco flow.
  paymentMode: text("payment_mode", {
    enum: ["yoco", "wallet", "yoco_deferred", "free"],
  }),
});

export const orderItems = pgTable("order_items", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: text("order_id").notNull().references(() => orders.id),
  menuItemId: text("menu_item_id").notNull().references(() => menuItems.id),
  quantity: integer("quantity").default(1).notNull(),
  unitPriceZar: integer("unit_price_zar").notNull(),
  modifications: jsonb("modifications").default([]).notNull(),
});

// ─── Payments ─────────────────────────────────────────────────────────────────

export const payments = pgTable("payments", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  orderId: text("order_id").notNull().references(() => orders.id),
  // Checkout ID from Yoco's POST /checkouts response — stored at order creation.
  // Different from yocoPaymentId which arrives later via the webhook.
  yocoCheckoutId: text("yoco_checkout_id"),
  // Payment ID from Yoco's webhook — null until the webhook fires.
  yocoPaymentId: text("yoco_payment_id").unique(),
  amountZar: integer("amount_zar").notNull(),
  status: paymentStatus("status").default("pending").notNull(),
  webhookReceivedAt: timestamp("webhook_received_at", { withTimezone: true }),
});

export const refunds = pgTable("refunds", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  orderId: text("order_id").notNull().references(() => orders.id),
  amountZar: integer("amount_zar").notNull(),
  reason: text("reason").notNull(),
  requestedBy: text("requested_by").notNull().references(() => staff.id),
  approvedBy: text("approved_by").references(() => staff.id),
  status: refundStatus("status").default("pending").notNull(),
});

// ─── Loyalty ──────────────────────────────────────────────────────────────────

export const loyaltyTransactions = pgTable(
  "loyalty_transactions",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: tenantId(),
    customerId: text("customer_id").notNull().references(() => customers.id),
    orderId: text("order_id").references(() => orders.id),
    delta: integer("delta").notNull(),
    kind: loyaltyKind("kind").notNull(),
    at: now(),
  },
  (t) => [
    // Idempotency guard (AT-60): prevent double-accrual if transitionOrder is
    // retried on the same in_progress -> ready transition. Only one earn row is
    // allowed per order_id -- redeem rows are unrestricted.
    uniqueIndex("loyalty_txn_earn_order_unique")
      .on(t.orderId)
      .where(sql`kind = 'earn'`),
    // Idempotency guard (AT-109): prevent double-redemption if redeemLoyalty is
    // retried on the same order. Only one redeem row is allowed per order_id.
    uniqueIndex("loyalty_txn_redeem_order_unique")
      .on(t.orderId)
      .where(sql`kind = 'redeem'`),
  ]
);

// ─── Staff Entitlement ────────────────────────────────────────────────────────

export const staffEntitlementLog = pgTable(
  "staff_entitlement_log",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: tenantId(),
    staffId: text("staff_id").notNull().references(() => staff.id),
    appliedByStaffId: text("applied_by_staff_id").notNull().references(() => staff.id),
    orderId: text("order_id").notNull().references(() => orders.id),
    day: text("day").notNull(), // YYYY-MM-DD in Africa/Johannesburg
  },
  (t) => [unique().on(t.staffId, t.day)]
);

// ─── Waste + Purchases ────────────────────────────────────────────────────────

export const wasteLog = pgTable("waste_log", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  category: wasteCategory("category").notNull(),
  inventoryLotId: text("inventory_lot_id").references(() => inventoryLots.id),
  quantity: integer("quantity").notNull(),
  reason: text("reason"),
  byStaffId: text("by_staff_id").notNull().references(() => staff.id),
  at: now(),
});

export const purchases = pgTable(
  "purchases",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: tenantId(),
    sourceName: text("source_name").notNull(),
    inventoryLotId: text("inventory_lot_id").references(() => inventoryLots.id),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    totalZar: integer("total_zar").notNull(),
    kind: purchaseKind("kind").notNull(),
    adminApprovedBy: text("admin_approved_by").references(() => staff.id),
    // L10: emergency purchases by non-admins wait here until an admin approves.
    // 'active' = lots can be used; 'pending_admin_approval' = lots quarantined.
    status: text("status", { enum: ["active", "pending_admin_approval"] })
      .default("active")
      .notNull(),
  },
  () => [
    check(
      "emergency_requires_approval",
      // Allows: emergency + pending (adminApprovedBy still null) OR
      //         emergency + active  (adminApprovedBy must be set)    OR
      //         planned  (no restriction)
      sql`kind != 'emergency' OR status = 'pending_admin_approval' OR admin_approved_by IS NOT NULL`
    ),
  ]
);

// ─── Operating Hours ──────────────────────────────────────────────────────────

export const operatingHours = pgTable("operating_hours", {
  id: serial("id").primaryKey(),
  tenantId: tenantId(),
  dayOfWeek: integer("day_of_week").notNull(), // 0=Sun … 6=Sat
  openTime: text("open_time").notNull(),        // "09:00"
  closeTime: text("close_time").notNull(),      // "17:00"
  isClosed: boolean("is_closed").default(false).notNull(),
  note: text("note"),
});

// ─── Expenses ─────────────────────────────────────────────────────────────────

export const expenses = pgTable("expenses", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  category: expenseCategory("category").notNull(),
  amountZar: integer("amount_zar").notNull(),
  incurredAt: timestamp("incurred_at", { withTimezone: true }).defaultNow().notNull(),
  loggedBy: text("logged_by").notNull().references(() => staff.id),
});

// ─── Audit Log (append-only — trigger-enforced) ───────────────────────────────

export const auditLog = pgTable("audit_log", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  entityKind: text("entity_kind").notNull(),
  entityId: text("entity_id").notNull(),
  action: text("action").notNull(),
  actorId: text("actor_id"),
  actorRole: text("actor_role"),
  at: now(),
  before: jsonb("before"),
  after: jsonb("after"),
  reason: text("reason"),
}, (t) => [
  index("audit_log_entity_idx").on(t.entityKind, t.entityId),
  index("audit_log_actor_idx").on(t.actorId),
  index("audit_log_at_idx").on(t.at),
]);

// ─── Monthly reports (G15 dual-sign) ─────────────────────────────────────────

export const monthlyReports = pgTable(
  "monthly_reports",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: tenantId(),
    /** First day of the month (YYYY-MM-DD). UNIQUE — one report per month. */
    month: text("month").notNull().unique(),
    revenueZar: integer("revenue_zar").notNull(),
    cogsZar: integer("cogs_zar").notNull(),
    expensesZar: integer("expenses_zar").notNull(),
    grossMarginZar: integer("gross_margin_zar").notNull(),
    netZar: integer("net_zar").notNull(),
    /** draft → awaiting_signatures → closed */
    status: text("status", {
      enum: ["draft", "awaiting_signatures", "closed"],
    })
      .default("draft")
      .notNull(),
    /** JSONB: { signerId, signerName, at } */
    adminSig: jsonb("admin_sig"),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  () => [
    // L11 (post role-simplification): a report can only be closed once the
    // admin has signed. The prior finance co-signature was dropped along with
    // the finance role.
    check(
      "monthly_report_closed_requires_admin_sig",
      sql`status != 'closed' OR admin_sig IS NOT NULL`
    ),
  ]
);

// ─── Low-stock pings (G14 dedup) ─────────────────────────────────────────────

export const lowStockPings = pgTable("low_stock_pings", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  inventoryItemId: text("inventory_item_id").notNull().references(() => inventoryItems.id),
  staffId: text("staff_id").notNull().references(() => staff.id),
  firedAt: timestamp("fired_at", { withTimezone: true }).defaultNow().notNull(),
  /** Stock level (integer base units) at the time the ping was sent. */
  stockAtFire: integer("stock_at_fire").notNull(),
});

// ─── Weekly reports (G14 cron) ────────────────────────────────────────────────

export const weeklyReports = pgTable("weekly_reports", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  /** ISO date of Monday that starts the week (SAST). */
  weekStarting: text("week_starting").notNull().unique(),
  revenueZar: integer("revenue_zar").notNull(),
  cogsZar: integer("cogs_zar").notNull(),
  expensesZar: integer("expenses_zar").notNull(),
  grossMarginZar: integer("gross_margin_zar").notNull(),
  netZar: integer("net_zar").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Pending charges (G9 — wallet top-ups + coffee packs via Yoco) ────────────

export const pendingCharges = pgTable("pending_charges", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  yocoCheckoutId: text("yoco_checkout_id").notNull().unique(),
  kind: chargeKind("kind").notNull(),
  customerId: text("customer_id").notNull().references(() => customers.id),
  amountZar: integer("amount_zar").notNull(),
  status: paymentStatus("status").default("pending").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Coffee packs (G9 — L16: barista-sold, 90-day expiry) ─────────────────────

export const coffeePacks = pgTable("coffee_packs", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  customerId: text("customer_id").notNull().references(() => customers.id),
  menuItemId: text("menu_item_id").notNull().references(() => menuItems.id),
  qtyOriginal: integer("qty_original").notNull(),
  qtyRemaining: integer("qty_remaining").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  pendingChargeId: text("pending_charge_id").notNull().references(() => pendingCharges.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Wallet transactions (G17 — append-only ledger) ──────────────────────────

export const walletTransactions = pgTable("wallet_transactions", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  customerId: text("customer_id").notNull().references(() => customers.id),
  /** Signed integer cents: positive = credit, negative = debit. */
  deltaZar: integer("delta_zar").notNull(),
  kind: walletTxnKind("kind").notNull(),
  relatedOrderId: text("related_order_id").references(() => orders.id),
  relatedPendingChargeId: text("related_pending_charge_id").references(() => pendingCharges.id),
  description: text("description"),
  at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Sync conflicts (G17 — offline sync conflict log) ────────────────────────

export const syncConflicts = pgTable("sync_conflicts", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  kind: syncConflictKind("kind").notNull(),
  orderId: text("order_id").references(() => orders.id),
  clientPayload: jsonb("client_payload").notNull(),
  serverState: jsonb("server_state"),
  status: syncConflictStatus("status").default("open").notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: text("resolved_by").references(() => staff.id),
  resolutionNote: text("resolution_note"),
});

// ─── Outbox log (G17 — offline POS order queue) ───────────────────────────────

export const outboxLog = pgTable("outbox_log", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  /** UUID generated by the POS client — idempotency key. */
  clientUuid: text("client_uuid").notNull().unique(),
  customerId: text("customer_id").references(() => customers.id),
  staffId: text("staff_id").notNull().references(() => staff.id),
  payload: jsonb("payload").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  conflictId: text("conflict_id").references(() => syncConflicts.id),
});

// ─── Magic link tokens (G16 — customer email auth) ───────────────────────────

export const magicLinkTokens = pgTable("magic_link_tokens", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});
