"use client";

// Inline low-stock threshold editor — task A8 (T04).
// One cell of the inventory table: shows the threshold; click to edit; saving
// calls setItemThreshold (admin/owner only — server enforces) and writes audit.

import { useState } from "react";
import { toast } from "sonner";
import { setItemThreshold } from "@/server/actions/inventory";
import type { InventoryUnit } from "@/lib/types";

export interface ThresholdEditorProps {
  itemId: string;
  value: number;
  unit: InventoryUnit;
  onSaved: (newValue: number) => void;
}

export default function ThresholdEditor({ itemId, value, unit, onSaved }: ThresholdEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const [saving, setSaving] = useState(false);

  async function save() {
    const n = Number(draft);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      toast.error("Threshold must be a whole number ≥ 0.");
      return;
    }
    setSaving(true);
    const res = await setItemThreshold(itemId, n);
    setSaving(false);
    if (res.ok) {
      toast.success("Threshold updated.");
      setEditing(false);
      onSaved(n);
    } else {
      toast.error(res.message);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(String(value));
          setEditing(true);
        }}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-[var(--radius-btn)] px-2 favo-small transition-colors hover:bg-[color:var(--color-porcelain-soft)]"
        style={{ color: "var(--color-text-strong)" }}
        aria-label={`Edit threshold for this item (currently ${value} ${unit})`}
      >
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {value} {unit}
        </span>
        <span aria-hidden style={{ color: "var(--color-text-muted)" }}>
          ✎
        </span>
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        type="number"
        min={0}
        step={1}
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
          if (e.key === "Escape") setEditing(false);
        }}
        className="h-10 w-20 rounded-[var(--radius-btn)] border px-2 favo-small"
        style={{
          background: "var(--color-surface)",
          color: "var(--color-text-strong)",
          borderColor: "var(--color-border-subtle)",
        }}
      />
      <span className="favo-caption" style={{ color: "var(--color-text-muted)" }}>
        {unit}
      </span>
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="min-h-10 rounded-[var(--radius-btn)] px-2 favo-cta disabled:opacity-50"
        style={{ color: "var(--color-accent)" }}
      >
        {saving ? "…" : "Save"}
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="min-h-10 px-1 favo-small"
        style={{ color: "var(--color-text-muted)" }}
      >
        ✕
      </button>
    </span>
  );
}
