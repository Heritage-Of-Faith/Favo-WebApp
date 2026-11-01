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
import {
  wasteQuantityError,
  WASTE_MAX_QTY,
  WASTE_REASON_MAX,
  NO_STOCK_TO_WASTE,
  isWasteableLotState,
  lotStateRefusalMessage,
} from "@/lib/pos/waste-validation";
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
  const [allLots, setAllLots] = useState<InventoryLot[]>([]);
  const [lots, setLots] = useState<InventoryLot[]>([]);
  const [lotId, setLotId] = useState<string>("");
  // Item whose lots are loaded; until then "no lots" is unknown, not empty.
  const [lotsLoadedFor, setLotsLoadedFor] = useState<string>("");
  const [category, setCategory] = useState<LogWasteInput["category"]>(defaultCategory);
  const [quantity, setQuantity] = useState<string>("1");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [qtyError, setQtyError] = useState<string | null>(null);

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
      setAllLots([]);
      setLots([]);
      setLotId("");
      return;
    }
    listLots(itemId).then((r) => {
      if (r.ok) {
        setLotsLoadedFor(itemId);
        setAllLots(r.data.lots);
        // Only lots logWaste accepts are offered (QA R4 barista P2-1); a lot
        // with nothing left (remaining <= 0) is refused too (QA R6 barista P3-1).
        const usable = r.data.lots.filter(
          (l) => isWasteableLotState(l.state) && l.quantityRemaining > 0
        );
        setLots(usable);
        const active = usable.find((l) => l.state === "active") ?? usable[0];
        setLotId(active?.id ?? "");
      }
    });
  }, [itemId]);

  // No lot can take waste: say why, and do not fall back to a lot-less waste row
  // (that would bypass the lot rule). An open container points to Close; no lots
  // or only closed/expired ones is simply "no stock" (QA R5 barista #2).
  const noWasteableLot = lotsLoadedFor === itemId && itemId !== "" && lots.length === 0;
  const blockedMessage = noWasteableLot
    ? allLots.some((l) => l.state === "open")
      ? lotStateRefusalMessage("open")
      : NO_STOCK_TO_WASTE
    : null;

  const handleSubmit = useCallback(async () => {
    const problem = wasteQuantityError(quantity);
    if (submitting || noWasteableLot) return;
    if (problem) { setQtyError(problem); return; }
    if (!itemId) { setQtyError("Choose the item that was wasted."); return; }
    setQtyError(null);
    const qty = Number(quantity.trim());
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
        toast.error(r.message ?? "Could not log waste.", { id: "waste-error" });
      }
    } catch {
      toast.error("Something went wrong logging waste.", { id: "waste-error" });
    } finally {
      setSubmitting(false);
    }
  }, [quantity, category, lotId, reason, onLogged, onClose, submitting, noWasteableLot, itemId]);

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
            className="flex h-11 w-11 items-center justify-center rounded-[4px] text-cool-steel hover:bg-porcelain/10 hover:text-porcelain"
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
                className="min-h-[44px] rounded-[4px] border border-cool-steel/30 bg-porcelain/10 px-3 text-porcelain text-base focus:border-crimson-carrot focus:outline-none"
              >
                {items.map((i) => (
                  <option key={i.id} value={i.id} className="bg-dark-teal">
                    {/* Unit shown so "Espresso Beans" (g) and "(bag)" (cup) can be told apart (QA B3). */}
                    {i.name} · {i.unit}
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
                    className="min-h-[44px] rounded-[4px] border border-cool-steel/30 bg-porcelain/10 px-3 text-porcelain text-base focus:border-crimson-carrot focus:outline-none"
                  >
                    {lots.map((l) => (
                      <option key={l.id} value={l.id} className="bg-dark-teal">
                        {(l.batchNumber ?? l.id.slice(-6).toUpperCase())} · {l.state} · {l.quantityRemaining} left
                      </option>
                    ))}
                  </select>
                </>
              )}
              {blockedMessage && (
                <p className="favo-small text-porcelain" role="note">{blockedMessage}</p>
              )}

              {/* Category */}
              <label className="favo-label text-cool-steel" htmlFor="waste-category">Category</label>
              <select
                id="waste-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as LogWasteInput["category"])}
                className="min-h-[44px] rounded-[4px] border border-cool-steel/30 bg-porcelain/10 px-3 text-porcelain text-base focus:border-crimson-carrot focus:outline-none"
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
                max={WASTE_MAX_QTY}
                step={1}
                value={quantity}
                onChange={(e) => { setQuantity(e.target.value); setQtyError(null); }}
                aria-invalid={qtyError ? true : undefined}
                className="min-h-[44px] rounded-[4px] border border-cool-steel/30 bg-porcelain/10 px-3 text-porcelain text-base focus:border-crimson-carrot focus:outline-none"
              />
              {qtyError && <p className="favo-small text-[var(--color-error)]" role="alert">{qtyError}</p>}

              {/* Reason */}
              <label className="favo-label text-cool-steel" htmlFor="waste-reason">Reason (optional)</label>
              <input
                id="waste-reason"
                type="text"
                value={reason}
                maxLength={WASTE_REASON_MAX}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. knocked over on the bar"
                className="min-h-[44px] rounded-[4px] border border-cool-steel/30 bg-porcelain/10 px-3 text-porcelain placeholder:text-cool-steel text-base focus:border-crimson-carrot focus:outline-none"
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
            disabled={submitting || itemsLoading || noWasteableLot}
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
