"use client";

// Record-purchase dialog — task A10 (L10).
// Source + kind (planned/emergency) + repeatable lot lines.
//
// Two line shapes, per item unit:
//   - Container items (unit='cup': milk & beans) — real-world size bought
//     (e.g. 1L, 1kg) + what was paid. No cup yield is predicted or entered;
//     actual cups made are only ever counted as they're used on the POS.
//   - Everything else — quantity + total paid; unit cost is derived so money
//     stays as integer cents end to end.
//
// L10: an emergency purchase by a non-admin is accepted but held
// pending_admin_approval — the UI reflects this on submit.

import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AlertTile from "@/components/shared/dashboard/AlertTile";
import { recordPurchase } from "@/server/actions/purchases";
import { parseZar } from "@/lib/format";
import type { InventoryUnit, PurchaseKind, PurchaseLotItem } from "@/lib/types";
// (PurchaseLotItem is the shared lot-line shape consumed by recordPurchase.)

export interface PurchaseItemOption {
  id: string;
  name: string;
  unit: string;
  /** Used to pick a sensible default size unit for container items (milk → l, bean → kg). */
  kind?: string;
}

export interface PurchaseFormProps {
  items: PurchaseItemOption[];
  /** admin/owner can self-approve emergency purchases inline. */
  canApprove: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const SIZE_UNITS: InventoryUnit[] = ["l", "kg", "ml", "g"];

function defaultSizeUnit(kind: string | undefined): InventoryUnit {
  if (kind === "milk") return "l";
  if (kind === "bean") return "kg";
  return "l";
}

type LineDraft = {
  inventoryItemId: string;
  /** Container items: real size bought (e.g. "1", "2"). Others: quantity. */
  quantity: string;
  sizeUnit: InventoryUnit;
  total: string;
};

const emptyLine = (firstItem: PurchaseItemOption | undefined): LineDraft => ({
  inventoryItemId: firstItem?.id ?? "",
  quantity: "",
  sizeUnit: defaultSizeUnit(firstItem?.kind),
  total: "",
});

export default function PurchaseForm({ items, canApprove, onClose, onSaved }: PurchaseFormProps) {
  const [sourceName, setSourceName] = useState("");
  const [kind, setKind] = useState<PurchaseKind>("planned");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine(items[0])]);
  const [submitting, setSubmitting] = useState(false);

  function updateLine(i: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, emptyLine(items[0])]);
  }
  function removeLine(i: number) {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sourceName.trim()) {
      toast.error("Enter a source name.");
      return;
    }

    const built: PurchaseLotItem[] = [];
    for (const [i, line] of lines.entries()) {
      const qty = Number(line.quantity);
      const cents = parseZar(line.total);
      if (!line.inventoryItemId) {
        toast.error(`Line ${i + 1}: choose an item.`);
        return;
      }
      if (!Number.isFinite(qty) || qty <= 0) {
        toast.error(`Line ${i + 1}: size/quantity must be greater than 0.`);
        return;
      }
      if (cents === null || cents <= 0) {
        toast.error(`Line ${i + 1}: enter a valid total paid.`);
        return;
      }

      const isContainerItem = items.find((it) => it.id === line.inventoryItemId)?.unit === "cup";
      if (isContainerItem) {
        // Real size + cost paid — no cup yield predicted or entered.
        built.push({
          inventoryItemId: line.inventoryItemId,
          containerSize: qty,
          containerSizeUnit: line.sizeUnit,
          totalZar: cents,
        });
      } else {
        // Derive unit cost (cents per base unit) so total + unit cost agree.
        built.push({
          inventoryItemId: line.inventoryItemId,
          quantity: qty,
          unitCostZar: (cents / qty).toFixed(4),
          totalZar: cents,
        });
      }
    }

    setSubmitting(true);
    try {
      const res = await recordPurchase({ sourceName: sourceName.trim(), kind, items: built });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      if (kind === "emergency" && !canApprove) {
        toast.success("Submitted — pending admin approval.");
      } else {
        toast.success("Purchase recorded.");
      }
      onSaved();
      onClose();
    } catch {
      toast.error("Failed to record purchase. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Record purchase</DialogTitle>
            <DialogDescription>
              Each line creates a new inventory lot. Enter what you paid and how much you received.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="po-source">Source</Label>
              <Input
                id="po-source"
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
                placeholder="e.g. Bean There Coffee Co."
                autoComplete="off"
              />
            </div>

            <div className="grid gap-2">
              <Label>Kind</Label>
              <div className="flex gap-2">
                {(["planned", "emergency"] as PurchaseKind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    aria-pressed={kind === k}
                    className="min-h-10 flex-1 rounded-[var(--radius-btn)] border px-3 favo-small capitalize transition-colors"
                    style={{
                      background: kind === k ? "var(--color-text-strong)" : "var(--color-surface)",
                      color: kind === k ? "var(--color-text-inverse)" : "var(--color-text-strong)",
                      borderColor: "var(--color-border-subtle)",
                    }}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>

            {kind === "emergency" && (
              <AlertTile
                severity="warning"
                title="Emergency purchases require admin approval"
                description={
                  canApprove
                    ? "As an admin, this will be approved and stocked immediately."
                    : "This will be held pending admin approval before the stock is usable."
                }
              />
            )}

            {/* Lot lines */}
            <div className="grid gap-2">
              <Label>Lots received</Label>
              <div className="space-y-2">
                {lines.map((line, i) => {
                  const selectedItem = items.find((it) => it.id === line.inventoryItemId);
                  const isContainerItem = selectedItem?.unit === "cup";
                  const unit = selectedItem?.unit ?? "";
                  return (
                    <div key={i} className="flex items-end gap-2">
                      <div className="flex-1">
                        <select
                          aria-label={`Line ${i + 1} item`}
                          value={line.inventoryItemId}
                          onChange={(e) => {
                            const next = items.find((it) => it.id === e.target.value);
                            updateLine(i, {
                              inventoryItemId: e.target.value,
                              sizeUnit: defaultSizeUnit(next?.kind),
                            });
                          }}
                          className="h-10 w-full rounded-[var(--radius-btn)] border px-2 favo-small"
                          style={{ background: "var(--color-surface)", color: "var(--color-text-strong)", borderColor: "var(--color-border-subtle)" }}
                        >
                          {items.map((it) => (
                            <option key={it.id} value={it.id}>
                              {it.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="w-20">
                        <Input
                          aria-label={isContainerItem ? `Line ${i + 1} size` : `Line ${i + 1} quantity (${unit})`}
                          value={line.quantity}
                          onChange={(e) => updateLine(i, { quantity: e.target.value })}
                          inputMode="decimal"
                          placeholder={isContainerItem ? "size" : `qty ${unit}`}
                        />
                      </div>
                      {isContainerItem && (
                        <div className="w-20">
                          <select
                            aria-label={`Line ${i + 1} size unit`}
                            value={line.sizeUnit}
                            onChange={(e) => updateLine(i, { sizeUnit: e.target.value as InventoryUnit })}
                            className="h-10 w-full rounded-[var(--radius-btn)] border px-2 favo-small bg-[color:var(--color-surface)] transition-colors hover:bg-[color:var(--color-porcelain-soft)]"
                            style={{ color: "var(--color-text-strong)", borderColor: "var(--color-border-subtle)" }}
                          >
                            {SIZE_UNITS.map((u) => (
                              <option key={u} value={u}>{u}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div className="w-28">
                        <Input
                          aria-label={`Line ${i + 1} total paid (R)`}
                          value={line.total}
                          onChange={(e) => updateLine(i, { total: e.target.value })}
                          inputMode="decimal"
                          placeholder="R total"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeLine(i)}
                        disabled={lines.length === 1}
                        aria-label={`Remove line ${i + 1}`}
                        className="flex h-10 w-9 items-center justify-center rounded-[var(--radius-btn)] disabled:opacity-30"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={addLine}
                className="self-start min-h-10 favo-small underline"
                style={{ color: "var(--color-accent)" }}
              >
                + Add lot line
              </button>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} className="min-h-10">
              {submitting ? "Saving…" : "Record purchase"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
