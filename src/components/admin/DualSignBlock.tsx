"use client";

// Sign-off block — task A13 (L11), simplified post role-simplification.
// Shows the admin signature slot for a monthly report and lets an admin sign.
// Signing is irreversible and closes the report immediately (the prior finance
// co-signature was removed along with the finance role).

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
import { approveMonthlyPnL } from "@/server/actions/monthly-pnl";
import { formatZar, formatDate } from "@/lib/format";
import type { MonthlyReport } from "@/lib/types";

export interface DualSignBlockProps {
  report: MonthlyReport;
  canSignAdmin: boolean;
  onSigned: () => void;
}

export default function DualSignBlock({ report, canSignAdmin, onSigned }: DualSignBlockProps) {
  const [confirm, setConfirm] = useState(false);
  const [signing, setSigning] = useState(false);

  const closed = report.status === "closed";

  async function doSign() {
    setSigning(true);
    try {
      const res = await approveMonthlyPnL(report.id);
      if (res.ok) {
        toast.success("Report signed and closed.");
        setConfirm(false);
        onSigned();
      } else {
        toast.error(res.message);
      }
    } catch {
      toast.error("Failed to sign. Please try again.");
    } finally {
      setSigning(false);
    }
  }

  return (
    <div className="space-y-3">
      <div
        className="flex flex-col gap-1 rounded-[var(--radius-card)] border p-3"
        style={{ borderColor: "var(--color-border-subtle)" }}
      >
        <span className="favo-label">Admin sign-off</span>
        {report.adminSig ? (
          <span className="favo-small inline-flex items-center gap-1.5" style={{ color: "var(--color-success)" }}>
            ✓ {report.adminSig.signerName}
            <span style={{ color: "var(--color-text-muted)" }}>· {formatDate(report.adminSig.at)}</span>
          </span>
        ) : canSignAdmin && !closed ? (
          <button
            type="button"
            onClick={() => setConfirm(true)}
            className="self-start min-h-10 rounded-[var(--radius-btn)] px-3 favo-cta"
            style={{ background: "var(--color-accent)", color: "var(--color-text-inverse)" }}
          >
            Sign &amp; close report
          </button>
        ) : (
          <span className="favo-small" style={{ color: "var(--color-text-muted)" }}>
            Awaiting admin sign-off
          </span>
        )}
      </div>

      <Dialog open={confirm} onOpenChange={(o) => !o && setConfirm(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm sign-off</DialogTitle>
            <DialogDescription>
              Signing is irreversible. You are attesting these figures for {report.month.slice(0, 7)}.
            </DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-2 gap-y-1 py-2">
            <Figure label="Revenue" value={report.revenueZar} />
            <Figure label="COGS" value={report.cogsZar} />
            <Figure label="Expenses" value={report.expensesZar} />
            <Figure label="Net" value={report.netZar} strong />
          </dl>
          <p className="favo-caption" style={{ color: "var(--color-text-muted)", textTransform: "none", letterSpacing: 0 }}>
            Once signed, the report closes and can no longer be edited (L11).
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={signing} onClick={() => void doSign()} className="min-h-10">
              {signing ? "Signing…" : "Sign & close"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Figure({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <>
      <dt className="favo-small" style={{ color: "var(--color-text-muted)" }}>
        {label}
      </dt>
      <dd
        className="favo-small text-right"
        style={{
          color: strong ? (value >= 0 ? "var(--color-success)" : "var(--color-error)") : "var(--color-text-strong)",
          fontWeight: strong ? 700 : 400,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {formatZar(value)}
      </dd>
    </>
  );
}
