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
  date,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  orderState,
  staffRole,
  menuCategory,
  inventoryKind,
  inventoryUnit,
  lotState,
  reportCostState,
  costSource,
  stockMovementKind,
  stockTakeKind,
  paymentStatus,
  refundStatus,
  wasteCategory,
  purchaseKind,
  expenseCategory,
  customerStatus,
  sessionMode,
  compReason,
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

export const customers = pgTable("customers", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  authId: uuid("auth_id").unique(),
  email: text("email").unique(),
  name: text("name").notNull(),
  phone: text("phone"),
  pushSubscription: jsonb("push_subscription"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  // AT-181 (owner decision AT-180): surname is its own field, beside `name`.
  surname: text("surname"),
  // AT-181 / PRD §10.3: free-coffee eligibility (L03) and audience targeting.
  status: customerStatus("status").default("church_member").notNull(),
});

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
  // AT-145: inventory effects, so deductForOrder can actually read what was
  // chosen instead of always deducting the base recipe. At most one of these
  // is set per customisation — they're mutually exclusive kinds of effect.
  //   substitutesInventoryItemId: this customisation REPLACES whichever recipe
  //     ingredient shares its inventory kind (e.g. Oat Milk replaces the
  //     recipe's milk ingredient, whatever it is). One-per-selection, toggle UI.
  //   addsInventoryItemId + addsQuantity: this customisation ADDS extra units
  //     of an ingredient on top of the base recipe (e.g. Extra Shot adds
  //     addsQuantity cups of beans). Repeatable — appears once per unit in
  //     orderItems.modifications, so 3 selections = 3 additions. Stepper UI.
  substitutesInventoryItemId: text("substitutes_inventory_item_id").references(() => inventoryItems.id),
  addsInventoryItemId: text("adds_inventory_item_id").references(() => inventoryItems.id),
  addsQuantity: integer("adds_quantity"),
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
  // Container model (milk & beans): when this lot (= one physical bottle/bag)
  // was opened on the POS and when it was finished/closed. Null for non-container
  // lots and for sealed containers not yet opened.
  openedAt: timestamp("opened_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  origin: text("origin"),
  // Exception to the integer-cents rule: per-unit production cost is a RATE,
  // not a money amount. When unit=g or unit=ml the cost per gram/ml is
  // sub-cent (e.g. R450/kg → 0.45 ¢/g). Using integer would force it to 0
  // and break COGS entirely. numeric(10,4) gives 4-decimal cent precision.
  // G13 COGS sums (delta × unit_cost_zar) → cast to integer cents at
  // the order level. Admin recosts via A8 after launch (R10 mitigation).
  unitCostZar: numeric("unit_cost_zar", { precision: 10, scale: 4 }),
  // AT-191 / PRD §7.0.1b: estimate | invoice. Any drink costed from an
  // 'estimate' lot renders provisional, never green (REQ-110).
  costSource: costSource("cost_source").default("estimate").notNull(),
  // Quantity received when this lot was booked in (in the item's unit).
  // Legacy path only (non-cup items: cups, lids, syrup, powder). Cup-unit
  // container lots (milk & beans) no longer predict a cup yield up front —
  // see containerSize/containerSizeUnit/containerCostZar below — so this is
  // null for any lot purchased after that change shipped.
  quantityReceived: numeric("quantity_received", { precision: 10, scale: 2 }),
  // Real-world container purchase (milk & beans, replacing the predicted-cup-
  // yield model above): the actual size bought (e.g. 1, 2) and its real unit
  // (l for milk, kg for beans), plus the real Rand cost paid for that specific
  // container. No yield is estimated at purchase time — actual cups made are
  // only ever counted as they're deducted (see cupsMade), and unitCostZar for
  // these lots is a historical average (see recordPurchase), later replaced by
  // the lot's own actual cost/cup once closed (see closeContainer).
  containerSize: numeric("container_size", { precision: 10, scale: 2 }),
  containerSizeUnit: inventoryUnit("container_size_unit"),
  containerCostZar: integer("container_cost_zar"),
}, (t) => [
  // Container model invariant: at most one OPEN container per inventory item.
  // Enforced in the DB so two concurrent orders can't both open a new bottle.
  uniqueIndex("uq_one_open_lot_per_item")
    .on(t.inventoryItemId)
    .where(sql`${t.state} = 'open'`),
]);

export const stockMovements = pgTable("stock_movements", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  inventoryLotId: text("inventory_lot_id").notNull().references(() => inventoryLots.id),
  delta: integer("delta").notNull(),
  kind: stockMovementKind("kind").notNull(),
  relatedOrderId: text("related_order_id"),
  // Which drink this deduction came from, when it's a per-order-line deduction
  // (kind='deduction' from deductForOrder) — lets the yield report break a
  // container's cups down by drink type exactly, instead of guessing from
  // relatedOrderId alone (which can't tell two drinks in the same order apart
  // if both use the same ingredient). Null for restock/adjustment/stock_take.
  menuItemId: text("menu_item_id").references(() => menuItems.id),
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
    enum: ["yoco", "yoco_deferred", "free"],
  }),
  // AT-181 / L07 · REQ-039: the SAST revenue day, from the server's clock at
  // receipt (never the client's). Midnight SAST is the boundary.
  revenueDay: date("revenue_day").notNull(),
});

export const orderItems = pgTable("order_items", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: text("order_id").notNull().references(() => orders.id),
  menuItemId: text("menu_item_id").notNull().references(() => menuItems.id),
  quantity: integer("quantity").default(1).notNull(),
  unitPriceZar: integer("unit_price_zar").notNull(),
  modifications: jsonb("modifications").default([]).notNull(),
  // AT-181 B1 (Nikao, PR #257, option A): the per-unit sum of the priced
  // modifications' price_delta_zar, snapshotted at ring-up. Integer cents.
  modsZar: integer("mods_zar").default(0).notNull(),
  // AT-181 / PRD §10.3: the shot count is a column, never part of a name.
  // The DB CHECK enforces the outer ceiling (T15 max_shots_per_line = 4).
  shots: integer("shots").default(1).notNull(),
  // AT-181 / PRD §10.3: the one place a line's discount lives (L03 free cup,
  // L33 comp, §6.9 voucher). Integer cents.
  discountZar: integer("discount_zar").default(0).notNull(),
  compReason: compReason("comp_reason"),
}, () => [
  check("order_items_shots_range", sql`shots BETWEEN 1 AND 4`),
  // DEF-A's floor: a line can never be discounted past its own value.
  check("order_items_discount_within_line", sql`discount_zar <= quantity * (unit_price_zar + mods_zar)`),
  check("order_items_quantity_positive", sql`quantity >= 1`),
]);

// AT-188 · REQ-106 · PRD §7.0.2 L1770 — each order's COGS, frozen at the sale.
// Written once, in the same transaction as the stock deduction at in_progress
// (src/server/orders/order-cogs.ts), and never rewritten: a later recost of a
// lot does not restate the past (owner decision, Nikao 22 Oct 2026). `orders`
// itself is untouched.
//   cogs_zar        — round_half_up(Σ line_cogs), integer cents: THE ONE
//                     ROUNDING POINT. NULL when a consumed ingredient's cost
//                     was absent (NULL or 0.0000) at the sale — never a
//                     smaller number (§7.0.2 L1791–1795).
//   absent_item_ids — the inventory items whose cost was absent; empty when
//                     cogs_zar is a number. The CHECK keeps the two in step.
//   estimated       — NULL = unknown. The lot's cost-source field does not
//                     exist yet (AT-191 adds it), so nothing can say yet
//                     whether the cost was an estimate; never defaulted (§10.6).
export const orderCogs = pgTable("order_cogs", {
  orderId: text("order_id").primaryKey().references(() => orders.id),
  tenantId: tenantId(),
  cogsZar: integer("cogs_zar"),
  absentItemIds: text("absent_item_ids").array().default(sql`'{}'::text[]`).notNull(),
  estimated: boolean("estimated"),
  computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
}, () => [
  check("order_cogs_amount_or_absent", sql`(cogs_zar IS NULL) = (cardinality(absent_item_ids) > 0)`),
  check("order_cogs_nonnegative", sql`cogs_zar >= 0`),
]);

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
}, (t) => [
  // AT-181 / REQ-011: an order has at most one successful payment, and the
  // database enforces it.
  uniqueIndex("payments_one_successful_per_order")
    .on(t.orderId)
    .where(sql`status = 'successful'`),
]);

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

// ─── Staff Entitlement ────────────────────────────────────────────────────────

export const staffEntitlementLog = pgTable(
  "staff_entitlement_log",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: tenantId(),
    // AT-181 / PRD §10.3: the beneficiary — an office staff member — so a FK
    // to `customers`, not `staff`. The table name is now a misnomer; it stays.
    customerId: text("customer_id").notNull().references(() => customers.id),
    appliedByStaffId: text("applied_by_staff_id").notNull().references(() => staff.id),
    orderId: text("order_id").notNull().references(() => orders.id),
    day: text("day").notNull(), // YYYY-MM-DD in Africa/Johannesburg
  },
  (t) => [unique().on(t.customerId, t.day)]
);

// ─── Walk-ins ─────────────────────────────────────────────────────────────────

// AT-209 / PRD §6.5, §10.2, L20, REQ-058: a weekday non-staff visitor's cup,
// logged for consumption reporting. NO IDENTITY OF ANY KIND — no customer
// reference, name, email or phone column, ever. One row per order LINE, so
// §7.0.2's walk_in_cups = Σ quantity counts walk-in cups, not the order's
// (REQ-116). Never charged, never counted against staff_entitlement_log.
export const walkIns = pgTable(
  "walk_ins",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: tenantId(),
    orderId: text("order_id").notNull().references(() => orders.id),
    menuItemId: text("menu_item_id").notNull().references(() => menuItems.id),
    quantity: integer("quantity").default(1).notNull(),
    category: menuCategory("category").notNull(),
    loggedByStaffId: text("logged_by_staff_id").notNull().references(() => staff.id),
    at: now(),
  },
  () => [check("walk_ins_quantity_positive", sql`quantity >= 1`)]
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

// ─── Opening sessions (AT-134 — same-day override on the weekly schedule) ─────
// One row per opening that day (multi-session days are real: the café can
// close and reopen). Created by the barista's opening-time prompt (via_pos)
// or planned by admin in the Today's Hours screen. The barista never records
// a closing time — closes_at is admin-only and open-ended (null) until set.

export const openingSessions = pgTable(
  "opening_sessions",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: tenantId(),
    sessionDate: text("session_date").notNull(), // YYYY-MM-DD (SAST revenue day)
    // AT-181 / PRD §10.3: the day's mode, defaulted from the session date.
    mode: sessionMode("mode").notNull(),
    opensAt: text("opens_at").notNull(),         // "07:30"
    closesAt: text("closes_at"),                 // null = open-ended
    viaPos: boolean("via_pos").default(false).notNull(),
    createdByStaffId: text("created_by_staff_id").references(() => staff.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    /** Set when the customer push for this session was sent — the dedupe record. */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
  },
  (t) => [unique("opening_sessions_date_opens_unique").on(t.sessionDate, t.opensAt)]
);

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
    // AT-189/AT-190 (REQ-106, REQ-109): cogs = Σ order_cogs; NULL = UNAVAILABLE
    // (an absent cost input, named in cogs_absent_items) — never a smaller number.
    cogsZar: integer("cogs_zar"),
    expensesZar: integer("expenses_zar").notNull(),
    grossMarginZar: integer("gross_margin_zar"),
    netZar: integer("net_zar"),
    // AT-192 (REQ-129): empty | unavailable | provisional | final — see src/lib/cost-state.ts.
    costState: reportCostState("cost_state").default("provisional").notNull(),
    cogsAbsentItems: text("cogs_absent_items").array().default(sql`'{}'::text[]`).notNull(),
    /** Orders in the month with no order_cogs row — part of the named refusal. */
    ordersWithoutCost: integer("orders_without_cost").default(0).notNull(),
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
    check("monthly_report_cogs_or_unavailable", sql`(cogs_zar IS NULL) = (cost_state = 'unavailable')`),
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
  // AT-189/AT-190/AT-192: as monthly_reports — NULL cogs = UNAVAILABLE.
  cogsZar: integer("cogs_zar"),
  expensesZar: integer("expenses_zar").notNull(),
  grossMarginZar: integer("gross_margin_zar"),
  netZar: integer("net_zar"),
  costState: reportCostState("cost_state").default("provisional").notNull(),
  cogsAbsentItems: text("cogs_absent_items").array().default(sql`'{}'::text[]`).notNull(),
  ordersWithoutCost: integer("orders_without_cost").default(0).notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
}, () => [
  check("weekly_report_cogs_or_unavailable", sql`(cogs_zar IS NULL) = (cost_state = 'unavailable')`),
]);

// ─── The Favo (AT-142 — one saved order template per customer) ────────────────
// `items` holds FavoItem[] — the exact shape of CreateOrderInput["items"]
// ({ menuItemId, quantity, modifications: customisation-id[] }), validated by
// the shared Zod schema in src/server/favo/schema.ts. One row per customer.

export const favos = pgTable("favos", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  customerId: text("customer_id").notNull().unique().references(() => customers.id),
  items: jsonb("items").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  /** Null when the customer saved it themselves on the PWA; the staff member otherwise. */
  updatedByStaffId: text("updated_by_staff_id").references(() => staff.id),
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
});
