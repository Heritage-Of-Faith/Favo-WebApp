// AT-201 part 2a test helper: an in-memory TenderStore. It mirrors the
// constraints the tender chain leans on — payments.client_reference UNIQUE,
// UNIQUE(order_id, attempt), yoco_payment_id UNIQUE, and the partial unique
// index payments_one_successful_per_order — and a transaction that throws
// leaves nothing behind (state is restored), as Postgres would.

import type {
  LookupRead,
  PaymentPatch,
  PaymentStatus,
  TenderAudit,
  TenderOrder,
  TenderPayment,
  TenderStore,
  TenderTx,
} from "@/server/tender/types";

export type MemoryState = {
  orders: TenderOrder[];
  payments: TenderPayment[];
  audit: TenderAudit[];
  /** Every setPaymentStatus call, in order — the status-writer trail. */
  statusWrites: { id: string; status: PaymentStatus }[];
};

export class MemoryTenderStore implements TenderStore {
  state: MemoryState;
  private seq = 0;

  constructor(orders: TenderOrder[]) {
    this.state = { orders: orders.map((o) => ({ ...o })), payments: [], audit: [], statusWrites: [] };
  }

  order(id: string): TenderOrder | undefined {
    return this.state.orders.find((o) => o.id === id);
  }

  paymentsOf(orderId: string): TenderPayment[] {
    return this.state.payments.filter((p) => p.orderId === orderId).sort((a, b) => a.attempt - b.attempt);
  }

  // Transactions run one at a time, as the order-row FOR UPDATE that every
  // tender function takes first makes them for one order in Postgres.
  private queue: Promise<unknown> = Promise.resolve();

  async transaction<T>(fn: (tx: TenderTx) => Promise<T>): Promise<T> {
    const run = async () => {
      const saved = structuredClone(this.state);
      try {
        return await fn(this.tx());
      } catch (err) {
        this.state = saved;
        throw err;
      }
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  private check(next: TenderPayment[]) {
    const refs = new Set<string>();
    const attempts = new Set<string>();
    const yocoIds = new Set<string>();
    const successful = new Set<string>();
    for (const p of next) {
      if (refs.has(p.clientReference)) throw new Error("payments_client_reference_unique");
      refs.add(p.clientReference);
      const k = `${p.orderId}:${p.attempt}`;
      if (attempts.has(k)) throw new Error("payments_order_attempt_unique");
      attempts.add(k);
      if (p.yocoPaymentId !== null) {
        if (yocoIds.has(p.yocoPaymentId)) throw new Error("payments_yoco_payment_id_unique");
        yocoIds.add(p.yocoPaymentId);
      }
      if (p.status === "successful") {
        if (successful.has(p.orderId)) throw new Error("payments_one_successful_per_order");
        successful.add(p.orderId);
      }
      if (!Number.isInteger(p.amountZar)) throw new Error("amount_zar must be integer cents");
      if (p.chargedAmountZar !== null && !Number.isInteger(p.chargedAmountZar)) {
        throw new Error("charged_amount_zar must be integer cents");
      }
    }
  }

  private patch(id: string, patch: PaymentPatch & { status?: PaymentStatus }) {
    const next = this.state.payments.map((p) => (p.id === id ? { ...p, ...patch } : p));
    this.check(next);
    this.state.payments = next;
  }

  private tx(): TenderTx {
    return {
      lockOrder: async (orderId) => {
        const o = this.order(orderId);
        return o ? { ...o } : null;
      },
      listPayments: async (orderId) => this.paymentsOf(orderId).map((p) => ({ ...p })),
      lockPayment: async (orderId, attempt) => {
        const p = this.state.payments.find((x) => x.orderId === orderId && x.attempt === attempt);
        return p ? { ...p } : null;
      },
      insertPayment: async (row) => {
        const p: TenderPayment = {
          id: `pmt-${++this.seq}`,
          orderId: row.orderId,
          attempt: row.attempt,
          clientReference: row.clientReference,
          yocoPaymentId: null,
          webposDeviceId: row.webposDeviceId,
          amountZar: row.amountZar,
          chargedAmountZar: null,
          tipZar: 0,
          status: "pending",
          sentAt: null,
          lastCheckedAt: null,
          at: row.at,
        };
        const next = [...this.state.payments, p];
        this.check(next);
        this.state.payments = next;
        return { ...p };
      },
      updatePayment: async (id, patch) => {
        if ("status" in (patch as object)) throw new Error("updatePayment must not write status");
        this.patch(id, patch);
      },
      setPaymentStatus: async (id, status, patch = {}) => {
        this.patch(id, { ...patch, status });
        this.state.statusWrites.push({ id, status });
      },
      audit: async (row) => {
        this.state.audit.push(structuredClone(row));
      },
      lastLookupRead: async (paymentId) => {
        const rows = this.state.audit.filter(
          (a) => a.entityKind === "payment" && a.entityId === paymentId && a.action === "payment.lookup"
        );
        const last = rows[rows.length - 1];
        if (!last) return null;
        const after = last.after as { read: LookupRead; at: string };
        return { read: after.read, at: new Date(after.at) };
      },
    };
  }
}
