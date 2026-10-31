// Shared types — imported by all verticals.
// Source of truth: docs/DATA_MODEL.md + docs/API.md

import type { CostState } from "@/lib/cost-state";

// ─── Enums ────────────────────────────────────────────────────────────────────

export type OrderState =
  | "ordered"
  | "in_progress"
  | "ready"
  | "collected"
  | "cancelled";

export type StaffRole = "barista" | "admin";

export type MenuCategory =
  | "coffee"
  | "tea"
  | "cold_brew"
  | "food"
  | "merchandise"
  | "other";

// AT-201 / PRD §10.3.3 — mirrors db/enums.ts paymentStatus.
export type PaymentStatus = "pending" | "successful" | "declined" | "unresolved";

// ─── Domain Types ─────────────────────────────────────────────────────────────

export type Staff = {
  id: string;
  name: string;
  role: StaffRole;
  active: boolean;
};

export type Customer = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
};

/**
 * POS customer search result (REQ-142 / AT-185 / AT-213). Carries no email and
 * no full phone number — the surname, and the last four phone digits, tell
 * apart two people whose given names read alike.
 */
export type CustomerSearchResult = {
  id: string;
  /** Given name only (AT-211). */
  name: string;
  surname: string | null;
  phoneLast4: string | null;
};

export type MenuCustomisation = {
  id: string;
  name: string;
  priceDeltaZar: number;
  // AT-145 — present when fetched via getMenu() (drives UI: a customisation
  // with addsInventoryItemId set renders as a stepper, not a toggle). Absent
  // on the snapshot stored in an order's modifications — not needed there.
  substitutesInventoryItemId?: string | null;
  addsInventoryItemId?: string | null;
  addsQuantity?: number | null;
};

export type MenuItem = {
  id: string;
  name: string;
  category: MenuCategory;
  currentPriceZar: number;
  active: boolean;
  customisations: MenuCustomisation[];
};

export type OrderItem = {
  id: string;
  menuItemId: string;
  menuItemName: string;
  quantity: number;
  unitPriceZar: number;
  modifications: MenuCustomisation[];
  /** Integer cents taken off this line (L03 free cup = one unit). 0 when none. */
  discountZar?: number;
  /** §6.9: live (unreversed) Untracked voucher redemptions on this line. Absent = 0. */
  voucherCount?: number;
};

export type Order = {
  id: string;
  customerId: string | null;
  customerName: string | null;
  staffId: string;
  state: OrderState;
  placedAt: string;
  completedAt: string | null;
  totalZar: number;
  isStaffDiscount: boolean;
  paymentStatus: PaymentStatus | null;
  /** Paid, or a tender attempt is open — the order's total is frozen (owner rule, PRD P4). */
  cardCheckout?: boolean;
  /** REQ-008 / S4: a SENT attempt ended unresolved — the drink is made while recovery asks Yoco. */
  paymentAwaitingLookup?: boolean;
  items: OrderItem[];
};

// ─── Server Action Response ───────────────────────────────────────────────────

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

// ─── SSE Queue ────────────────────────────────────────────────────────────────

export type QueueEvent =
  | {
      type: "state_change";
      orderId: string;
      state: OrderState;
      at: string;
      customerName?: string | null;
    }
  | {
      type: "heartbeat";
      at: string;
    };

// ─── Session ──────────────────────────────────────────────────────────────────

export type SessionUser = {
  id: string;
  name: string;
  role: StaffRole;
};

// ─── Operating Hours ──────────────────────────────────────────────────────────

export type OperatingHour = {
  dayOfWeek: number; // 0=Sun … 6=Sat
  opensAt: string;   // "HH:mm"
  closesAt: string;  // "HH:mm"
  isClosed: boolean;
};


// ─── Audit Log ────────────────────────────────────────────────────────────────

export type AuditLog = {
  id: string;
  entityKind: string;
  entityId: string;
  action: string;
  actorId: string | null;
  actorRole: string | null;
  at: string; // ISO 8601 timestamp
  before: unknown | null;
  after: unknown | null;
  reason: string | null;
};

// ─── Phase 2: Inventory ───────────────────────────────────────────────────────

export type InventoryKind =
  | "bean"
  | "milk"
  | "syrup"
  | "packaging"
  | "equipment"
  | "other";

export type InventoryUnit = "g" | "kg" | "ml" | "l" | "unit" | "bag" | "cup";

export type LotState =
  | "active"
  | "depleted"
  | "expired"
  | "quarantined"
  // Container model (milk & beans): sealed (active) → open → closed.
  | "open"
  | "closed";

/** Summary row returned by listInventory() — one row per item. */
export type InventoryItemStatus = {
  id: string;
  name: string;
  kind: InventoryKind;
  unit: InventoryUnit;
  lowStockThreshold: number;
  /** Running stock = SUM(stock_movements.delta) across all active lots. */
  currentStock: number;
  /** ok = above threshold; low = below threshold; out = ≤ 0. */
  status: "ok" | "low" | "out";
};

/** Full lot row with computed remaining quantity. */
export type InventoryLot = {
  id: string;
  inventoryItemId: string;
  inventoryItemName: string;
  sourceName: string | null;
  batchNumber: string | null;
  roastDate: string | null; // ISO 8601
  receivedAt: string; // ISO 8601
  state: LotState;
  origin: string | null;
  /** numeric(10,4) from PG — cents per base unit (see DATA_MODEL.md §G8 note). */
  unitCostZar: string | null;
  /** numeric(10,2) quantity received in the item's own unit. */
  quantityReceived: string | null;
  /** Computed: SUM(delta) for this lot's stock_movements. */
  quantityRemaining: number;
  // ── Container model (cup items) ──────────────────────────────────────────────
  /** When this container was opened on the POS (ISO 8601), or null. */
  openedAt?: string | null;
  /** When this container was closed/finished (ISO 8601), or null. */
  closedAt?: string | null;
  /** Cups actually made from this container = -SUM(delta) of deduction movements. */
  cupsMade?: number;
  /** Real container size bought (e.g. 1, 2), in containerSizeUnit. Null for legacy/quantity-model lots. */
  containerSize?: string | null;
  containerSizeUnit?: InventoryUnit | null;
  /** Real Rand cost paid for this specific container (integer cents). Null for legacy/quantity-model lots. */
  containerCostZar?: number | null;
};

/** Lightweight status used by POS to show low-stock badges (M9). */
export type InventoryStatusMap = Record<string, InventoryItemStatus>;

/** One container's real yield — closed lots have the final numbers; the
 *  currently-open one (if any) shows progress so far. */
export type ContainerYield = {
  lotId: string;
  inventoryItemId: string;
  inventoryItemName: string;
  itemKind: InventoryKind;
  sourceName: string | null;
  containerSize: string | null;
  containerSizeUnit: InventoryUnit | null;
  containerCostZar: number | null;
  cupsMade: number;
  /** Real cost per cup in cents (containerCostZar / cupsMade), or null if not yet knowable. */
  costPerCupZar: number | null;
  state: "open" | "closed";
  openedAt: string | null; // ISO 8601
  closedAt: string | null; // ISO 8601
  /** Cups made from this lot, split by drink type — exact (see stock_movements.menuItemId).
   *  Empty for deductions made before that column existed. */
  drinkBreakdown: { menuItemName: string; cups: number }[];
};

// ─── Phase 2: COGS ────────────────────────────────────────────────────────────

export type CogsLive = {
  date: string; // YYYY-MM-DD in Africa/Johannesburg
  revenueZar: number;
  /** Σ order_cogs (REQ-106). NULL = UNAVAILABLE — an absent cost input (REQ-109). */
  cogsZar: number | null;
  expensesZar: number;
  grossMarginZar: number | null; // revenueZar - cogsZar; NULL when cogs is
  netZar: number | null; // grossMarginZar - expensesZar; NULL when cogs is
  /**
   * AT-191/AT-192 (REQ-110, REQ-129): empty | unavailable | provisional | final.
   * provisional = some contributing lot's cost_source is 'estimate' — never green.
   */
  costState: CostState;
  /** Names of the inventory items whose cost is absent (state "unavailable"). */
  absentItems: string[];
  /** Orders in the period with no order_cogs row (state "unavailable"). */
  ordersWithoutCost: number;
};

/**
 * Lightweight POS-readable daily summary (M12). Unlike CogsLive (admin/owner),
 * this is visible to baristas — it exposes only volume + revenue, no margins.
 */
export type PosTodaySummary = {
  date: string; // YYYY-MM-DD in Africa/Johannesburg
  orderCount: number;
  revenueZar: number;
  wasteCount: number;
};

// ─── Phase 2: Purchases ───────────────────────────────────────────────────────

export type PurchaseKind = "planned" | "emergency";
export type PurchaseStatus = "active" | "pending_admin_approval";

export type Purchase = {
  id: string;
  sourceName: string;
  receivedAt: string; // ISO 8601
  totalZar: number;
  kind: PurchaseKind;
  /** Derived: emergency + adminApprovedBy IS NULL → pending. */
  status: PurchaseStatus;
  adminApprovedBy: string | null; // staff id
};

/**
 * One lot received in a purchase (input to recordPurchase).
 *
 * Two shapes, chosen server-side by the inventory item's own unit — the
 * client just sends whichever fields apply:
 *   - Container items (unit='cup': milk & beans) — real-world size bought
 *     (e.g. 1, 2 litres/kg) + what was paid. No yield is predicted; actual
 *     cups made are only ever counted as they're deducted (see cupsMade on
 *     InventoryLot), never estimated up front.
 *   - Everything else (cups, lids, syrup, powder) — unchanged quantity model.
 */
export type PurchaseLotItem = {
  inventoryItemId: string;
  /** Total cost for this lot item in integer cents. */
  totalZar: number;
} & (
  | {
      /** Quantity received in the item's own unit (positive number). */
      quantity: number;
      /** Cost per base unit as a numeric string (matches numeric(10,4) column). */
      unitCostZar: string;
      containerSize?: undefined;
      containerSizeUnit?: undefined;
    }
  | {
      /** Real size bought (e.g. 1, 2), in containerSizeUnit. */
      containerSize: number;
      containerSizeUnit: InventoryUnit;
      quantity?: undefined;
      unitCostZar?: undefined;
    }
);

export type RecordPurchaseInput = {
  sourceName: string;
  kind: PurchaseKind;
  items: PurchaseLotItem[];
};

// ─── Phase 2: Low-stock alert recipients ─────────────────────────────────────

export type AlertRecipient = {
  id: string;
  staffId: string;
  staffName: string;
  staffRole: string;
  /** null = global (receives alerts for all items). */
  inventoryItemId: string | null;
  inventoryItemName: string | null;
};

// ─── Phase 2: Stock Takes ─────────────────────────────────────────────────────

export type StockTakeKind = "full" | "spot";

export type StockTakeLine = {
  id: string;
  inventoryLotId: string;
  inventoryItemName: string;
  /** Base unit of the inventory item (g, ml, units, etc.). */
  unit?: string | null;
  /** Kind of the inventory item (beans, milk, etc.). */
  itemKind?: string | null;
  /** ISO timestamp — when this lot was received. */
  lotReceivedAt?: string | null;
  /** Supplier / source name for this lot. */
  lotSourceName?: string | null;
  /** ISO timestamp — roast date (beans only). */
  roastDate?: string | null;
  expected: number;
  counted: number | null; // null = not yet counted in this take
  /** null until counted. pct variance vs expected. */
  variancePct: number | null;
};

export type StockTake = {
  id: string;
  kind: StockTakeKind;
  startedAt: string; // ISO 8601
  completedAt: string | null;
  byStaffId: string;
  byStaffName: string;
  /** Weighted variance % across all lines (null until closed). */
  variancePct: number | null;
  lines: StockTakeLine[];
};

// ─── Phase 2: Recipes ─────────────────────────────────────────────────────────

export type RecipeIngredientDetail = {
  id: string;
  inventoryItemId: string;
  inventoryItemName: string;
  quantity: number;
  unit: InventoryUnit;
  tolerancePct: number;
};

export type RecipeDetail = {
  id: string;
  menuItemId: string;
  menuItemName: string;
  version: number;
  ingredients: RecipeIngredientDetail[];
};

// ─── Phase 2: Reports ─────────────────────────────────────────────────────────

export type WeeklyReport = {
  id: string;
  weekStarting: string; // ISO 8601 date (Monday)
  revenueZar: number;
  cogsZar: number;
  expensesZar: number;
  grossMarginZar: number;
  netZar: number;
  generatedAt: string; // ISO 8601
};

export type MonthlyReportStatus =
  | "draft"
  | "awaiting_signatures"
  | "closed";

export type MonthlyReportSig = {
  signerId: string;
  signerName: string;
  at: string; // ISO 8601
};

export type MonthlyReport = {
  id: string;
  month: string; // YYYY-MM-DD (first of month)
  revenueZar: number;
  /** NULL = UNAVAILABLE (REQ-109); see costState / cogsAbsentItems. */
  cogsZar: number | null;
  expensesZar: number;
  grossMarginZar: number | null;
  netZar: number | null;
  costState: CostState;
  /** Inventory item names (or ids) whose cost was absent. */
  cogsAbsentItems: string[];
  /** Orders in the month with no order_cogs row (named in the refusal). */
  ordersWithoutCost: number;
  status: MonthlyReportStatus;
  adminSig: MonthlyReportSig | null;
  generatedAt: string; // ISO 8601
  closedAt: string | null;
};
