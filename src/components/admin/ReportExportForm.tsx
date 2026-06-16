// ReportExportForm — owner: Mia (AT-77, A15)
// Triggers GET /api/reports/export with kind, format, from, to.
// Uses fetch + blob → programmatic anchor for a true Content-Disposition download.
"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type ExportKind = "sales" | "cogs" | "inventory" | "monthly_pnl";
type ExportFormat = "csv" | "pdf";

const KIND_LABELS: Record<ExportKind, string> = {
  sales: "Sales",
  cogs: "COGS",
  inventory: "Inventory",
  monthly_pnl: "Monthly P&L",
};

const selectClass =
  "w-full rounded border border-border-subtle bg-surface px-3 py-2 text-sm text-text-strong focus:outline-none focus:ring-2 focus:ring-ring";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export default function ReportExportForm() {
  const [kind, setKind] = useState<ExportKind>("sales");
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [loading, setLoading] = useState(false);
  const [lastExport, setLastExport] = useState<{
    kind: string;
    format: string;
  } | null>(null);

  const handleExport = useCallback(async () => {
    if (!from || !to) {
      toast.error("Please fill in both date fields.");
      return;
    }
    if (to < from) {
      toast.error("'To' date must be on or after 'From' date.");
      return;
    }

    setLoading(true);
    setLastExport(null);

    try {
      const url = `/api/reports/export?kind=${kind}&format=${format}&from=${from}&to=${to}`;
      const res = await fetch(url);

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error((body as { error?: string }).error ?? "Export failed.");
        return;
      }

      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `favo-${kind}-${from}-${to}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);

      setLastExport({ kind: KIND_LABELS[kind], format: format.toUpperCase() });
    } catch {
      toast.error("Export failed — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [kind, format, from, to]);

  return (
    <div className="space-y-6 max-w-md">
      <div className="space-y-4">
        {/* Kind */}
        <div className="space-y-1.5">
          <Label htmlFor="report-kind">Report type</Label>
          <select
            id="report-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as ExportKind)}
            disabled={loading}
            className={selectClass}
          >
            <option value="sales">Sales</option>
            <option value="cogs">COGS</option>
            <option value="inventory">Inventory</option>
            <option value="monthly_pnl">Monthly P&L</option>
          </select>
        </div>

        {/* Format */}
        <div className="space-y-1.5">
          <Label htmlFor="report-format">Format</Label>
          <select
            id="report-format"
            value={format}
            onChange={(e) => setFormat(e.target.value as ExportFormat)}
            disabled={loading}
            className={selectClass}
          >
            <option value="csv">CSV</option>
            <option value="pdf">PDF</option>
          </select>
        </div>

        {/* Date range */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="report-from">From</Label>
            <input
              type="date"
              id="report-from"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              disabled={loading}
              className={selectClass}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-to">To</Label>
            <input
              type="date"
              id="report-to"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
              disabled={loading}
              className={selectClass}
            />
          </div>
        </div>
      </div>

      <Button onClick={handleExport} disabled={loading}>
        {loading ? "Exporting…" : "Export report"}
      </Button>

      {lastExport && (
        <p
          role="status"
          className="text-sm text-text-muted"
          data-testid="export-confirmation"
        >
          Exported {lastExport.kind} ({lastExport.format})
        </p>
      )}
    </div>
  );
}
