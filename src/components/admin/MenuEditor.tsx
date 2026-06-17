// Menu item editor — owner: Mia (task A5)
// Price edits, item creation, and deactivation. Admin only.
// Money is integer cents; display via formatZar.
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatZar, formatDate } from "@/lib/format";
import {
  getMenuAdmin,
  getMenuItemPriceHistory,
  setMenuItemPrice,
  createMenuItem,
  setMenuItemActive,
  type PriceHistoryRow,
} from "@/server/actions/menu";
import type { MenuItem, MenuCategory } from "@/lib/types";

const CATEGORIES: { value: MenuCategory; label: string }[] = [
  { value: "coffee", label: "Coffee" },
  { value: "tea", label: "Tea" },
  { value: "cold_brew", label: "Cold Brew" },
  { value: "food", label: "Food" },
  { value: "merchandise", label: "Merchandise" },
  { value: "other", label: "Other" },
];

type DialogState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "editPrice"; item: MenuItem }
  | { mode: "history"; item: MenuItem };

export default function MenuEditor() {
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<DialogState>({ mode: "closed" });

  const refresh = useCallback(async () => {
    const res = await getMenuAdmin();
    if (res.ok) setMenu(res.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleToggleActive(item: MenuItem) {
    const res = await setMenuItemActive(item.id, !item.active);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success(item.active ? `${item.name} deactivated.` : `${item.name} reactivated.`);
    refresh();
  }

  const active = menu.filter((i) => i.active);
  const inactive = menu.filter((i) => !i.active);

  if (loading) return <p className="text-sm text-text-muted">Loading…</p>;

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setDialog({ mode: "create" })}>+ Add item</Button>
      </div>

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
          {active.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="font-medium text-text-strong">{item.name}</TableCell>
              <TableCell className="capitalize">{item.category.replace("_", " ")}</TableCell>
              <TableCell className="text-right tabular-nums">{formatZar(item.currentPriceZar)}</TableCell>
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
                  <Link
                    href={`/admin/menu/${item.id}/recipe`}
                    className="inline-flex min-h-10 items-center rounded-[var(--radius-btn)] px-3 favo-small transition-colors hover:bg-[color:var(--color-porcelain-soft)]"
                    style={{ color: "var(--color-text-strong)" }}
                  >
                    Recipe
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-10 text-destructive hover:text-destructive"
                    onClick={() => handleToggleActive(item)}
                  >
                    Deactivate
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {inactive.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 text-sm font-semibold text-text-muted uppercase tracking-wide">
            Inactive items
          </h2>
          <Table>
            <TableBody>
              {inactive.map((item) => (
                <TableRow key={item.id} className="opacity-50">
                  <TableCell className="font-medium text-text-strong">{item.name}</TableCell>
                  <TableCell className="capitalize">{item.category.replace("_", " ")}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatZar(item.currentPriceZar)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-10"
                      onClick={() => handleToggleActive(item)}
                    >
                      Reactivate
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}

      {dialog.mode === "create" && (
        <CreateItemDialog
          onClose={() => setDialog({ mode: "closed" })}
          onSaved={refresh}
        />
      )}
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

function CreateItemDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<MenuCategory>("coffee");
  const [rands, setRands] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const priceZar = Math.round(parseFloat(rands) * 100);
    if (!name.trim()) { toast.error("Name is required."); return; }
    if (Number.isNaN(priceZar) || priceZar <= 0) { toast.error("Enter a valid price."); return; }
    setSubmitting(true);
    try {
      const res = await createMenuItem({ name: name.trim(), category, priceZar });
      if (!res.ok) { toast.error(res.message); return; }
      toast.success(`${res.data.name} added to the menu.`);
      onSaved();
      onClose();
    } catch {
      toast.error("Failed to add item. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add menu item</DialogTitle>
            <DialogDescription>
              New items appear on the POS and customer menu immediately.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="item-name">Name</Label>
              <Input
                id="item-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Oat Latte"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="item-category">Category</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as MenuCategory)}>
                <SelectTrigger id="item-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="item-price">Price (Rands)</Label>
              <Input
                id="item-price"
                inputMode="decimal"
                value={rands}
                onChange={(e) => setRands(e.target.value)}
                placeholder="e.g. 42.00"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={submitting} className="min-h-10">
              {submitting ? "Adding…" : "Add item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
  const [rands, setRands] = useState((item.currentPriceZar / 100).toFixed(2));
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cents = Math.round(parseFloat(rands) * 100);
    if (Number.isNaN(cents)) { toast.error("Enter a valid amount."); return; }
    setSubmitting(true);
    try {
      const res = await setMenuItemPrice({ menuItemId: item.id, newPriceZar: cents });
      if (!res.ok) { toast.error(res.message); return; }
      toast.success(`${item.name} price updated to ${formatZar(cents)}.`);
      onSaved();
      onClose();
    } catch {
      toast.error("Failed to update price. Please try again.");
    } finally {
      setSubmitting(false);
    }
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
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
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
    getMenuItemPriceHistory(item.id)
      .then((res) => { if (res.ok) setRows(res.data); else setRows([]); })
      .catch(() => setRows([]));
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
                  <TableCell className="text-right tabular-nums">{formatZar(row.priceZar)}</TableCell>
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
          <Button type="button" variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
