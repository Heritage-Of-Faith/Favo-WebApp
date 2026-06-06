"use client";

// WasteLogModal — M8: quick waste log from POS.
// Lets any barista+ log a waste event without leaving the workspace.
// Uses CSS vars throughout — no hardcoded hex. Touch targets ≥ 44 × 44 px.
// Docs: docs/API.md §logWaste · docs/BUSINESS_RULES.md L08

import { useState } from "react";
import { X, Loader2, AlertCircle, CheckCircle, Trash2 } from "lucide-react";
import { logWaste } from "@/server/actions/waste";
import type { LogWasteInput } from "@/server/actions/waste";

export type Props = {
  onClose: () => void;
  onLogged: () => void;
};

type Category = LogWasteInput["category"];

const CATEGORY_OPTIONS: { value: Category; label: string }[] = [
  { value: "expired",       label: "Expired"        },
  { value: "damaged",       label: "Damaged"         },
  { value: "spilled",       label: "Spilled"         },
  { value: "overproduction", label: "Overproduction" },
  { value: "other",         label: "Other"           },
];

export default function WasteLogModal({ onClose, onLogged }: Props) {
  const [category, setCategory]   = useState<Category>("expired");
  const [quantity, setQuantity]   = useState("1");
  const [reason, setReason]       = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [success, setSuccess]     = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const qty = parseInt(quantity, 10);
    if (!Number.isInteger(qty) || qty < 1) {
      setError("Quantity must be a whole number ≥ 1.");
      return;
    }
    setSubmitting(true);
    setError(null);

    const r = await logWaste({
      category,
      quantity: qty,
      reason: reason.trim() || undefined,
    }).catch(() => ({
      ok: false as const,
      code: "ERR",
      message: "Network error — could not log waste.",
    }));

    setSubmitting(false);

    if (r.ok) {
      setSuccess(true);
      setTimeout(() => { onLogged(); onClose(); }, 1200);
    } else {
      setError(r.message);
    }
  }

  return (
    // Backdrop — click outside to dismiss
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(28, 5, 1, 0.5)" }}
      onClick={(e) => e.target === e.currentTarget && !submitting && onClose()}
    >
      {/* Modal panel */}
      <div
        className="w-full max-w-[340px] rounded-[4px] border border-cool-steel/20"
        style={{ background: "var(--color-porcelain)" }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="waste-modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-cool-steel/20 px-4 py-3">
          <div className="flex items-center gap-2">
            <Trash2 size={16} strokeWidth={2} className="text-cool-steel" aria-hidden />
            <h2 id="waste-modal-title" className="favo-h3 text-coffee-bean">Log Waste</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting || success}
            aria-label="Close"
            className="flex h-[44px] w-[44px] items-center justify-center rounded-[4px] text-cool-steel transition-colors hover:bg-coffee-bean/8 hover:text-coffee-bean disabled:opacity-40"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4 px-4 py-4">
          {/* Category */}
          <div className="space-y-1.5">
            <label htmlFor="waste-category" className="favo-label text-cool-steel block">
              Category
            </label>
            <select
              id="waste-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
              disabled={submitting || success}
              className="w-full min-h-[44px] rounded-[4px] border border-cool-steel/25 px-3 py-2 favo-small text-coffee-bean focus:border-crimson-carrot focus:outline-none disabled:opacity-50"
              style={{ background: "var(--color-surface)" }}
            >
              {CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Quantity */}
          <div className="space-y-1.5">
            <label htmlFor="waste-quantity" className="favo-label text-cool-steel block">
              Quantity
            </label>
            <input
              id="waste-quantity"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              disabled={submitting || success}
              required
              className="w-full min-h-[44px] rounded-[4px] border border-cool-steel/25 px-3 py-2 favo-small text-coffee-bean focus:border-crimson-carrot focus:outline-none disabled:opacity-50"
              style={{ background: "var(--color-surface)" }}
            />
          </div>

          {/* Reason (optional) */}
          <div className="space-y-1.5">
            <label htmlFor="waste-reason" className="favo-label text-cool-steel block">
              Reason <span className="text-cool-steel/60 normal-case">(optional)</span>
            </label>
            <input
              id="waste-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={submitting || success}
              placeholder="e.g. milk expired overnight"
              className="w-full min-h-[44px] rounded-[4px] border border-cool-steel/25 px-3 py-2 favo-small text-coffee-bean placeholder:text-cool-steel/50 focus:border-crimson-carrot focus:outline-none disabled:opacity-50"
              style={{ background: "var(--color-surface)" }}
            />
          </div>

          {/* Error */}
          {error && (
            <div
              className="flex items-center gap-2 rounded-[2px] px-3 py-2"
              style={{ background: "color-mix(in srgb, var(--color-error, #dc2626) 10%, transparent)", color: "var(--color-error, #dc2626)" }}
              role="alert"
            >
              <AlertCircle size={14} strokeWidth={2} className="shrink-0" aria-hidden />
              <span className="favo-small">{error}</span>
            </div>
          )}

          {/* Success */}
          {success && (
            <div
              className="flex items-center gap-2 rounded-[2px] px-3 py-2"
              style={{ background: "color-mix(in srgb, var(--color-success, #16a34a) 10%, transparent)", color: "var(--color-success, #16a34a)" }}
              role="status"
            >
              <CheckCircle size={14} strokeWidth={2} className="shrink-0" aria-hidden />
              <span className="favo-small font-semibold">Waste logged</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting || success}
              className="flex-1 min-h-[44px] rounded-[4px] border border-cool-steel/30 py-2 favo-small text-cool-steel transition-colors hover:bg-coffee-bean/8 disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || success}
              className="flex flex-1 min-h-[44px] items-center justify-center gap-2 rounded-[4px] py-2 transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-40"
              style={{
                background: "var(--color-crimson-carrot)",
                color: "var(--color-porcelain)",
                fontFamily: "var(--font-sans)",
                fontWeight: 700,
                fontSize: "var(--text-small)",
                letterSpacing: "var(--tracking-cta)",
                textTransform: "uppercase",
              }}
            >
              {submitting
                ? <Loader2 size={14} strokeWidth={2} className="animate-spin" aria-hidden />
                : "Log Waste"
              }
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
