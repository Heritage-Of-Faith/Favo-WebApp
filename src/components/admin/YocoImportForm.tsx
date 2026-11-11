"use client";

// §11.2 importYocoTransactions — the Admin's upload of Yoco's transaction
// export for one revenue day (PRD v7.0 §6.8.3: "uploaded by an Admin at
// /admin/reports"). The browser reads the file's text and hands it to the
// server action, which parses it in memory; the file itself is never stored.

import { useState } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { uploadYocoExport } from "@/server/actions/reconciliation";
import { MAX_EXPORT_BYTES } from "@/server/reconciliation/yoco-export";

const inputClass =
  "w-full rounded border border-border-subtle bg-surface min-h-11 px-3 py-2 text-base text-text-strong focus:outline-none focus:ring-2 focus:ring-ring";

export default function YocoImportForm({ defaultDay, maxDay }: { defaultDay: string; maxDay: string }) {
  const router = useRouter();
  const [day, setDay] = useState(defaultDay);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    if (file.size > MAX_EXPORT_BYTES) {
      toast.error(`That file is larger than ${MAX_EXPORT_BYTES / 1024} KB.`);
      return;
    }
    setBusy(true);
    try {
      const res = await uploadYocoExport(day, await file.text());
      if (res.ok) {
        const s = res.data;
        toast.success(`Imported ${day}: ${s.matchedRows} of ${s.totalRows} rows matched, ${s.exceptions.length} to check.`);
        router.push(`/admin/reports?day=${day}` as Route);
        router.refresh();
      } else {
        toast.error(res.message);
      }
    } catch {
      toast.error("The upload failed. Nothing was imported.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
      <div>
        <Label htmlFor="yoco-day">Revenue day</Label>
        <input id="yoco-day" type="date" className={inputClass} value={day} max={maxDay} onChange={(e) => setDay(e.target.value)} required />
      </div>
      <div>
        <Label htmlFor="yoco-file">Yoco transaction export (CSV)</Label>
        <input
          id="yoco-file"
          type="file"
          accept=".csv,text/csv"
          className={inputClass}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          required
        />
      </div>
      <Button type="submit" disabled={busy || !file}>
        {busy ? "Importing…" : "Import"}
      </Button>
    </form>
  );
}
