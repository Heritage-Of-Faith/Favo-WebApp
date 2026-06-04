"use client";

// New-expense dialog — task A10.
// Category + amount (Rands → integer cents via parseZar) + date (default today
// SAST). Submits via logExpense (admin/owner; server enforces). Money never
// leaves the form as anything but integer cents.

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { logExpense } from "@/server/actions/expenses";
import { parseZar, revenueDay } from "@/lib/format";
import type { ExpenseCategory } from "@/lib/types";

const CATEGORIES: ExpenseCategory[] = ["rent", "utilities", "staff", "maintenance", "marketing", "other"];

export interface ExpenseFormProps {
  onClose: () => void;
  onSaved: () => void;
}

export default function ExpenseForm({ onClose, onSaved }: ExpenseFormProps) {
  const [category, setCategory] = useState<ExpenseCategory>("utilities");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(revenueDay());
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cents = parseZar(amount);
    if (cents === null || cents <= 0) {
      toast.error("Enter a valid amount (e.g. 150 or 150,50).");
      return;
    }
    setSubmitting(true);
    const res = await logExpense({
      category,
      amountZar: cents,
      incurredAt: `${date}T12:00:00+02:00`,
    });
    setSubmitting(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    toast.success("Expense logged.");
    onSaved();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New expense</DialogTitle>
            <DialogDescription>
              Logged expenses reduce net on the COGS dashboard within seconds.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="expense-category">Category</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as ExpenseCategory)}>
                <SelectTrigger id="expense-category" className="min-h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c} className="capitalize">
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="expense-amount">Amount (R)</Label>
              <Input
                id="expense-amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="e.g. 150,00"
                autoComplete="off"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="expense-date">Date incurred</Label>
              <Input
                id="expense-date"
                type="date"
                max={revenueDay()}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} className="min-h-10">
              {submitting ? "Saving…" : "Log expense"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
