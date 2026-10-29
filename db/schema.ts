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
  primaryKey,
  foreignKey,
  type AnyPgColumn,
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
  customerStatus,
  sessionMode,
  compReason,
  notificationTarget,
  donorFundEntryKind,
  fundingMethod,
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
  // AT-203 / L47: `donor_fund` — settled from a blessing fund (one spend entry
  // in donor_fund_entries, never a payments row).
  paymentMode: text("payment_mode", {
    enum: ["yoco", "yoco_deferred", "free", "donor_fund"],
  }),
  // AT-181 / L07 · REQ-039: the SAST revenue day, from the server's clock at
  // receipt (never the client's). Midnight SAST is the boundary.
  revenueDay: date("revenue_day").notNull(),
  // L28 / REQ-046 / PRD §10.3: bound at ring-up, never null, no default —
  // `none` is chosen, never defaulted into. The target customer is customer_id.
  notificationTarget: notificationTarget("notification_target").notNull(),
  // AT-201 / PRD §10.3, P3, REQ-027: the root of every tender reference —
  // payments.client_reference = client_uuid || ':' || attempt. NOT NULL,
  // UNIQUE. The DB default stays (migration 0036): createOrder, the offline
  // replay (apply-outbox) and the demo seed do not pass a POS-minted uuid yet
  // (S7b's repeat-submission rule is not built).
  clientUuid: text("client_uuid").default(sql`gen_random_uuid()`).notNull().unique(),
}, () => [
  // PRD §10.3: a row can never claim it will notify someone and carry no customer.
  check(
    "orders_notification_target_customer",
    sql`(notification_target = 'customer') = (customer_id IS NOT NULL)`
  ),
]);

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

// ─── Payments ─────────────────────────────────────────────────────────────────

// AT-201 / PRD §10.3.3: one row per payment ATTEMPT, not per order.
export const payments = pgTable("payments", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  // The payment's subject: an order OR a fund top-up, exactly one (CHECK below).
  orderId: text("order_id").references(() => orders.id),
  // → donor_fund_entries.id: a card `top_up` entry (AT-203, §6.10.3, §10.3).
  fundTopupId: text("fund_topup_id").references((): AnyPgColumn => donorFundEntries.id),
  // 1, 2, 3 … per subject. A re-attempt adds a row; it never overwrites.
  attempt: integer("attempt").notNull(),
  // `client_uuid:attempt` (P3, REQ-027), written BEFORE the send.
  clientReference: text("client_reference").notNull().unique(),
  // Legacy Yoco Online checkout id. Nothing writes or reads it since AT-201
  // part 2b removed that flow; kept so old rows keep their history. Dropping
  // the column is a separate migration.
  yocoCheckoutId: text("yoco_checkout_id"),
  // Yoco's payment id, persisted the moment the send returns (REQ-029).
  yocoPaymentId: text("yoco_payment_id").unique(),
  // Which machine took the money, read once from config at beginTender (REQ-065).
  webposDeviceId: text("webpos_device_id").notNull(),
  // What was sent to the machine — integer cents, frozen (P4).
  amountZar: integer("amount_zar").notNull(),
  // What the machine actually charged — NULL until an outcome is known (REQ-030).
  chargedAmountZar: integer("charged_amount_zar"),
  // Yoco's actual fee from the daily import — NULL, never 0, while unknown.
  feeZar: integer("fee_zar"),
  tipZar: integer("tip_zar").default(0).notNull(),
  receiptNo: text("receipt_no"),
  settlementRef: text("settlement_ref"),
  status: paymentStatus("status").default("pending").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  // Legacy webhook timestamp. Nothing writes or reads it since AT-201 part 2b
  // retired the webhook (§11.1); kept for old rows, dropped separately.
  webhookReceivedAt: timestamp("webhook_received_at", { withTimezone: true }),
}, (t) => [
  // AT-181 / REQ-011: an order has at most one successful payment, and the
  // database enforces it.
  uniqueIndex("payments_one_successful_per_order")
    .on(t.orderId)
    .where(sql`status = 'successful'`),
  // AT-201 / §10.6 (COL-5): the same guarantee for fund top-ups — NULLs are
  // distinct, so the order index alone leaves top-ups unguarded.
  uniqueIndex("payments_one_successful_per_fund_topup")
    .on(t.fundTopupId)
    .where(sql`status = 'successful'`),
  // AT-201 / §10.3.3: attempt is "1, 2, 3 … per order" — one row per attempt.
  unique("payments_order_attempt_unique").on(t.orderId, t.attempt),
  // AT-203: the same "1, 2, 3 … per subject" for a fund top-up.
  unique("payments_fund_topup_attempt_unique").on(t.fundTopupId, t.attempt),
  // AT-201 / §10.3: a payment points at exactly one subject.
  check("payments_exactly_one_subject", sql`num_nonnulls(${t.orderId}, ${t.fundTopupId}) = 1`),
]);

// ─── Blessing funds (AT-203, PRD §6.10, §10.3, L44–L47) ──────────────────────
// A named, non-refundable balance that pays for other people's coffee. There
// is NO balance column: the ledger is the truth and the balance is the sum of
// donor_fund_entries (§6.10.5, §6.10.7). A card top-up counts toward it only
// while its payment is `successful`.

export const donorFunds = pgTable("donor_funds", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  // `FVO-` + four characters from ABCDEFGHJKMNPQRSTUVWXYZ23456789 (§6.10.3).
  code: text("code").notNull().unique(),
  // NULL = an unnamed fund (found by code; an Admin push fires at creation, R22).
  displayName: text("display_name"),
  donorCustomerId: text("donor_customer_id").references(() => customers.id, { onDelete: "set null" }),
  // L45: the non-refundability acknowledgement, recorded on the row. The staff
  // member who told the donor at intake.
  nonRefundableAckBy: text("non_refundable_ack_by").notNull().references(() => staff.id),
  active: boolean("active").default(true).notNull(),
  createdByStaffId: text("created_by_staff_id").notNull().references(() => staff.id),
  at: now(),
}, (t) => [
  // The target of donor_fund_members' (fund_id, fund_active) foreign key.
  unique("donor_funds_id_active_unique").on(t.id, t.active),
  check("donor_funds_code_shape", sql`${t.code} ~ '^FVO-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$'`),
]);

// Append-only (trigger-enforced in 0045): never UPDATE or DELETE a row (§10.6).
// Amounts are signed integer cents: top_up > 0; spend and sweep < 0;
// adjustment > 0 and tied to an order (a cancelled fund-paid order's draw, given back).
export const donorFundEntries = pgTable("donor_fund_entries", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: tenantId(),
  fundId: text("fund_id").notNull().references(() => donorFunds.id),
  kind: donorFundEntryKind("kind").notNull(),
  amountZar: integer("amount_zar").notNull(),
  orderId: text("order_id").references(() => orders.id),
  // §10.3 lists it; a card top-up is linked from payments.fund_topup_id
  // instead (the entry is written before its payment exists, and is never
  // updated), so nothing writes this today.
  paymentId: text("payment_id").references((): AnyPgColumn => payments.id),
  fundingMethod: fundingMethod("funding_method"),
  reference: text("reference"),
  // §6.10.3 step 5: a card top-up mints its own client_uuid, the root of
  // payments.client_reference (client_uuid:attempt), so S4 can find it.
  clientUuid: text("client_uuid").unique(),
  recordedByStaffId: text("recorded_by_staff_id").notNull().references(() => staff.id),
  reason: text("reason"),
  at: now(),
}, (t) => [
  index("donor_fund_entries_fund_idx").on(t.fundId),
  check(
    "donor_fund_entries_sign",
    sql`(${t.kind} = 'top_up' AND ${t.amountZar} > 0) OR (${t.kind} IN ('spend', 'sweep') AND ${t.amountZar} < 0) OR (${t.kind} = 'adjustment' AND ${t.amountZar} > 0)`
  ),
  // An adjustment only gives back a cancelled order's draw (REQ-168): never a
  // way for money to enter a fund without external proof (L44).
  check("donor_fund_entries_adjustment_order", sql`${t.kind} <> 'adjustment' OR ${t.orderId} IS NOT NULL`),
  // A top-up names how the money arrived; nothing else does.
  check("donor_fund_entries_method", sql`(${t.kind} = 'top_up') = (${t.fundingMethod} IS NOT NULL)`),
  // Card top-ups carry their own client_uuid; nothing else does.
  check(
    "donor_fund_entries_card_uuid",
    sql`(${t.kind} = 'top_up' AND ${t.fundingMethod} = 'card') = (${t.clientUuid} IS NOT NULL)`
  ),
  // L44 / REQ-161: a cash or EFT gift carries its external proof.
  check(
    "donor_fund_entries_offline_reference",
    sql`${t.fundingMethod} IS NULL OR ${t.fundingMethod} = 'card' OR length(btrim(coalesce(${t.reference}, ''))) > 0`
  ),
  check("donor_fund_entries_spend_order", sql`${t.kind} <> 'spend' OR ${t.orderId} IS NOT NULL`),
  check("donor_fund_entries_sweep_reason", sql`${t.kind} <> 'sweep' OR length(btrim(coalesce(${t.reason}, ''))) > 0`),
  // One draw per order, and at most one compensating entry per order.
  uniqueIndex("donor_fund_entries_one_spend_per_order").on(t.orderId).where(sql`kind = 'spend'`),
  uniqueIndex("donor_fund_entries_one_adjustment_per_order")
    .on(t.orderId)
    .where(sql`kind = 'adjustment' AND order_id IS NOT NULL`),
]);

// The linked names. Empty = barista discretion; non-empty gates every draw on
// the list (§6.10.2). There is no fund-type column — this table is the switch.
// Personal data: deleted with the customer (§9.4), while the ledger stays.
export const donorFundMembers = pgTable("donor_fund_members", {
  fundId: text("fund_id").notNull(),
  customerId: text("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  // Mirrors donor_funds.active through the composite FK below (ON UPDATE
  // CASCADE), so the partial unique index can read "over active funds".
  fundActive: boolean("fund_active").default(true).notNull(),
  addedByStaffId: text("added_by_staff_id").notNull().references(() => staff.id),
  at: now(),
}, (t) => [
  primaryKey({ name: "donor_fund_members_pkey", columns: [t.fundId, t.customerId] }),
  foreignKey({
    name: "donor_fund_members_fund_fk",
    columns: [t.fundId, t.fundActive],
    foreignColumns: [donorFunds.id, donorFunds.active],
  }).onUpdate("cascade"),
  // L46 / REQ-172: one person, at most one active linked fund — by the DB.
  uniqueIndex("donor_fund_members_one_active_fund_per_customer").on(t.customerId).where(sql`fund_active`),
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

// ─── Config ───────────────────────────────────────────────────────────────────

// AT-201 part 2b / PRD §10.4: "One app_config table, keyed (tenant_id, key),
// values typed as jsonb, every write audited with before/after and a reason,
// Admin-only." First key read: webpos_device_id (§9.10.1), by beginTender only.
export const appConfig = pgTable(
  "app_config",
  {
    tenantId: tenantId(),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ name: "app_config_pkey", columns: [t.tenantId, t.key] })]
);

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
