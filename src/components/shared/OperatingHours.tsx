// Operating hours display — owner: Nikao (task N4)
// Display-only. System NEVER rejects orders based on time (rule L04).

import { getOperatingHours, type OperatingHour } from "@/server/actions/hours";

export interface OperatingHoursProps {
  className?: string;
}

const FAVO_TZ = "Africa/Johannesburg";

// dayOfWeek in DB: 0=Sun … 6=Sat (matches JS getDay())
const DAY_NAMES: Record<number, string> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

// Display order: Mon–Sun (1–6, then 0)
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
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
  const minuteStr = parts.find((p) => p.type === "minute")?.value ?? "0";

  // Map short weekday to JS dayOfWeek (0=Sun … 6=Sat)
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  const dayOfWeek = weekdayMap[weekdayStr] ?? 0;
  const minutes = parseInt(hourStr, 10) * 60 + parseInt(minuteStr, 10);

  return { dayOfWeek, minutes };
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function isOpenNow(row: OperatingHour, todayDow: number, nowMinutes: number): boolean {
  if (row.isClosed) return false;
  if (row.dayOfWeek !== todayDow) return false;
  const open = timeToMinutes(row.opensAt);
  const close = timeToMinutes(row.closesAt);
  return nowMinutes >= open && nowMinutes < close;
}

export default async function OperatingHours({ className }: OperatingHoursProps) {
  const result = await getOperatingHours();

  // Graceful: render nothing on error
  if (!result.ok) return null;

  const { data } = result;

  // Build a map for quick lookup
  const byDay = new Map<number, OperatingHour>(data.map((r) => [r.dayOfWeek, r]));

  const { dayOfWeek: todayDow, minutes: nowMinutes } = getCurrentJhbParts();

  return (
    <section
      className={className}
      aria-label="Operating hours"
      style={{ borderColor: "var(--color-porcelain-soft)" }}
    >
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
        }}
      >
        {DISPLAY_ORDER.map((dow) => {
          const row = byDay.get(dow);
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
                color: isToday
                  ? "var(--color-coffee-bean)"
                  : "var(--color-cool-steel)",
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
                      backgroundColor: "#22c55e",
                      flexShrink: 0,
                    }}
                  />
                )}
                <span>{dayName}</span>
              </span>
              <span
                style={{
                  color: row?.isClosed
                    ? "var(--color-cool-steel)"
                    : "inherit",
                }}
              >
                {timeLabel}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
