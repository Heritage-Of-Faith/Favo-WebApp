// Operating hours display — owner: Nikao (task N4)
// Display-only. System NEVER rejects orders based on time (rule L04).
// Data sourced from getOperatingHours() (G-backend, src/server/actions/hours.ts).

import { getOperatingHours } from "@/server/actions/hours";
import type { OperatingHour } from "@/lib/types";

export interface OperatingHoursProps {
  className?: string;
}

// Silent fallback if the DB is unreachable at render time (e.g. cold boot).
// Matches the live seed values in db/seed/hours.ts.
const FALLBACK_HOURS: OperatingHour[] = [
  { dayOfWeek: 0, opensAt: "07:00", closesAt: "15:00", isClosed: false }, // Sun
  { dayOfWeek: 1, opensAt: "09:00", closesAt: "17:00", isClosed: false }, // Mon
  { dayOfWeek: 2, opensAt: "09:00", closesAt: "17:00", isClosed: false }, // Tue
  { dayOfWeek: 3, opensAt: "09:00", closesAt: "17:00", isClosed: false }, // Wed
  { dayOfWeek: 4, opensAt: "09:00", closesAt: "17:00", isClosed: false }, // Thu
  { dayOfWeek: 5, opensAt: "09:00", closesAt: "17:00", isClosed: false }, // Fri
  { dayOfWeek: 6, opensAt: "00:00", closesAt: "00:00", isClosed: true  }, // Sat
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
const FAVO_TZ = "Africa/Johannesburg";

const DAY_NAMES: Record<number, string> = {
  0: "Sunday", 1: "Monday", 2: "Tuesday", 3: "Wednesday",
  4: "Thursday", 5: "Friday", 6: "Saturday",
};

// Display order: Mon–Fri, Sat, Sun
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function getCurrentJhbParts(): { dayOfWeek: number; minutes: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-ZA", {
    timeZone: FAVO_TZ,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const weekdayStr = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hourStr    = parts.find((p) => p.type === "hour")?.value ?? "0";
  const minuteStr  = parts.find((p) => p.type === "minute")?.value ?? "0";

  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };

  return {
    dayOfWeek: weekdayMap[weekdayStr] ?? 0,
    minutes: parseInt(hourStr, 10) * 60 + parseInt(minuteStr, 10),
  };
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function isOpenNow(row: OperatingHour, todayDow: number, nowMinutes: number): boolean {
  if (row.isClosed || row.dayOfWeek !== todayDow) return false;
  return nowMinutes >= timeToMinutes(row.opensAt) && nowMinutes < timeToMinutes(row.closesAt);
}

/** Wall-clock parts for the open/closed computation (Africa/Johannesburg). */
export interface NowParts {
  dayOfWeek: number;
  minutes: number;
}

export interface OpenStatus {
  isOpen: boolean;
  /**
   * Hospitable, informational label. Describes whether the café is physically
   * open — NEVER implies the system blocks ordering on time (rule L04).
   */
  label: string;
}

/**
 * Pure open/closed status for the café, given the week's hours and the current
 * wall-clock parts. Exported so it can be unit-tested against a synthetic clock
 * (the live component injects the real SAST parts).
 *
 * Copy is purely informational about the physical café — no "ordering
 * unavailable" / time-gate language (L04).
 */
export function computeOpenStatus(hours: OperatingHour[], now: NowParts): OpenStatus {
  const byDay = new Map<number, OperatingHour>(hours.map((h) => [h.dayOfWeek, h]));
  const today = byDay.get(now.dayOfWeek);

  if (today && !today.isClosed) {
    const opensAt = timeToMinutes(today.opensAt);
    const closesAt = timeToMinutes(today.closesAt);
    if (now.minutes >= opensAt && now.minutes < closesAt) {
      return { isOpen: true, label: `Open now · until ${today.closesAt}` };
    }
    if (now.minutes < opensAt) {
      return { isOpen: false, label: `Opens today at ${today.opensAt}` };
    }
  }

  // Closed for the rest of today — find the next day we open within a week.
  for (let i = 1; i <= 7; i++) {
    const dow = (now.dayOfWeek + i) % 7;
    const row = byDay.get(dow);
    if (row && !row.isClosed) {
      const dayWord = i === 1 ? "tomorrow" : DAY_NAMES[dow];
      return { isOpen: false, label: `Opens ${dayWord} at ${row.opensAt}` };
    }
  }

  return { isOpen: false, label: "Hours vary — pop in and say hi" };
}

// ─── Component ────────────────────────────────────────────────────────────────
export default async function OperatingHours({ className }: OperatingHoursProps) {
  const result = await getOperatingHours();
  const data = result.ok ? result.data : FALLBACK_HOURS;
  const byDay = new Map<number, OperatingHour>(data.map((r) => [r.dayOfWeek, r]));
  const { dayOfWeek: todayDow, minutes: nowMinutes } = getCurrentJhbParts();
  const status = computeOpenStatus(data, { dayOfWeek: todayDow, minutes: nowMinutes });

  return (
    <section className={className} aria-label="Operating hours">
      {/* Open/closed status — informational only (L04: never a time gate). */}
      <p
        role="status"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          margin: "0 0 0.5rem",
          fontWeight: 600,
          color: status.isOpen ? "var(--color-success)" : "var(--color-cool-steel)",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: "0.5rem",
            height: "0.5rem",
            borderRadius: "50%",
            backgroundColor: status.isOpen ? "var(--color-success)" : "var(--color-cool-steel)",
            flexShrink: 0,
          }}
        />
        {status.label}
      </p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {DISPLAY_ORDER.map((dow) => {
          const row     = byDay.get(dow);
          const dayName = DAY_NAMES[dow] ?? String(dow);
          const isToday = dow === todayDow;
          const openNow = row ? isOpenNow(row, todayDow, nowMinutes) : false;
          const timeLabel = !row
            ? "—"
            : row.isClosed
            ? "Closed"
            : `${row.opensAt} – ${row.closesAt}`;

          return (
            <li
              key={dow}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0.375rem 0",
                borderBottom: "1px solid var(--color-porcelain-soft)",
                color: isToday ? "var(--color-coffee-bean)" : "var(--color-cool-steel)",
                fontWeight: isToday ? 600 : 400,
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                {openNow && (
                  <span
                    aria-label="Open now"
                    style={{
                      display: "inline-block",
                      width: "0.5rem",
                      height: "0.5rem",
                      borderRadius: "50%",
                      backgroundColor: "var(--color-success)",
                      flexShrink: 0,
                    }}
                  />
                )}
                <span>{dayName}</span>
              </span>
              <span style={{ color: row?.isClosed ? "var(--color-cool-steel)" : "inherit" }}>
                {timeLabel}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
