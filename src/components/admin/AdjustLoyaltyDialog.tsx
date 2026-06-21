"use client";

// AdjustLoyaltyDialog — AT-123
// Admin dialog to manually adjust a customer's loyalty balance with an audited reason.

import { useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { searchCustomer } from "@/server/actions/customers";
import { adjustLoyalty } from "@/server/actions/loyalty";
import type { Customer } from "@/lib/types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
};

export default function AdjustLoyaltyDialog({ open, onOpenChange, onSuccess }: Props) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Customer[]>([]);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [isSearching, startSearch] = useTransition();
  const [isSubmitting, startSubmit] = useTransition();

  function handleQueryChange(value: string) {
    setQuery(value);
    setSelected(null);
    setSuggestions([]);
    setError(null);
    setSuccessMsg(null);

    if (value.trim().length < 2) return;

    startSearch(async () => {
      const res = await searchCustomer(value.trim());
      if (res.ok) {
        setSuggestions(res.data);
      }
    });
  }

  function handleSelectCustomer(customer: Customer) {
    setSelected(customer);
    setQuery(customer.name);
    setSuggestions([]);
    setError(null);
    setSuccessMsg(null);
  }

  function handleSubmit() {
    setError(null);
    setSuccessMsg(null);

    if (!selected) {
      setError("Please select a customer.");
      return;
    }

    const deltaNum = parseInt(delta, 10);
    if (!Number.isInteger(deltaNum) || isNaN(deltaNum) || deltaNum === 0) {
      setError("Delta must be a non-zero integer (e.g. +50 or -20).");
      return;
    }

    if (reason.trim().length < 3) {
      setError("Reason must be at least 3 characters.");
      return;
    }

    startSubmit(async () => {
      const res = await adjustLoyalty(selected.id, deltaNum, reason.trim());
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setSuccessMsg(`Done. New balance: ${res.data.newBalance} pts`);
      // Reset form after short delay then close
      setTimeout(() => {
        resetForm();
        onOpenChange(false);
        onSuccess();
      }, 1200);
    });
  }

  function resetForm() {
    setQuery("");
    setSuggestions([]);
    setSelected(null);
    setDelta("");
    setReason("");
    setError(null);
    setSuccessMsg(null);
  }

  function handleOpenChange(val: boolean) {
    if (!val) resetForm();
    onOpenChange(val);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="admin-page-title">Adjust Loyalty Balance</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Customer search */}
          <div className="space-y-1.5 relative">
            <Label htmlFor="customer-search" className="favo-small">
              Customer
            </Label>
            <Input
              id="customer-search"
              placeholder="Search by name or phone…"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              autoComplete="off"
            />
            {isSearching && (
              <p className="text-xs text-text-muted">Searching…</p>
            )}
            {suggestions.length > 0 && !selected && (
              <ul className="absolute z-50 w-full mt-1 bg-surface border border-border-subtle rounded-[var(--radius-card)] shadow-md max-h-48 overflow-y-auto">
                {suggestions.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => handleSelectCustomer(c)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-elevated transition-colors"
                    >
                      <span className="font-medium text-text-strong">{c.name}</span>
                      {c.phone && (
                        <span className="ml-2 text-text-muted">{c.phone}</span>
                      )}
                      <span className="ml-2 text-text-muted">· {c.loyaltyPoints} pts</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {selected && (
              <p className="text-xs text-text-muted mt-1">
                Current balance:{" "}
                <span className="font-semibold text-text-strong">{selected.loyaltyPoints} pts</span>
              </p>
            )}
          </div>

          {/* Delta */}
          <div className="space-y-1.5">
            <Label htmlFor="delta" className="favo-small">
              Delta (points)
            </Label>
            <Input
              id="delta"
              type="number"
              placeholder="e.g. 50 or -20"
              value={delta}
              onChange={(e) => { setDelta(e.target.value); setError(null); }}
              step={1}
            />
            <p className="text-xs text-text-muted">
              Positive to add points, negative to subtract.
            </p>
          </div>

          {/* Reason */}
          <div className="space-y-1.5">
            <Label htmlFor="reason" className="favo-small">
              Reason <span className="text-error">*</span>
            </Label>
            <Input
              id="reason"
              placeholder="e.g. Compensation for system error"
              value={reason}
              onChange={(e) => { setReason(e.target.value); setError(null); }}
              minLength={3}
            />
          </div>

          {/* Error / success */}
          {error && (
            <p className="text-sm text-error">{error}</p>
          )}
          {successMsg && (
            <p className="text-sm text-[var(--color-success)]">{successMsg}</p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || !selected}
            >
              {isSubmitting ? "Saving…" : "Apply Adjustment"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
