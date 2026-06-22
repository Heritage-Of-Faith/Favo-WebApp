// Shared types — imported by all verticals.
// Source of truth: docs/DATA_MODEL.md + docs/API.md

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

export type LoyaltyKind = "earn" | "redeem" | "adjustment" | "expiry";

export type PaymentStatus = "pending" | "successful" | "failed" | "refunded" | "deferred";

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
  loyaltyPoints: number;
  walletZar: number;
  activePackCount: number;
};

export type MenuCustomisation = {
  id: string;
  name: string;
  priceDeltaZar: number;
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
  items: OrderItem[];
};

// ─── Server Action Response ───────────────────────────────────────────────────

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

// ─── Yoco ─────────────────────────────────────────────────────────────────────

export type YocoPaymentIntent = {
  id: string;
  clientSecret: string;
  amountZar: number;
  currency: "ZAR";
  status: PaymentStatus;
};

// ─── SSE Queue ────────────────────────────────────────────────────────────────

export type QueueEvent =
  | {
      type: "state_change";
      orderId: string;
      state: OrderState;
      at: string;
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

export type InventoryUnit = "g" | "kg" | "ml" | "l" | "unit" | "bag";

export type LotState = "active" | "depleted" | "expired" | "quarantined";

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
};

/** Lightweight status used by POS to show low-stock badges (M9). */
export type InventoryStatusMap = Record<string, InventoryItemStatus>;

// ─── Phase 2: COGS ────────────────────────────────────────────────────────────

export type CogsLive = {
  date: string; // YYYY-MM-DD in Africa/Johannesburg
  revenueZar: number;
  cogsZar: number;
  expensesZar: number;
  grossMarginZar: number; // revenueZar - cogsZar
  netZar: number; // grossMarginZar - expensesZar
  profit: boolean; // netZar > 0
  /**
   * True if any lot contributing to today's COGS was flagged
   * cost_estimated=true (R10 mitigation).  Admin should recost via A8.
   */
  costEstimatedWarning: boolean;
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

/** One lot received in a purchase (input to recordPurchase). */
export type PurchaseLotItem = {
  inventoryItemId: string;
  /** Quantity received in the item's own unit (positive number). */
  quantity: number;
  /** Cost per base unit as a numeric string (matches numeric(10,4) column). */
  unitCostZar: string;
  /** Total cost for this lot item in integer cents. */
  totalZar: number;
};

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
  cogsZar: number;
  expensesZar: number;
  grossMarginZar: number;
  netZar: number;
  status: MonthlyReportStatus;
  adminSig: MonthlyReportSig | null;
  generatedAt: string; // ISO 8601
  closedAt: string | null;
};
