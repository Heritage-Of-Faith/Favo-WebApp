"use client";

/**
 * WasteDialog — task M8.
 *
 * Modal for logging a waste event from the POS. Three entry points feed it:
 *   1. the active-order kebab (preselect via `preselectItemId`)
 *   2. the queue card kebab
 *   3. the standalone /pos/waste route
 *
 * Flow: pick an inventory item → its active lot auto-selects → choose a
 * category, enter quantity, optional reason → calls `logWaste`.
 * Surfaces success/failure via Sonner toast.
 */

import { useState, useEffect, useCallback } from "react";
import { X, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { listInventory } from "@/server/actions/inventory";
import { listLots } from "@/server/actions/inventory";
import { logWaste, type LogWasteInput } from "@/server/actions/waste";
import type { InventoryItemStatus, InventoryLot } from "@/lib/types";

const CATEGORIES: { value: LogWasteInput["category"]; label: string }[] = [
  { value: "spilled", label: "Spilled" },
  { value: "damaged", label: "Damaged / dropped" },
  { value: "expired", label: "Expired" },
  { value: "overproduction", label: "Over-production / remake" },
  { value: "other", label: "Other" },
];

export type Props = {
  /** Pre-select this inventory item when the dialog opens (e.g. from an order). */
  preselectItemId?: string;
  /** Default category (e.g. remake/wrong-order flows pass overproduction). */
  defaultCategory?: LogWasteInput["category"];
  /** Called after a successful log (and on close). */
  onClose: () => void;
  /** Called only after a successful waste log. */
  onLogged?: () => void;
};

export default function WasteDialog({
  preselectItemId,
  defaultCategory = "spilled",
  onClose,
  onLogged,
}: Props) {
  const [items, setItems] = useState<InventoryItemStatus[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [itemId, setItemId] = useState<string>(preselectItemId ?? "");
  const [lots, setLots] = useState<InventoryLot[]>([]);
  const [lotId, setLotId] = useState<string>("");
  const [category, setCategory] = useState<LogWasteInput["category"]>(defaultCategory);
  const [quantity, setQuantity] = useState<string>("1");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const selectedItem = items.find((i) => i.id === itemId);

  // Load inventory items on mount
  useEffect(() => {
    listInventory()
      .then((r) => {
        if (r.ok) {
          setItems(r.data.items);
          if (!preselectItemId && r.data.items.length > 0) {
            setItemId(r.data.items[0].id);
          }
        }
      })
      .finally(() => setItemsLoading(false));
  }, [preselectItemId]);

  // Load lots whenever the selected item changes; auto-select active lot
  useEffect(() => {
    if (!itemId) {
      setLots([]);
      setLotId("");
      return;
    }
    listLots(itemId).then((r) => {
      if (r.ok) {
        setLots(r.data.lots);
        const active = r.data.lots.find((l) => l.state === "active") ?? r.data.lots[0];
        setLotId(active?.id ?? "");
      }
    });
  }, [itemId]);

  const handleSubmit = useCallback(async () => {
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      toast.warning("Quantity must be a whole number greater than 0.");
      return;
    }
    setSubmitting(true);
    try {
      const r = await logWaste({
        category,
        inventoryLotId: lotId || undefined,
        quantity: qty,
        reason: reason.trim() || undefined,
      });
      if (r.ok) {
        toast.success("Waste logged.");
        onLogged?.();
        onClose();
      } else {
        toast.error(r.message ?? "Could not log waste.");
      }
    } catch {
      toast.error("Something went wrong logging waste.");
    } finally {
      setSubmitting(false);
    }
  }, [quantity, category, lotId, reason, onLogged, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-coffee-bean/60 px-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Report waste"
    >
      <div className="w-full max-w-[420px] rounded-[2px] border border-cool-steel/20 bg-dark-teal shadow-[var(--shadow-2)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-cool-steel/20 px-5 py-3">
          <div className="flex items-center gap-2">
            <Trash2 size={16} strokeWidth={2} className="text-cool-steel" />
            <h2 className="favo-h3 text-porcelain">Report Waste</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-[4px] text-cool-steel hover:bg-porcelain/10 hover:text-porcelain"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        <div className="flex flex-col gap-3 px-5 py-4">
          {itemsLoading ? (
            <div className="flex items-center gap-2 py-6 text-cool-steel">
              <Loader2 size={16} strokeWidth={2} className="animate-spin" />
              <span className="favo-small">Loading inventory…</span>
            </div>
          ) : (
            <>
              {/* Item */}
              <label className="favo-label text-cool-steel" htmlFor="waste-item">Item</label>
              <select
                id="waste-item"
                value={itemId}
                onChange={(e) => setItemId(e.target.value)}
                className="min-h-[44px] rounded-[4px] border border-cool-steel/30 bg-porcelain/10 px-3 text-porcelain favo-small focus:border-crimson-carrot focus:outline-none"
              >
                {items.map((i) => (
                  <option key={i.id} value={i.id} className="bg-dark-teal">
                    {i.name}
                  </option>
                ))}
              </select>

              {/* Lot */}
              {lots.length > 0 && (
                <>
                  <label className="favo-label text-cool-steel" htmlFor="waste-lot">Lot</label>
                  <select
                    id="waste-lot"
                    value={lotId}
                    onChange={(e) => setLotId(e.target.value)}
                    className="min-h-[44px] rounded-[4px] border border-cool-steel/30 bg-porcelain/10 px-3 text-porcelain favo-small focus:border-crimson-carrot focus:outline-none"
                  >
                    {lots.map((l) => (
                      <option key={l.id} value={l.id} className="bg-dark-teal">
                        {(l.batchNumber ?? l.id.slice(-6).toUpperCase())} · {l.state} · {l.quantityRemaining} left
                      </option>
                    ))}
                  </select>
                </>
              )}

              {/* Category */}
              <label className="favo-label text-cool-steel" htmlFor="waste-category">Category</label>
              <select
                id="waste-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as LogWasteInput["category"])}
                className="min-h-[44px] rounded-[4px] border border-cool-steel/30 bg-porcelain/10 px-3 text-porcelain favo-small focus:border-crimson-carrot focus:outline-none"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value} className="bg-dark-teal">
                    {c.label}
                  </option>
                ))}
              </select>

              {/* Quantity */}
              <label className="favo-label text-cool-steel" htmlFor="waste-qty">
                Quantity{selectedItem ? ` (${selectedItem.unit})` : ""}
              </label>
              <input
                id="waste-qty"
                type="number"
                min={1}
                step={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="min-h-[44px] rounded-[4px] border border-cool-steel/30 bg-porcelain/10 px-3 text-porcelain favo-small focus:border-crimson-carrot focus:outline-none"
              />

              {/* Reason */}
              <label className="favo-label text-cool-steel" htmlFor="waste-reason">Reason (optional)</label>
              <input
                id="waste-reason"
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. knocked over on the bar"
                className="min-h-[44px] rounded-[4px] border border-cool-steel/30 bg-porcelain/10 px-3 text-porcelain placeholder:text-cool-steel favo-small focus:border-crimson-carrot focus:outline-none"
              />
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-cool-steel/20 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-[4px] border border-cool-steel/30 px-4 favo-small text-cool-steel hover:bg-porcelain/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || itemsLoading}
            className="flex min-h-[44px] items-center gap-2 rounded-[4px] bg-crimson-carrot px-5 transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-40"
            style={{
              color: "var(--color-porcelain)",
              fontFamily: "var(--font-sans)",
              fontWeight: 700,
              fontSize: "var(--text-small)",
              letterSpacing: "var(--tracking-cta)",
              textTransform: "uppercase",
            }}
          >
            {submitting ? <Loader2 size={14} strokeWidth={2} className="animate-spin" /> : "Log Waste"}
          </button>
        </div>
      </div>
    </div>
  );
}
