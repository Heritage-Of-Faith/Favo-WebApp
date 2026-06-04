"use client";

// Purchases manager — task A10.
// List of purchases + "Record purchase" dialog. Pending emergency purchases can
// be approved inline by admins.

import { useState } from "react";
import { toast } from "sonner";
import { listPurchases, approveEmergencyPurchase } from "@/server/actions/purchases";
import { formatZar, formatDate } from "@/lib/format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import StatusBadge from "@/components/shared/StatusBadge";
import PurchaseForm, { type PurchaseItemOption } from "@/components/admin/PurchaseForm";
import type { Purchase } from "@/lib/types";

export interface PurchasesManagerProps {
  initialPurchases: Purchase[];
  items: PurchaseItemOption[];
  canApprove: boolean;
}

export default function PurchasesManager({ initialPurchases, items, canApprove }: PurchasesManagerProps) {
  const [purchases, setPurchases] = useState<Purchase[]>(initialPurchases);
  const [showForm, setShowForm] = useState(false);
  const [approving, setApproving] = useState<string | null>(null);

  async function refresh() {
    const res = await listPurchases();
    if (res.ok) setPurchases(res.data.purchases);
  }

  async function approve(id: string) {
    setApproving(id);
    const res = await approveEmergencyPurchase(id);
    setApproving(null);
    if (res.ok) {
      toast.success("Approved.");
      void refresh();
    } else {
      toast.error(res.message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="favo-label">{purchases.length} purchase{purchases.length === 1 ? "" : "s"}</span>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="min-h-10 rounded-[var(--radius-btn)] px-4 favo-cta"
          style={{ background: "var(--color-accent)", color: "var(--color-text-inverse)" }}
        >
          + Record purchase
        </button>
      </div>

      <div className="overflow-hidden rounded-[var(--radius-card)] border" style={{ borderColor: "var(--color-border-subtle)" }}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Received</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {purchases.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} style={{ textAlign: "center", color: "var(--color-text-muted)" }}>
                  No purchases recorded yet.
                </TableCell>
              </TableRow>
            ) : (
              purchases.map((p) => {
                const pending = p.status === "pending_admin_approval";
                return (
                  <TableRow key={p.id}>
                    <TableCell>{formatDate(p.receivedAt)}</TableCell>
                    <TableCell style={{ color: "var(--color-text-strong)", fontWeight: 600 }}>{p.sourceName}</TableCell>
                    <TableCell style={{ textTransform: "capitalize" }}>
                      {p.kind === "emergency" ? <StatusBadge variant="warning" dot={false}>emergency</StatusBadge> : "planned"}
                    </TableCell>
                    <TableCell className="text-right" style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                      {formatZar(p.totalZar)}
                    </TableCell>
                    <TableCell>
                      {pending ? (
                        canApprove ? (
                          <button
                            type="button"
                            onClick={() => void approve(p.id)}
                            disabled={approving === p.id}
                            className="min-h-9 rounded-[var(--radius-btn)] px-3 favo-cta disabled:opacity-50"
                            style={{ background: "var(--color-warning)", color: "var(--color-text-inverse)" }}
                          >
                            {approving === p.id ? "…" : "Approve"}
                          </button>
                        ) : (
                          <StatusBadge variant="warning">Pending</StatusBadge>
                        )
                      ) : (
                        <StatusBadge variant="ok">Active</StatusBadge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {showForm && (
        <PurchaseForm items={items} canApprove={canApprove} onClose={() => setShowForm(false)} onSaved={refresh} />
      )}
    </div>
  );
}
