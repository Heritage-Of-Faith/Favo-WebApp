// HoursEditor — owner: Mia (AT-76, A14)
// Seven-row form (Mon–Sun). Each row: closed toggle + open/close time inputs.
// Save fires setOperatingHours once per day (G22 is single-day upsert).
// L04: hours are DISPLAY-ONLY — this form never gates orders.
"use client";

import { useCallback, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { setOperatingHours } from "@/server/actions/hours";
import type { OperatingHour } from "@/lib/types";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
// Display order Mon … Sun
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

type HoursRow = {
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
};

function buildRows(initial: OperatingHour[]): HoursRow[] {
  const byDay = new Map(initial.map((h) => [h.dayOfWeek, h]));
  return DISPLAY_ORDER.map((day) => {
    const h = byDay.get(day);
    return {
      dayOfWeek: day,
      openTime: h?.opensAt ?? "07:00",
      closeTime: h?.closesAt ?? "17:00",
      isClosed: h?.isClosed ?? false,
    };
  });
}

export interface HoursEditorProps {
  initialHours: OperatingHour[];
}

export default function HoursEditor({ initialHours }: HoursEditorProps) {
  const [rows, setRows] = useState<HoursRow[]>(() => buildRows(initialHours));
  const [isPending, startTransition] = useTransition();

  const updateRow = useCallback(
    (dayOfWeek: number, patch: Partial<Omit<HoursRow, "dayOfWeek">>) => {
      setRows((prev) =>
        prev.map((r) => (r.dayOfWeek === dayOfWeek ? { ...r, ...patch } : r))
      );
    },
    []
  );

  const handleSave = useCallback(() => {
    startTransition(async () => {
      const results = await Promise.all(
        rows.map((r) =>
          setOperatingHours({
            dayOfWeek: r.dayOfWeek,
            openTime: r.openTime,
            closeTime: r.closeTime,
            isClosed: r.isClosed,
          })
        )
      );

      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        toast.error(
          failed[0] && !failed[0].ok
            ? failed[0].message
            : "Failed to save hours."
        );
      } else {
        toast.success("Operating hours saved.");
      }
    });
  }, [rows]);

  return (
    <div className="space-y-6">
      <p className="text-sm text-text-muted">
        These hours are display-only — orders are never refused based on time
        (L04).
      </p>

      <div className="overflow-x-auto rounded-md border border-border-subtle">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="border-b border-border-subtle bg-elevated">
              <th className="px-4 py-3 text-left font-medium text-text-muted w-20">
                Day
              </th>
              <th className="px-4 py-3 text-left font-medium text-text-muted w-28">
                Opens
              </th>
              <th className="px-4 py-3 text-left font-medium text-text-muted w-28">
                Closes
              </th>
              <th className="px-4 py-3 text-left font-medium text-text-muted">
                Closed all day
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const dayId = `day-${row.dayOfWeek}`;
              return (
                <tr
                  key={row.dayOfWeek}
                  className="border-b border-border-subtle last:border-0 hover:bg-elevated/50 transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-text-strong">
                    {DAY_NAMES[row.dayOfWeek]}
                  </td>

                  <td className="px-4 py-2">
                    <input
                      type="time"
                      id={`${dayId}-open`}
                      value={row.openTime}
                      disabled={row.isClosed || isPending}
                      onChange={(e) =>
                        updateRow(row.dayOfWeek, { openTime: e.target.value })
                      }
                      aria-label={`${DAY_NAMES[row.dayOfWeek]} opens at`}
                      className="rounded border border-border-subtle bg-surface px-2 py-1 text-sm text-text-strong disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </td>

                  <td className="px-4 py-2">
                    <input
                      type="time"
                      id={`${dayId}-close`}
                      value={row.closeTime}
                      disabled={row.isClosed || isPending}
                      onChange={(e) =>
                        updateRow(row.dayOfWeek, { closeTime: e.target.value })
                      }
                      aria-label={`${DAY_NAMES[row.dayOfWeek]} closes at`}
                      className="rounded border border-border-subtle bg-surface px-2 py-1 text-sm text-text-strong disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </td>

                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id={`${dayId}-closed`}
                        checked={row.isClosed}
                        disabled={isPending}
                        onChange={(e) =>
                          updateRow(row.dayOfWeek, { isClosed: e.target.checked })
                        }
                        aria-label={`${DAY_NAMES[row.dayOfWeek]} closed all day`}
                        className="h-4 w-4 cursor-pointer rounded border-border-subtle accent-[color:var(--color-accent)] disabled:cursor-not-allowed"
                      />
                      <Label
                        htmlFor={`${dayId}-closed`}
                        className="text-xs text-text-muted cursor-pointer"
                      >
                        {row.isClosed ? "Closed" : "Open"}
                      </Label>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Button onClick={handleSave} disabled={isPending}>
        {isPending ? "Saving…" : "Save hours"}
      </Button>
    </div>
  );
}
