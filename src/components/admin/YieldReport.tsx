"use client";

// Container yield report — real cups-per-container for milk & beans.
// Two normalized charts (cups per kg of beans, cups per 2L of milk) so
// containers of different sizes are comparable, each filterable to a single
// product. Below each chart, a per-lot table with the exact drink-type
// breakdown (see stock_movements.menuItemId). Nothing here is predicted —
// it's all a read of what actually happened.

import { useMemo, useState } from "react";
import BarChart from "@/components/shared/charts/BarChart";
import StatusBadge from "@/components/shared/StatusBadge";
import { formatDate, formatZar } from "@/lib/format";
import type { ContainerYield } from "@/lib/types";

export interface YieldReportProps {
  yields: ContainerYield[];
}

/** Container size normalized to the given base unit (kg for beans, l for milk). */
function normalizedSize(lot: ContainerYield, base: "kg" | "l"): number | null {
  if (!lot.containerSize || !lot.containerSizeUnit) return null;
  const size = Number(lot.containerSize);
  if (!Number.isFinite(size)) return null;
  if (base === "kg") {
    if (lot.containerSizeUnit === "kg") return size;
    if (lot.containerSizeUnit === "g") return size / 1000;
    return null; // a bean lot booked in l/ml doesn't convert to kg
  }
  if (lot.containerSizeUnit === "l") return size;
  if (lot.containerSizeUnit === "ml") return size / 1000;
  return null; // a milk lot booked in kg/g doesn't convert to litres
}

function ProductSection({
  title,
  lots,
  base,
  perLabel,
  rateFactor,
}: {
  title: string;
  lots: ContainerYield[];
  base: "kg" | "l";
  /** e.g. "cups / kg" or "cups / 2L" */
  perLabel: string;
  /** Multiply the raw cups-per-base-unit rate by this (e.g. 2 for "per 2L"). */
  rateFactor: number;
}) {
  const products = useMemo(() => {
    const names = [...new Set(lots.map((l) => l.inventoryItemName))];
    return names.sort();
  }, [lots]);
  const [selected, setSelected] = useState(products[0] ?? "");
  const activeProduct = products.includes(selected) ? selected : products[0];

  if (lots.length === 0) return null;

  const productLots = lots
    .filter((l) => l.inventoryItemName === activeProduct)
    .sort((a, b) => (a.openedAt ?? "").localeCompare(b.openedAt ?? ""));

  const chartData = productLots.map((lot, i) => {
    const size = normalizedSize(lot, base);
    const rate = size && size > 0 ? (lot.cupsMade / size) * rateFactor : 0;
    return {
      label: lot.closedAt ? formatDate(lot.closedAt) : `#${i + 1} (open)`,
      value: Math.round(rate * 10) / 10,
    };
  });

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="admin-section-title" style={{ color: "var(--color-text-strong)" }}>
          {title}
        </h2>
        {products.length > 1 && (
          <select
            aria-label={`${title} — filter product`}
            value={activeProduct}
            onChange={(e) => setSelected(e.target.value)}
            className="h-9 rounded-[var(--radius-btn)] border px-2 favo-small bg-[color:var(--color-surface)] transition-colors hover:bg-[color:var(--color-porcelain-soft)]"
            style={{ color: "var(--color-text-strong)", borderColor: "var(--color-border-subtle)" }}
          >
            {products.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        )}
      </div>

      <BarChart
        data={chartData}
        barColor="var(--color-dark-teal)"
        formatValue={(v) => `${v} ${perLabel}`}
        ariaLabel={`${perLabel} for ${activeProduct}`}
      />

      <div className="overflow-x-auto rounded-[var(--radius-card)] border" style={{ borderColor: "var(--color-border-subtle)" }}>
        <table className="w-full text-left">
          <thead>
            <tr className="border-b favo-caption" style={{ borderColor: "var(--color-border-subtle)", color: "var(--color-text-muted)" }}>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Size</th>
              <th className="px-3 py-2">Paid</th>
              <th className="px-3 py-2">Cups made</th>
              <th className="px-3 py-2">{perLabel}</th>
              <th className="px-3 py-2">Cost / cup</th>
              <th className="px-3 py-2">Drink types</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {productLots.map((lot) => {
              const size = normalizedSize(lot, base);
              const rate = size && size > 0 ? Math.round(((lot.cupsMade / size) * rateFactor) * 10) / 10 : null;
              return (
                <tr key={lot.lotId} className="border-b last:border-0 favo-small align-top" style={{ borderColor: "var(--color-border-subtle)" }}>
                  <td className="px-3 py-2" style={{ color: "var(--color-text-strong)" }}>
                    {lot.sourceName ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    {lot.containerSize ? `${lot.containerSize}${lot.containerSizeUnit}` : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {lot.containerCostZar != null ? formatZar(lot.containerCostZar) : "—"}
                  </td>
                  <td className="px-3 py-2" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {lot.cupsMade}
                  </td>
                  <td className="px-3 py-2" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {rate ?? "—"}
                  </td>
                  <td className="px-3 py-2" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {lot.costPerCupZar != null ? formatZar(lot.costPerCupZar) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {lot.drinkBreakdown.length === 0
                      ? "—"
                      : lot.drinkBreakdown.map((d) => `${d.menuItemName} ×${d.cups}`).join(", ")}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge variant={lot.state === "open" ? "ok" : "neutral"} dot={false}>
                      {lot.state}
                    </StatusBadge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function YieldReport({ yields }: YieldReportProps) {
  const beanLots = yields.filter((y) => y.itemKind === "bean");
  const milkLots = yields.filter((y) => y.itemKind === "milk");

  if (yields.length === 0) {
    return (
      <div
        className="rounded-[var(--radius-card)] border p-6 text-center favo-small"
        style={{ borderColor: "var(--color-border-subtle)", color: "var(--color-text-muted)" }}
      >
        No containers opened yet — yield shows up here once a milk bottle or coffee bag has been used on the POS.
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <ProductSection title="Coffee beans" lots={beanLots} base="kg" perLabel="cups / kg" rateFactor={1} />
      <ProductSection title="Milk" lots={milkLots} base="l" perLabel="cups / 2L" rateFactor={2} />
    </div>
  );
}
