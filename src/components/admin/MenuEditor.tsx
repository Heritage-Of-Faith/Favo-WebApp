// Menu item price editor — owner: Mia (task A5)
// Price edits go through setMenuItemPrice (→ price_history row). View history per
// item. Money is integer cents; display via formatZar, dates via formatDate.
"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { formatZar, formatDate } from "@/lib/format";
import {
  getMenu,
  getMenuItemPriceHistory,
  setMenuItemPrice,
  type PriceHistoryRow,
} from "@/server/actions/menu";
import type { MenuItem } from "@/lib/types";

type DialogState =
  | { mode: "closed" }
  | { mode: "editPrice"; item: MenuItem }
  | { mode: "history"; item: MenuItem };

export default function MenuEditor() {
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<DialogState>({ mode: "closed" });

  const refresh = useCallback(async () => {
    const res = await getMenu();
    if (res.ok) setMenu(res.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loading) return <p className="text-sm text-text-muted">Loading…</p>;

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead>Category</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {menu.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="font-medium text-text-strong">
                {item.name}
              </TableCell>
              <TableCell className="capitalize">
                {item.category.replace("_", " ")}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatZar(item.currentPriceZar)}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-10"
                    onClick={() => setDialog({ mode: "editPrice", item })}
                  >
                    Edit price
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-10"
                    onClick={() => setDialog({ mode: "history", item })}
                  >
                    History
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {dialog.mode === "editPrice" && (
        <EditPriceDialog
          item={dialog.item}
          onClose={() => setDialog({ mode: "closed" })}
          onSaved={refresh}
        />
      )}
      {dialog.mode === "history" && (
        <HistoryDialog
          item={dialog.item}
          onClose={() => setDialog({ mode: "closed" })}
        />
      )}
    </>
  );
}

function EditPriceDialog({
  item,
  onClose,
  onSaved,
}: {
  item: MenuItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Edit in Rands for readability; convert to integer cents on submit.
  const [rands, setRands] = useState((item.currentPriceZar / 100).toFixed(2));
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cents = Math.round(parseFloat(rands) * 100);
    if (Number.isNaN(cents)) {
      toast.error("Enter a valid amount.");
      return;
    }
    setSubmitting(true);
    const res = await setMenuItemPrice({ menuItemId: item.id, newPriceZar: cents });
    setSubmitting(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success(`${item.name} price updated to ${formatZar(cents)}.`);
    onSaved();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit price — {item.name}</DialogTitle>
            <DialogDescription>
              Current price {formatZar(item.currentPriceZar)}. Setting a new price
              records a price-history entry.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2 py-4">
            <Label htmlFor="price">New price (Rands)</Label>
            <Input
              id="price"
              inputMode="decimal"
              value={rands}
              onChange={(e) => setRands(e.target.value)}
              placeholder="e.g. 38.00"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} className="min-h-10">
              {submitting ? "Saving…" : "Save price"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({
  item,
  onClose,
}: {
  item: MenuItem;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<PriceHistoryRow[] | null>(null);

  useEffect(() => {
    getMenuItemPriceHistory(item.id).then((res) => {
      if (res.ok) setRows(res.data);
    });
  }, [item.id]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Price history — {item.name}</DialogTitle>
          <DialogDescription>
            Each row is a price period. The top row is the current price.
          </DialogDescription>
        </DialogHeader>

        {rows === null ? (
          <p className="py-4 text-sm text-text-muted">Loading…</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">Price</TableHead>
                <TableHead>From</TableHead>
                <TableHead>Until</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-right tabular-nums">
                    {formatZar(row.priceZar)}
                  </TableCell>
                  <TableCell>{formatDate(row.effectiveFrom)}</TableCell>
                  <TableCell>
                    {row.effectiveUntil ? (
                      formatDate(row.effectiveUntil)
                    ) : (
                      <span className="text-[color:var(--color-success)]">Current</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
