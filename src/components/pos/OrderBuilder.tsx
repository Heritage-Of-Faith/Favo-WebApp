"use client";

// Order builder — owner: Mine (M3)
// Menu grid grouped by category + customisation sheet + order summary.
// Uses draftOrder store from M2. Submits via createOrder → moves to pay step.
// Docs: docs/DESIGN.md → POS Rules · docs/API.md → createOrder

import { useState, useEffect, useCallback } from "react";
import { Plus, Minus, Trash2, ChevronRight, Loader2 } from "lucide-react";
import { getMenu } from "@/server/actions/menu";
import { createOrder } from "@/server/actions/orders";
import { useDraftOrder } from "@/store/draftOrder";
import { formatZar } from "@/lib/format";
import type { MenuItem, MenuCustomisation } from "@/lib/types";

const CATEGORY_LABELS: Record<string, string> = {
  coffee:      "Coffee",
  tea:         "Tea",
  cold_brew:   "Cold Brew",
  food:        "Food",
  merchandise: "Merchandise",
  other:       "Other",
};

export default function OrderBuilder() {
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [loadingMenu, setLoadingMenu] = useState(true);
  const [menuError, setMenuError] = useState<string | null>(null);

  // Customisation sheet state
  const [modTarget, setModTarget] = useState<MenuItem | null>(null);
  const [selectedMods, setSelectedMods] = useState<MenuCustomisation[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { customer, items, totalZar, addItem, removeItem, updateQuantity, setOrderCreated } =
    useDraftOrder();

  // Load menu on mount
  useEffect(() => {
    getMenu().then((result) => {
      if (result.ok) setMenu(result.data);
      else setMenuError(result.message);
    }).catch(() => setMenuError("Could not load menu.")).finally(() => setLoadingMenu(false));
  }, []);

  // Group menu items by category
  const grouped = menu.reduce<Record<string, MenuItem[]>>((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});

  const openModSheet = useCallback((item: MenuItem) => {
    setModTarget(item);
    setSelectedMods([]);
  }, []);

  const toggleMod = useCallback((mod: MenuCustomisation) => {
    setSelectedMods((prev) =>
      prev.some((m) => m.id === mod.id) ? prev.filter((m) => m.id !== mod.id) : [...prev, mod]
    );
  }, []);

  const confirmAddItem = useCallback(() => {
    if (!modTarget) return;
    addItem({
      menuItemId: modTarget.id,
      menuItemName: modTarget.name,
      unitPriceZar: modTarget.currentPriceZar,
      modifications: selectedMods,
    });
    setModTarget(null);
    setSelectedMods([]);
  }, [modTarget, selectedMods, addItem]);

  const handleSubmit = useCallback(async () => {
    if (items.length === 0 || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await createOrder({
        customerId: customer?.id,
        items: items.map((i) => ({
          menuItemId: i.menuItemId,
          quantity: i.quantity,
          modifications: i.modifications.map((m) => m.id),
        })),
      });
      if (result.ok) {
        setOrderCreated(result.data.orderId, result.data.yocoClientSecret);
      } else {
        setSubmitError(result.message);
      }
    } catch {
      setSubmitError("Could not place order. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [items, customer, submitting, setOrderCreated]);

  // ── Loading / Error states ──────────────────────────────────────────────────
  if (loadingMenu) {
    return (
      <div className="flex flex-1 items-center justify-center text-cool-steel">
        <Loader2 size={24} strokeWidth={2.25} className="animate-spin" />
        <span className="ml-[var(--spacing-s)] favo-small">Loading menu…</span>
      </div>
    );
  }

  if (menuError) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="favo-small text-[var(--color-error)]">{menuError}</p>
      </div>
    );
  }

  return (
    <>
      {/* ── Customisation sheet (modal overlay) ──────────────────────────── */}
      {modTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Customise ${modTarget.name}`}
          className="fixed inset-0 z-50 flex items-end bg-coffee-bean/60"
          onClick={(e) => e.target === e.currentTarget && setModTarget(null)}
        >
          <div className="w-full rounded-t-[var(--radius-card)] bg-dark-teal border-t border-cool-steel/20 p-[var(--spacing-l)]">
            <h2 className="favo-h3 text-porcelain mb-[var(--spacing-xs)]">{modTarget.name}</h2>
            <p className="favo-small text-cool-steel mb-[var(--spacing-m)]">
              {formatZar(modTarget.currentPriceZar)} — select add-ons
            </p>

            {modTarget.customisations.length === 0 ? (
              <p className="favo-small text-cool-steel mb-[var(--spacing-m)]">No customisations available.</p>
            ) : (
              <ul className="mb-[var(--spacing-m)] space-y-[var(--spacing-s)]">
                {modTarget.customisations.map((mod) => {
                  const checked = selectedMods.some((m) => m.id === mod.id);
                  return (
                    <li key={mod.id}>
                      <button
                        type="button"
                        onClick={() => toggleMod(mod)}
                        aria-pressed={checked}
                        className={[
                          "flex w-full items-center justify-between rounded-[var(--radius-btn)] border px-[var(--spacing-m)] py-[var(--spacing-s)] min-h-[44px]",
                          "transition-colors duration-[var(--dur-fast)]",
                          checked
                            ? "border-crimson-carrot bg-crimson-carrot/10 text-porcelain"
                            : "border-cool-steel/30 bg-porcelain/5 text-porcelain hover:bg-porcelain/10",
                          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot",
                        ].join(" ")}
                      >
                        <span className="favo-subhead">{mod.name}</span>
                        {mod.priceDeltaZar !== 0 && (
                          <span className="favo-small text-cool-steel">
                            +{formatZar(mod.priceDeltaZar)}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <button
              type="button"
              onClick={confirmAddItem}
              className="favo-cta flex w-full items-center justify-center gap-[var(--spacing-s)] rounded-[var(--radius-btn)] bg-crimson-carrot px-[var(--spacing-m)] py-[var(--spacing-m)] min-h-[44px] text-porcelain transition-colors hover:bg-coffee-bean-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-porcelain"
            >
              Add to order
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-[var(--spacing-m)] overflow-hidden">
        {/* ── Menu grid ─────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          {Object.entries(grouped).map(([category, categoryItems]) => (
            <section key={category} className="mb-[var(--spacing-l)]">
              <h2 className="favo-label text-cool-steel mb-[var(--spacing-s)] px-[var(--spacing-xs)]">
                {CATEGORY_LABELS[category] ?? category}
              </h2>
              <div className="grid grid-cols-2 gap-[var(--spacing-s)] sm:grid-cols-3">
                {categoryItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => openModSheet(item)}
                    className={[
                      "flex flex-col items-start rounded-[var(--radius-card)] border border-cool-steel/20",
                      "bg-porcelain/10 p-[var(--spacing-m)] min-h-[80px]",
                      "text-left transition-colors duration-[var(--dur-fast)]",
                      "hover:bg-porcelain/20 active:scale-[0.98]",
                      "focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot",
                    ].join(" ")}
                  >
                    <span className="favo-subhead text-porcelain leading-tight">{item.name}</span>
                    <span className="favo-small text-cool-steel mt-auto pt-[var(--spacing-xs)]">
                      {formatZar(item.currentPriceZar)}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* ── Order summary ──────────────────────────────────────────────── */}
        {items.length > 0 && (
          <div className="border-t border-cool-steel/20 pt-[var(--spacing-m)]">
            <h2 className="favo-label text-cool-steel mb-[var(--spacing-s)]">Order</h2>
            <ul className="mb-[var(--spacing-m)] space-y-[var(--spacing-s)]">
              {items.map((item) => (
                <li
                  key={item.menuItemId}
                  className="flex items-center gap-[var(--spacing-s)]"
                >
                  {/* Qty controls */}
                  <div className="flex items-center gap-[var(--spacing-xs)]">
                    <button
                      type="button"
                      onClick={() => updateQuantity(item.menuItemId, item.quantity - 1)}
                      aria-label={`Decrease ${item.menuItemName} quantity`}
                      className="flex h-[44px] w-[44px] items-center justify-center rounded-[var(--radius-btn)] border border-cool-steel/30 text-cool-steel hover:bg-porcelain/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot"
                    >
                      <Minus size={14} strokeWidth={2.25} />
                    </button>
                    <span className="favo-subhead w-6 text-center text-porcelain">
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => updateQuantity(item.menuItemId, item.quantity + 1)}
                      aria-label={`Increase ${item.menuItemName} quantity`}
                      className="flex h-[44px] w-[44px] items-center justify-center rounded-[var(--radius-btn)] border border-cool-steel/30 text-cool-steel hover:bg-porcelain/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot"
                    >
                      <Plus size={14} strokeWidth={2.25} />
                    </button>
                  </div>
                  {/* Item name + mods */}
                  <div className="flex-1 min-w-0">
                    <p className="favo-subhead text-porcelain truncate">{item.menuItemName}</p>
                    {item.modifications.length > 0 && (
                      <p className="favo-small text-cool-steel truncate">
                        {item.modifications.map((m) => m.name).join(", ")}
                      </p>
                    )}
                  </div>
                  {/* Line total */}
                  <span className="favo-small text-porcelain shrink-0">
                    {formatZar(
                      (item.unitPriceZar +
                        item.modifications.reduce((s, m) => s + m.priceDeltaZar, 0)) *
                        item.quantity
                    )}
                  </span>
                  {/* Remove */}
                  <button
                    type="button"
                    onClick={() => removeItem(item.menuItemId)}
                    aria-label={`Remove ${item.menuItemName}`}
                    className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-[var(--radius-btn)] text-cool-steel hover:bg-porcelain/10 hover:text-[var(--color-error)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot"
                  >
                    <Trash2 size={14} strokeWidth={2.25} />
                  </button>
                </li>
              ))}
            </ul>

            {/* Total + Place Order */}
            {submitError && (
              <p className="favo-small text-[var(--color-error)] mb-[var(--spacing-s)]" role="alert">
                {submitError}
              </p>
            )}
            <div className="flex items-center justify-between gap-[var(--spacing-m)]">
              <div>
                <p className="favo-label text-cool-steel">Total</p>
                <p className="favo-h3 text-porcelain">{formatZar(totalZar)}</p>
              </div>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className={[
                  "flex items-center gap-[var(--spacing-s)] rounded-[var(--radius-btn)] bg-crimson-carrot",
                  "px-[var(--spacing-l)] py-[var(--spacing-m)] min-h-[44px]",
                  "favo-cta text-porcelain transition-colors",
                  "hover:bg-coffee-bean-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-porcelain",
                  "disabled:opacity-40 disabled:cursor-not-allowed",
                  submitting ? "animate-pulse" : "",
                ].join(" ")}
              >
                {submitting ? "Placing…" : "Place order"}
                {!submitting && <ChevronRight size={16} strokeWidth={2.25} />}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
