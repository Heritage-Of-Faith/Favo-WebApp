// AT-203 test helper: an in-memory FundStore. It mirrors what the rules lean
// on in Postgres (migration 0045): the ledger is INSERT-only, signed by kind;
// one spend and at most one compensating adjustment per order; one active
// linked fund per customer (the partial unique index, REQ-172); and a
// transaction that throws leaves nothing behind. Transactions run one at a
// time — what SELECT … FOR UPDATE on the order and the fund row gives for one
// fund in Postgres (the real lock is proven in tests/db/funds-balance-lock.test.ts).
//
// A card top-up's payments live in a MemoryTenderStore whose "orders" are the
// top-up entries — the same chain, the same status-writer trail.

import type {
  DonorFund,
  FundAudit,
  FundEntry,
  FundOrder,
  FundStore,
  FundTx,
  NewDonorFund,
  NewFundEntry,
} from "@/server/funds/types";
import type { PaymentStatus } from "@/server/tender/types";
import { MemoryTenderStore } from "../tender/memory-store";

type StoredEntry = Omit<FundEntry, "topupPayments">;
type StoredFund = DonorFund & { donorCustomerId: string | null; nonRefundableAckBy: string };
type Member = { fundId: string; customerId: string; addedByStaffId: string; at: Date };
type OrderAttempt = { orderId: string; attempt: number; status: PaymentStatus; sentAt: Date | null; yocoPaymentId: string | null };

export type FundMemoryState = {
  funds: StoredFund[];
  entries: StoredEntry[];
  members: Member[];
  orders: FundOrder[];
  orderAttempts: OrderAttempt[];
  customers: string[];
  audit: FundAudit[];
};

export class MemoryFundStore implements FundStore {
  state: FundMemoryState;
  /** The tender chain's store for card top-ups: its "orders" are top_up entries. */
  readonly topups = new MemoryTenderStore([]);
  private seq = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(init: Partial<FundMemoryState> = {}) {
    this.state = {
      funds: [], entries: [], members: [], orders: [], orderAttempts: [], customers: [], audit: [],
      ...structuredClone(init),
    };
  }

  // ── test reads ──────────────────────────────────────────────────────────────
  order(id: string) { return this.state.orders.find((o) => o.id === id); }
  entriesOf(fundId: string) { return this.state.entries.filter((e) => e.fundId === fundId); }
  audits(action: string) { return this.state.audit.filter((a) => a.action === action); }
  /** Every payments row of every kind: order attempts and top-up attempts. */
  allPaymentRows() { return [...this.state.orderAttempts, ...this.topups.state.payments]; }

  addFund(f: Partial<StoredFund> & { id: string }, members: string[] = []): void {
    this.state.funds.push({
      code: `FVO-${"ABCD".slice(0, 4)}`, displayName: null, active: true, createdByStaffId: "staff_louis",
      at: new Date("2026-03-01T08:00:00Z"), donorCustomerId: null, nonRefundableAckBy: "staff_louis", ...f,
    });
    for (const c of members) this.state.members.push({ fundId: f.id, customerId: c, addedByStaffId: "staff_admin", at: new Date() });
  }

  addEntry(e: Partial<StoredEntry> & Pick<StoredEntry, "fundId" | "kind" | "amountZar">): string {
    const id = `fe-${++this.seq}`;
    this.state.entries.push({
      id, orderId: null, fundingMethod: e.kind === "top_up" ? "cash" : null, reference: e.kind === "top_up" ? "receipt 1" : null,
      clientUuid: null, recordedByStaffId: "staff_admin", reason: null, at: new Date("2026-03-01T08:00:00Z"), ...e,
    });
    return id;
  }

  async transaction<T>(fn: (tx: FundTx) => Promise<T>): Promise<T> {
    const run = async () => {
      const saved = structuredClone(this.state);
      const savedTopups = structuredClone(this.topups.state);
      try {
        return await fn(this.tx());
      } catch (err) {
        this.state = saved;
        this.topups.state = savedTopups;
        throw err;
      }
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  private withPayments(e: StoredEntry): FundEntry {
    const pays = e.kind === "top_up" && e.fundingMethod === "card"
      ? this.topups.paymentsOf(e.id).map((p) => ({
          status: p.status, sentAt: p.sentAt, yocoPaymentId: p.yocoPaymentId, chargedAmountZar: p.chargedAmountZar,
        }))
      : [];
    return { ...structuredClone(e), topupPayments: pays };
  }

  private checkEntry(e: StoredEntry) {
    if (!Number.isInteger(e.amountZar)) throw new Error("amount_zar must be integer cents");
    const signOk =
      (e.kind === "top_up" && e.amountZar > 0) ||
      ((e.kind === "spend" || e.kind === "sweep") && e.amountZar < 0) ||
      (e.kind === "adjustment" && e.amountZar > 0);
    if (!signOk) throw new Error("donor_fund_entries_sign");
    if (e.kind === "adjustment" && e.orderId === null) throw new Error("donor_fund_entries_adjustment_order");
    if ((e.kind === "top_up") !== (e.fundingMethod !== null)) throw new Error("donor_fund_entries_method");
    if ((e.kind === "top_up" && e.fundingMethod === "card") !== (e.clientUuid !== null)) throw new Error("donor_fund_entries_card_uuid");
    if (e.fundingMethod !== null && e.fundingMethod !== "card" && !(e.reference ?? "").trim()) {
      throw new Error("donor_fund_entries_offline_reference");
    }
    if (e.kind === "spend" && e.orderId === null) throw new Error("donor_fund_entries_spend_order");
    if (e.kind === "spend" && this.state.entries.some((x) => x.kind === "spend" && x.orderId === e.orderId)) {
      throw new Error("donor_fund_entries_one_spend_per_order");
    }
    if (e.kind === "adjustment" && e.orderId !== null && this.state.entries.some((x) => x.kind === "adjustment" && x.orderId === e.orderId)) {
      throw new Error("donor_fund_entries_one_adjustment_per_order");
    }
  }

  private tx(): FundTx {
    return {
      lockOrder: async (orderId) => {
        const o = this.order(orderId);
        return o ? { ...o } : null;
      },
      orderAttempts: async (orderId) =>
        this.state.orderAttempts.filter((p) => p.orderId === orderId).sort((a, b) => a.attempt - b.attempt).map((p) => ({ ...p })),
      lockFund: async (fundId) => {
        const f = this.state.funds.find((x) => x.id === fundId);
        return f ? { id: f.id, code: f.code, displayName: f.displayName, active: f.active, createdByStaffId: f.createdByStaffId, at: f.at } : null;
      },
      listEntries: async (fundId) =>
        this.entriesOf(fundId)
          .sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id))
          .map((e) => this.withPayments(e)),
      listMembers: async (fundId) => this.state.members.filter((m) => m.fundId === fundId).map((m) => m.customerId),
      listActiveFunds: async () =>
        this.state.funds
          .filter((f) => f.active)
          .sort((a, b) => a.at.getTime() - b.at.getTime())
          .map((f) => ({
            id: f.id, code: f.code, displayName: f.displayName, active: f.active, createdByStaffId: f.createdByStaffId, at: f.at,
            memberCount: this.state.members.filter((m) => m.fundId === f.id).length,
          })),
      linkedFundOf: async (customerId) => {
        const m = this.state.members.find((x) => x.customerId === customerId && this.state.funds.find((f) => f.id === x.fundId)?.active);
        return m?.fundId ?? null;
      },
      insertEntry: async (row: NewFundEntry) => {
        const e: StoredEntry = { ...structuredClone(row), id: `fe-${++this.seq}` };
        this.checkEntry(e);
        this.state.entries.push(e);
        if (e.kind === "top_up" && e.fundingMethod === "card" && e.clientUuid) {
          this.topups.state.orders.push({ id: e.id, state: "ordered", totalZar: e.amountZar, clientUuid: e.clientUuid });
        }
        return this.withPayments(e);
      },
      spendForOrder: async (orderId) => {
        const e = this.state.entries.find((x) => x.kind === "spend" && x.orderId === orderId);
        return e ? this.withPayments(e) : null;
      },
      adjustmentForOrder: async (orderId) => {
        const e = this.state.entries.find((x) => x.kind === "adjustment" && x.orderId === orderId);
        return e ? this.withPayments(e) : null;
      },
      setOrderFundSettled: async (orderId) => {
        const o = this.order(orderId);
        if (o) o.paymentMode = "donor_fund";
      },
      codeTaken: async (code) => this.state.funds.some((f) => f.code === code),
      insertFund: async (row: NewDonorFund) => {
        if (this.state.funds.some((f) => f.code === row.code)) throw new Error("donor_funds_code_unique");
        const f: StoredFund = { ...row, id: `fund-${++this.seq}`, active: true };
        this.state.funds.push(f);
        return { id: f.id, code: f.code, displayName: f.displayName, active: true, createdByStaffId: f.createdByStaffId, at: f.at };
      },
      customerExists: async (id) => this.state.customers.includes(id),
      insertMember: async (fundId, customerId, addedByStaffId, at) => {
        if (this.state.members.some((m) => m.fundId === fundId && m.customerId === customerId)) return "duplicate";
        const activeElsewhere = this.state.members.some(
          (m) => m.customerId === customerId && this.state.funds.find((f) => f.id === m.fundId)?.active
        );
        if (activeElsewhere) return "linked_elsewhere";
        this.state.members.push({ fundId, customerId, addedByStaffId, at });
        return "ok";
      },
      deleteMember: async (fundId, customerId) => {
        const before = this.state.members.length;
        this.state.members = this.state.members.filter((m) => !(m.fundId === fundId && m.customerId === customerId));
        return this.state.members.length < before;
      },
      topupTenderStore: () => this.topups,
      audit: async (row) => {
        this.state.audit.push(structuredClone(row));
      },
    };
  }
}
