"use client";

/**
 * FavoPicker — THE shared Favo editor (AT-143 + AT-144, wireframe screens 5/6).
 *
 * One component, one record: the customer PWA loyalty page and the barista POS
 * modal both render exactly this picker against the same `setFavo` action —
 * per the AT-142 architecture mandate, neither surface may implement its own
 * save logic. Only the entry point differs.
 *
 * A Favo is one drink + its customisations (wireframe: "Mocha, macadamia
 * milk, +1 shot"). Quantity-based customisations (Extra Shot) stack by
 * repetition in `modifications`, identical to the POS order builder.
 */

import { useMemo, useState } from "react";
import { Minus, Plus, Loader2 } from "lucide-react";
import { setFavo } from "@/server/actions/favo";
import type { FavoView } from "@/server/favo/schema";
import { formatZar } from "@/lib/format";
import type { MenuItem, MenuCustomisation } from "@/lib/types";

export type FavoPickerProps = {
  customerId: string;
  title: string; // "Your Favo" (customer) / "Louis's Favo" (barista)
  menu: MenuItem[];
  initialFavo: FavoView | null;
  onSaved: (favo: FavoView) => void;
  onCancel: () => void;
};

/** "Mocha · Macadamia Milk, Extra Shot ×2" — for the collapsed "set" state. */
export function formatFavoSummary(favo: FavoView, menu: MenuItem[]): string {
  return favo.items
    .map((line) => {
      const mi = menu.find((m) => m.id === line.menuItemId);
      const name = mi?.name ?? "Unknown item";
      const counts = new Map<string, number>();
      for (const id of line.modifications) counts.set(id, (counts.get(id) ?? 0) + 1);
      const mods = [...counts.entries()]
        .map(([id, count]) => {
          const mod = mi?.customisations.find((c) => c.id === id);
          const label = mod?.name ?? "Unknown option";
          return count > 1 ? `${label} ×${count}` : label;
        })
        .join(", ");
      const qty = line.quantity > 1 ? `${line.quantity}× ` : "";
      return mods ? `${qty}${name} · ${mods}` : `${qty}${name}`;
    })
    .join(" + ");
}

export default function FavoPicker({
  customerId, title, menu, initialFavo, onSaved, onCancel,
}: FavoPickerProps) {
  // A Favo is single-drink in this UI; if a wider template ever exists (the
  // backend allows up to 10 lines), editing here collapses it to line one.
  const initialLine = initialFavo?.items[0] ?? null;

  const [itemId, setItemId] = useState<string | null>(initialLine?.menuItemId ?? null);
  const [modIds, setModIds] = useState<string[]>(initialLine?.modifications ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const selectedItem = useMemo(() => menu.find((m) => m.id === itemId) ?? null, [menu, itemId]);

  const dirty = useMemo(() => {
    const initIds = [...(initialLine?.modifications ?? [])].sort().join(",");
    const curIds = [...modIds].sort().join(",");
    return itemId !== (initialLine?.menuItemId ?? null) || initIds !== curIds;
  }, [itemId, modIds, initialLine]);

  function pickItem(mi: MenuItem) {
    if (mi.id === itemId) return;
    setItemId(mi.id);
    setModIds([]); // customisations belong to the picked drink
  }

  function requestCancel() {
    if (dirty && !confirmDiscard) { setConfirmDiscard(true); return; }
    onCancel();
  }

  async function save() {
    if (!itemId || saving) return;
    setSaving(true);
    setError(null);
    const res = await setFavo(customerId, [
      { menuItemId: itemId, quantity: 1, modifications: modIds },
    ]).catch(() => ({ ok: false as const, code: "ERR", message: "Could not save the Favo." }));
    setSaving(false);
    if (res.ok) onSaved(res.data.favo);
    else setError(res.message);
  }

  const modCount = (id: string) => modIds.filter((m) => m === id).length;

  return (
    <div className="rounded-[var(--radius-card)] border border-cool-steel/20 bg-porcelain p-4 flex flex-col gap-3 text-left">
      <h3 className="favo-h3 text-coffee-bean">{title}</h3>

      {/* Drink tiles */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {menu.map((mi) => (
          <button key={mi.id} type="button" onClick={() => pickItem(mi)}
            aria-pressed={mi.id === itemId}
            className={["rounded-[2px] border px-2 py-3 min-h-[52px] favo-small font-semibold transition-colors",
              mi.id === itemId
                ? "border-crimson-carrot bg-crimson-carrot/10 text-coffee-bean"
                : "border-cool-steel/30 bg-coffee-bean/5 text-coffee-bean hover:bg-coffee-bean/8",
            ].join(" ")}>
            {mi.name}
            <span className="block favo-caption text-cool-steel font-normal">{formatZar(mi.currentPriceZar)}</span>
          </button>
        ))}
      </div>

      {/* Customisations for the picked drink — same stepper/toggle rules as the POS */}
      {selectedItem && selectedItem.customisations.length > 0 && (
        <ul className="flex flex-col gap-2">
          {selectedItem.customisations.map((mod: MenuCustomisation) => {
            if (mod.addsInventoryItemId) {
              const count = modCount(mod.id);
              return (
                <li key={mod.id} className="flex items-center justify-between rounded-[2px] border border-cool-steel/30 bg-coffee-bean/5 px-3 py-2 min-h-[44px]">
                  <span className="favo-small font-semibold text-coffee-bean">
                    {mod.name}
                    {mod.priceDeltaZar !== 0 && <span className="favo-caption text-cool-steel ml-1">+{formatZar(mod.priceDeltaZar)} ea</span>}
                  </span>
                  <div className="flex items-center gap-2">
                    <button type="button" aria-label={`Decrease ${mod.name}`} disabled={count === 0}
                      onClick={() => setModIds((prev) => { const i = prev.indexOf(mod.id); return i === -1 ? prev : [...prev.slice(0, i), ...prev.slice(i + 1)]; })}
                      className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-btn)] border border-cool-steel/30 text-coffee-bean hover:bg-coffee-bean/8 disabled:opacity-30">
                      <Minus size={14} strokeWidth={2.25} />
                    </button>
                    <span className="favo-subhead w-5 text-center text-coffee-bean">{count}</span>
                    <button type="button" aria-label={`Increase ${mod.name}`}
                      onClick={() => setModIds((prev) => [...prev, mod.id])}
                      className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-btn)] border border-cool-steel/30 text-coffee-bean hover:bg-coffee-bean/8">
                      <Plus size={14} strokeWidth={2.25} />
                    </button>
                  </div>
                </li>
              );
            }
            const on = modIds.includes(mod.id);
            return (
              <li key={mod.id}>
                <button type="button" aria-pressed={on}
                  onClick={() => setModIds((prev) => (prev.includes(mod.id) ? prev.filter((m) => m !== mod.id) : [...prev, mod.id]))}
                  className={["flex w-full items-center justify-between rounded-[2px] border px-3 py-2 min-h-[44px] transition-colors",
                    on ? "border-crimson-carrot bg-crimson-carrot/10 text-coffee-bean" : "border-cool-steel/30 bg-coffee-bean/5 text-coffee-bean hover:bg-coffee-bean/8",
                  ].join(" ")}>
                  <span className="favo-small font-semibold">{mod.name}</span>
                  {mod.priceDeltaZar !== 0 && <span className="favo-caption text-cool-steel">+{formatZar(mod.priceDeltaZar)}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {error && <p className="favo-small text-[var(--color-error)]" role="alert">{error}</p>}

      {/* Unsaved-changes guard (wireframe 2a): first Cancel tap asks, second discards. */}
      {confirmDiscard ? (
        <div className="flex items-center gap-2">
          <p className="favo-small text-coffee-bean flex-1">Discard changes?</p>
          <button type="button" onClick={() => setConfirmDiscard(false)}
            className="rounded-[var(--radius-btn)] border border-cool-steel/30 px-3 py-2 min-h-[40px] favo-small text-coffee-bean hover:bg-coffee-bean/8">
            Keep editing
          </button>
          <button type="button" onClick={onCancel}
            className="rounded-[var(--radius-btn)] border border-[var(--color-error)]/50 px-3 py-2 min-h-[40px] favo-small text-[var(--color-error)] hover:bg-[var(--color-error)]/10">
            Discard
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <button type="button" onClick={requestCancel} disabled={saving}
            className="flex-1 rounded-[var(--radius-btn)] border border-cool-steel/30 py-2.5 min-h-[44px] favo-small text-coffee-bean hover:bg-coffee-bean/8 disabled:opacity-40">
            Cancel
          </button>
          <button type="button" onClick={save} disabled={!itemId || !dirty || saving}
            className="flex-1 flex items-center justify-center gap-2 rounded-[var(--radius-btn)] py-2.5 min-h-[44px] favo-small font-bold uppercase disabled:opacity-40"
            style={{ background: "var(--color-crimson-carrot)", color: "var(--color-porcelain)", letterSpacing: "var(--tracking-cta)" }}>
            {saving && <Loader2 size={14} strokeWidth={2.25} className="animate-spin" />}
            Save Favo
          </button>
        </div>
      )}
    </div>
  );
}
