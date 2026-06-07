"use client";

// Active order detail + Done button — owner: Mine (M6)
// Rule L15: Done (→ collected) must be the most visually dominant action on screen.
// Transitions: ordered → in_progress → ready → collected.
// Staff discount: Cappuccino + weekday only, once per day per staff member.
// Docs: docs/API.md → transitionOrder, applyStaffDiscount, cancelOrder

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, X, Tag, Loader2, AlertCircle, ChevronRight } from "lucide-react";
import { transitionOrder, cancelOrder, applyStaffDiscount } from "@/server/actions/orders";
import { formatZar, formatDate } from "@/lib/format";
import type { Order, OrderState } from "@/lib/types";

export type Props = { order: Order };

type ActionState = "idle" | "loading" | "error";

const STATE_NEXT: Partial<Record<OrderState, OrderState>> = {
  ordered:     "in_progress",
  in_progress: "ready",
  ready:       "collected",
};

const ADVANCE_LABEL: Partial<Record<OrderState, string>> = {
  ordered:     "Start making",
  in_progress: "Mark ready",
  ready:       "Done — collected",
};

export default function ActiveOrder({ order }: Props) {
  const router = useRouter();
  const [currentOrder, setCurrentOrder] = useState<Order>(order);
  const [actionState, setActionState] = useState<ActionState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showDiscount, setShowDiscount] = useState(false);
  const [discountStaffId, setDiscountStaffId] = useState("");
  const [discountMsg, setDiscountMsg] = useState<string | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState(false);

  const nextState = STATE_NEXT[currentOrder.state];
  const isDone = currentOrder.state === "collected" || currentOrder.state === "cancelled";

  const handleAdvance = useCallback(async () => {
    if (!nextState || actionState === "loading") return;
    setActionState("loading");
    setErrorMsg(null);
    try {
      const result = await transitionOrder(currentOrder.id, nextState);
      if (result.ok) {
        setCurrentOrder(result.data);
        if (result.data.state === "collected") {
          // Short delay so barista sees the success state, then back to queue
          setTimeout(() => router.push("/pos/queue"), 800);
        }
      } else {
        setErrorMsg(result.message);
        setActionState("error");
        return;
      }
    } catch {
      setErrorMsg("Action failed. Please try again.");
      setActionState("error");
      return;
    }
    setActionState("idle");
  }, [nextState, actionState, currentOrder.id, router]);

  const handleCancel = useCallback(async () => {
    if (actionState === "loading") return;
    setActionState("loading");
    setErrorMsg(null);
    try {
      const result = await cancelOrder(currentOrder.id, "Cancelled at POS");
      if (result.ok) {
        router.push("/pos/queue");
      } else {
        setErrorMsg(result.message);
        setActionState("error");
      }
    } catch {
      setErrorMsg("Could not cancel. Please try again.");
      setActionState("error");
    }
    setActionState("idle");
  }, [actionState, currentOrder.id, router]);

  const handleStaffDiscount = useCallback(async () => {
    if (!discountStaffId.trim()) {
      setDiscountMsg("Enter the staff member's ID.");
      return;
    }
    setDiscountMsg(null);
    try {
      const result = await applyStaffDiscount(currentOrder.id, discountStaffId.trim());
      if (result.ok) {
        setDiscountMsg("✓ Staff discount applied — order is now free.");
        setCurrentOrder((o) => ({ ...o, totalZar: 0, isStaffDiscount: true }));
        setShowDiscount(false);
      } else {
        setDiscountMsg(result.message);
      }
    } catch {
      setDiscountMsg("Could not apply discount. Please try again.");
    }
  }, [discountStaffId, currentOrder.id]);

  return (
    <div className="flex h-full flex-col gap-[var(--spacing-m)]">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <p className="favo-label text-cool-steel">Order</p>
          <h1 className="favo-h3 text-porcelain">
            #{currentOrder.id.slice(-6).toUpperCase()}
          </h1>
        </div>
        <StateBadge state={currentOrder.state} />
      </div>

      {currentOrder.customerName && (
        <p className="favo-small text-cool-steel">
          Customer: <span className="text-porcelain">{currentOrder.customerName}</span>
        </p>
      )}
      <p className="favo-small text-cool-steel">
        Placed: <span className="text-porcelain">{formatDate(new Date(currentOrder.placedAt))}</span>
      </p>

      {/* ── Order items ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto rounded-[var(--radius-card)] border border-cool-steel/20 bg-porcelain/5">
        <ul className="divide-y divide-cool-steel/10">
          {currentOrder.items.map((item) => (
            <li key={item.id} className="flex justify-between px-[var(--spacing-m)] py-[var(--spacing-s)]">
              <div>
                <p className="favo-subhead text-porcelain leading-snug">
                  {item.quantity > 1 && (
                    <span className="text-crimson-carrot mr-[var(--spacing-xs)]">{item.quantity}×</span>
                  )}
                  {item.menuItemName || `Item #${item.id.slice(-4)}`}
                </p>
                {item.modifications.length > 0 && (
                  <p className="favo-small text-cool-steel">
                    {item.modifications.map((m) => m.name).join(", ")}
                  </p>
                )}
              </div>
              <span className="favo-small text-porcelain shrink-0 ml-[var(--spacing-m)]">
                {formatZar(
                  (item.unitPriceZar +
                    item.modifications.reduce((s, m) => s + m.priceDeltaZar, 0)) *
                    item.quantity
                )}
              </span>
            </li>
          ))}
        </ul>
        {/* Total */}
        <div className="flex justify-between px-[var(--spacing-m)] py-[var(--spacing-s)] border-t border-cool-steel/20">
          <span className="favo-label text-cool-steel">Total</span>
          <span className={["favo-subhead", currentOrder.isStaffDiscount ? "text-[var(--color-success)] line-through" : "text-porcelain"].join(" ")}>
            {currentOrder.isStaffDiscount ? "FREE (staff)" : formatZar(currentOrder.totalZar)}
          </span>
        </div>
      </div>

      {/* ── Error ──────────────────────────────────────────────────────────── */}
      {errorMsg && (
        <div className="flex items-center gap-[var(--spacing-s)] text-[var(--color-error)]" role="alert">
          <AlertCircle size={14} strokeWidth={2.25} />
          <span className="favo-small">{errorMsg}</span>
        </div>
      )}

      {/* ── Staff discount panel ────────────────────────────────────────────── */}
      {!isDone && !currentOrder.isStaffDiscount && (
        <div>
          {!showDiscount ? (
            <button
              type="button"
              onClick={() => setShowDiscount(true)}
              className="flex items-center gap-[var(--spacing-s)] text-cool-steel hover:text-porcelain min-h-[44px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot"
            >
              <Tag size={14} strokeWidth={2.25} />
              <span className="favo-small">Apply staff discount</span>
            </button>
          ) : (
            <div className="flex flex-col gap-[var(--spacing-s)] rounded-[var(--radius-card)] border border-cool-steel/20 bg-porcelain/5 p-[var(--spacing-m)]">
              <label htmlFor="staff-id" className="favo-label text-cool-steel">
                Staff member ID
              </label>
              <input
                id="staff-id"
                type="text"
                value={discountStaffId}
                onChange={(e) => setDiscountStaffId(e.target.value)}
                placeholder="e.g. staff_barista_sam"
                className="rounded-[var(--radius-btn)] border border-cool-steel/30 bg-porcelain/10 px-[var(--spacing-m)] py-[var(--spacing-s)] text-porcelain placeholder:text-cool-steel favo-small min-h-[44px] focus:border-crimson-carrot focus:outline-none"
              />
              {discountMsg && (
                <p className={["favo-small", discountMsg.startsWith("✓") ? "text-[var(--color-success)]" : "text-[var(--color-error)]"].join(" ")} role="status">
                  {discountMsg}
                </p>
              )}
              <div className="flex gap-[var(--spacing-s)]">
                <button type="button" onClick={handleStaffDiscount}
                  className="favo-cta flex-1 rounded-[var(--radius-btn)] bg-crimson-carrot px-[var(--spacing-m)] py-[var(--spacing-s)] min-h-[44px] text-porcelain hover:bg-coffee-bean-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-porcelain">
                  Apply
                </button>
                <button type="button" onClick={() => { setShowDiscount(false); setDiscountMsg(null); }}
                  className="rounded-[var(--radius-btn)] border border-cool-steel/30 px-[var(--spacing-m)] py-[var(--spacing-s)] min-h-[44px] text-cool-steel hover:bg-porcelain/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot">
                  <X size={14} strokeWidth={2.25} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Cancel (only while ordered) ─────────────────────────────────────── */}
      {currentOrder.state === "ordered" && !cancelConfirm && (
        <button type="button" onClick={() => setCancelConfirm(true)}
          className="favo-small text-cool-steel underline underline-offset-2 hover:text-[var(--color-error)] min-h-[44px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot">
          Cancel order
        </button>
      )}
      {currentOrder.state === "ordered" && cancelConfirm && (
        <div className="flex gap-[var(--spacing-s)] items-center">
          <span className="favo-small text-[var(--color-error)]">Are you sure?</span>
          <button type="button" onClick={handleCancel}
            className="favo-small rounded-[var(--radius-btn)] border border-[var(--color-error)]/50 px-[var(--spacing-m)] py-[var(--spacing-xs)] min-h-[44px] text-[var(--color-error)] hover:bg-[var(--color-error)]/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot">
            Yes, cancel
          </button>
          <button type="button" onClick={() => setCancelConfirm(false)}
            className="favo-small text-cool-steel hover:text-porcelain min-h-[44px] px-[var(--spacing-m)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot">
            Keep
          </button>
        </div>
      )}

      {/* ── DONE — primary action (rule L15: most visually dominant) ───────── */}
      {!isDone && nextState && (
        <button
          type="button"
          onClick={handleAdvance}
          disabled={actionState === "loading"}
          aria-label={ADVANCE_LABEL[currentOrder.state]}
          className={[
            "flex w-full items-center justify-center gap-[var(--spacing-s)]",
            "rounded-[var(--radius-btn)] min-h-[64px]",
            currentOrder.state === "ready"
              ? "bg-[var(--color-success)] text-porcelain text-2xl font-bold"
              : "bg-crimson-carrot text-porcelain",
            "favo-cta transition-all duration-[var(--dur-fast)]",
            "hover:brightness-110 active:scale-[0.99]",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-porcelain",
            "disabled:opacity-40 disabled:cursor-not-allowed",
            actionState === "loading" ? "animate-pulse" : "",
          ].join(" ")}
        >
          {actionState === "loading" ? (
            <Loader2 size={20} strokeWidth={2.25} className="animate-spin" />
          ) : currentOrder.state === "ready" ? (
            <>
              <CheckCircle size={24} strokeWidth={2.25} />
              DONE — Collected
            </>
          ) : (
            <>
              {ADVANCE_LABEL[currentOrder.state]}
              <ChevronRight size={16} strokeWidth={2.25} />
            </>
          )}
        </button>
      )}

      {/* ── Completed state ─────────────────────────────────────────────────── */}
      {isDone && (
        <div className="flex flex-col items-center gap-[var(--spacing-m)] py-[var(--spacing-m)]" role="status">
          <CheckCircle size={40} strokeWidth={2} className="text-[var(--color-success)]" />
          <p className="favo-subhead text-porcelain">
            {currentOrder.state === "collected" ? "Order collected ✓" : "Order cancelled"}
          </p>
        </div>
      )}
    </div>
  );
}

// ── StateBadge ────────────────────────────────────────────────────────────────
const STATE_BADGE: Record<OrderState, { label: string; cls: string }> = {
  ordered:     { label: "Waiting",     cls: "bg-porcelain/10 text-cool-steel" },
  in_progress: { label: "In Progress", cls: "bg-[var(--color-warning)]/20 text-[var(--color-warning)]" },
  ready:       { label: "Ready",       cls: "bg-[var(--color-success)]/20 text-[var(--color-success)]" },
  collected:   { label: "Collected",   cls: "bg-[var(--color-success)]/10 text-cool-steel" },
  cancelled:   { label: "Cancelled",   cls: "bg-[var(--color-error)]/10 text-[var(--color-error)]" },
};

function StateBadge({ state }: { state: OrderState }) {
  const { label, cls } = STATE_BADGE[state];
  return (
    <span className={`favo-caption rounded-[var(--radius-pill)] px-[var(--spacing-s)] py-px ${cls}`}>
      {label}
    </span>
  );
}
