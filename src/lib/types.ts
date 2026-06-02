// Shared types — imported by all verticals.
// Source of truth: docs/DATA_MODEL.md + docs/API.md

// ─── Enums ────────────────────────────────────────────────────────────────────

export type OrderState =
  | "ordered"
  | "in_progress"
  | "ready"
  | "collected"
  | "cancelled";

export type StaffRole =
  | "barista"
  | "roaster"
  | "manager"
  | "admin"
  | "finance"
  | "owner";

export type MenuCategory =
  | "coffee"
  | "tea"
  | "cold_brew"
  | "food"
  | "merchandise"
  | "other";

export type LoyaltyKind = "earn" | "redeem" | "adjustment" | "expiry";

export type PaymentStatus = "pending" | "successful" | "failed" | "refunded";

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
