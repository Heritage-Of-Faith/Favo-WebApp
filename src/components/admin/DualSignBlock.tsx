"use client";

// Dual-sign block — task A13 (L11).
// Shows the admin + finance signature slots for a monthly report and lets the
// permitted role sign (with an irreversible-action confirmation). When both
// slots are signed the report closes (server auto-transitions).

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
import type { MonthlyReport, MonthlyReportSig } from "@/lib/types";

export interface DualSignBlockProps {
  report: MonthlyReport;
  canSignAdmin: boolean;
  canSignFinance: boolean;
  onSigned: () => void;
}

function SigSlot({
  title,
  sig,
  canSign,
  onSign,
}: {
  title: string;
  sig: MonthlyReportSig | null;
  canSign: boolean;
  onSign: () => void;
}) {
  return (
    <div
      className="flex flex-col gap-1 rounded-[var(--radius-card)] border p-3"
      style={{ borderColor: "var(--color-border-subtle)" }}
    >
      <span className="favo-label">{title}</span>
      {sig ? (
        <span className="favo-small inline-flex items-center gap-1.5" style={{ color: "var(--color-success)" }}>
          ✓ {sig.signerName}
          <span style={{ color: "var(--color-text-muted)" }}>· {formatDate(sig.at)}</span>
        </span>
      ) : canSign ? (
        <button
          type="button"
          onClick={onSign}
          className="self-start min-h-10 rounded-[var(--radius-btn)] px-3 favo-cta"
          style={{ background: "var(--color-accent)", color: "var(--color-text-inverse)" }}
        >
          Sign as {title.toLowerCase()}
        </button>
      ) : (
        <span className="favo-small" style={{ color: "var(--color-text-muted)" }}>
          Awaiting {title.toLowerCase()}
        </span>
      )}
    </div>
  );
}

export default function DualSignBlock({ report, canSignAdmin, canSignFinance, onSigned }: DualSignBlockProps) {
  const [confirm, setConfirm] = useState<"admin" | "finance" | null>(null);
  const [signing, setSigning] = useState(false);

  async function doSign() {
    if (!confirm) return;
    setSigning(true);
    try {
      const res = await approveMonthlyPnL(report.id, confirm);
      if (res.ok) {
        toast.success(`Signed as ${confirm}.`);
        setConfirm(null);
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

  const closed = report.status === "closed";

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <SigSlot
          title="Admin"
          sig={report.adminSig}
          canSign={canSignAdmin && !closed}
          onSign={() => setConfirm("admin")}
        />
        <SigSlot
          title="Finance"
          sig={report.financeSig}
          canSign={canSignFinance && !closed}
          onSign={() => setConfirm("finance")}
        />
      </div>

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm {confirm} signature</DialogTitle>
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
            When both admin and finance have signed, the report closes and can no longer be edited (L11).
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button type="button" disabled={signing} onClick={() => void doSign()} className="min-h-10">
              {signing ? "Signing…" : `Sign as ${confirm}`}
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
